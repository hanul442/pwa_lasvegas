// Blackjack: up to three betting boxes, cards out of the shoe, insurance when the dealer shows an ace,
// hole card turned at the end.
import { api, errorMessage } from '../api.js';
import { dealCard, flipCard, placeCards, sweepCards, parseCard } from '../cards.js';
import { el, wait, formatCH, flyFrom, sound } from '../fx.js';
import { Table } from '../table.js';
import { voice } from '../voice.js';

function value(texts) {
  let total = 0, aces = 0;
  for (const t of texts) {
    const c = parseCard(t); if (!c) continue;
    if (c.rank === 'A') { aces++; total += 11; } else if (['J', 'Q', 'K'].includes(c.rank)) total += 10; else total += Number(c.rank);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const totalText = texts => { const v = value(texts); return v.soft && v.total < 21 ? `${v.total - 10}/${v.total}` : String(v.total); };

const RESULT = {
  BLACKJACK: ['블랙잭', 'win'], WIN: ['승리', 'win'], PUSH: ['푸시', 'push'],
  LOSS: ['패배', 'lose'], BUST: ['버스트', 'lose'], DEALER_BLACKJACK: ['딜러 블랙잭', 'lose']
};
const BOXES = ['b1', 'b2', 'b3'];

export async function mountBlackjack(ctx) {
  const t = new Table({ ...ctx, game: 'blackjack', title: 'Blackjack', multi: true });
  t.body.innerHTML = `
    <div class="bj">
      <div class="shoe" data-shoe aria-hidden="true"><span></span></div>
      <div class="discard" data-discard aria-hidden="true"></div>
      <div class="bj-dealer">
        <div class="hand" data-dealer></div>
        <span class="hand-total" data-dealer-total hidden></span>
      </div>
      <svg class="felt-arc" viewBox="0 0 420 100" aria-hidden="true">
        <path id="bj-arc" d="M24 14 Q210 92 396 14" fill="none"/>
        <path id="bj-arc2" d="M74 44 Q210 112 346 44" fill="none"/>
        <path class="arc-line" d="M14 4 Q210 96 406 4"/>
        <text font-size="17"><textPath href="#bj-arc" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
        <text class="arc-sub" font-size="9"><textPath href="#bj-arc2" startOffset="50%" text-anchor="middle">DEALER MUST STAND ON ALL 17</textPath></text>
      </svg>
      <div class="bj-insurance" data-zone="ins" aria-hidden="true"><span>INSURANCE PAYS 2 TO 1</span></div>
      <div class="bj-spots">
        ${BOXES.map((b, i) => `
        <div class="bj-spot">
          <div class="bj-hands" data-hands="${b}"></div>
          <button class="bet-circle" type="button" data-zone="${b}" aria-label="베팅 박스 ${i + 1}"><span class="bet-circle-label">${i + 1}</span><span class="zone-amount"></span></button>
        </div>`).join('')}
      </div>
    </div>`;
  const shoe = t.body.querySelector('[data-shoe]');
  const discard = t.body.querySelector('[data-discard]');
  const dealerHand = t.body.querySelector('[data-dealer]');
  const dealerTotal = t.body.querySelector('[data-dealer-total]');
  const bj = t.body.querySelector('.bj');
  BOXES.forEach(b => t.addZone(t.body.querySelector(`[data-zone="${b}"]`)));
  t.addZone(t.body.querySelector('[data-zone="ins"]'), { passive: true });
  t.setFocus('b2');

  let round = null;
  // Server hands carry spot 1..n for the boxes in play; this maps each spot back to its box.
  let spotBox = [];
  const boxOf = hand => spotBox[hand.spot - 1] || BOXES[hand.spot - 1];
  const handsIn = hand => t.body.querySelector(`[data-hands="${boxOf(hand)}"]`);
  const allHands = () => t.body.querySelectorAll('[data-hands]');
  // Shrink the cards as splits add hands so every box still fits across a phone.
  const crowd = r => { const n = r?.hands.length || 0; bj.classList.toggle('is-crowded', n > 3); bj.classList.toggle('is-packed', n > 4); };
  // Hits widen the hands; when the boxes no longer fit across the felt, shrink the cards
  // instead of letting the row spill off the side of the screen.
  const spotsRow = t.body.querySelector('.bj-spots');
  function fit() {
    for (let i = 0; i < 6; i++) {
      const need = spotsRow.scrollWidth, room = spotsRow.clientWidth;
      const card = spotsRow.querySelector('.card');
      if (need <= room + 1 || !card) return;
      const w = card.offsetWidth;
      bj.style.setProperty('--card-w', `${Math.max(22, Math.floor(w * room / need) - 1)}px`);
    }
  }
  const refit = () => { bj.style.removeProperty('--card-w'); fit(); };
  window.addEventListener('resize', refit);
  t.listeners.push(['resize', refit]);
  const wraps = new Map();

  function handWrap(hand) {
    let w = wraps.get(hand.id);
    if (!w) {
      w = el('div', 'hand-wrap');
      w.innerHTML = '<div class="hand"></div><span class="hand-total"></span><span class="hand-result"></span>';
      wraps.set(hand.id, w);
    }
    return w;
  }
  const cardsOf = w => w.querySelector('.hand');
  function updateHandTotal(w) {
    const texts = [...cardsOf(w).querySelectorAll('.card')].map(c => c.dataset.card);
    const tag = w.querySelector('.hand-total');
    tag.textContent = texts.length ? totalText(texts) : '';
    tag.classList.toggle('is-bust', value(texts).total > 21);
    tag.classList.toggle('is-21', value(texts).total === 21);
    fit();
  }
  function updateDealerTotal(reveal) {
    const texts = [...dealerHand.querySelectorAll('.card')].map(c => c.dataset.card).filter(x => x !== 'HIDDEN');
    dealerTotal.hidden = !texts.length;
    dealerTotal.textContent = reveal ? totalText(texts) : texts.length ? totalText(texts) : '';
    dealerTotal.classList.toggle('is-bust', value(texts).total > 21);
  }
  function markActive(r) {
    r.hands.forEach(h => wraps.get(h.id)?.classList.toggle('is-active', Boolean(h.active) && r.hands.length > 1));
  }

  function refreshActions() {
    bj.classList.toggle('is-insurance', round?.status === 'INSURANCE');
    if (!round || round.status === 'SETTLED') {
      t.setActions(t.idleActions('딜', deal));
      return;
    }
    if (round.status === 'INSURANCE') {
      const cost = round.insurance?.cost || 0;
      t.setActions([
        { label: '거절', key: 'N', onClick: () => act('NO_INSURANCE') },
        { label: `인슈어런스 ${formatCH(cost)}`, key: 'I', primary: true, disabled: t.available < cost, onClick: () => act('INSURANCE') }
      ]);
      return;
    }
    const hand = round.hands[round.activeHand];
    t.setActions([
      { label: '히트', key: 'H', primary: true, onClick: () => act('HIT') },
      { label: '스탠드', key: 'S', onClick: () => act('STAND') },
      { label: '더블', key: 'D', disabled: !hand?.canDouble || t.available < hand.stake, onClick: () => act('DOUBLE') },
      { label: '스플릿', key: 'P', disabled: !hand?.canSplit || t.available < hand.stake, onClick: () => act('SPLIT') }
    ]);
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function clearFelt() {
    const containers = [dealerHand, ...[...wraps.values()].map(cardsOf)];
    if (containers.some(c => c.children.length)) await sweepCards(containers, discard);
    allHands().forEach(h => h.replaceChildren()); wraps.clear();
    dealerTotal.hidden = true;
    crowd(null);
    bj.style.removeProperty('--card-w');
  }

  async function deal() {
    if (!t.betReady) return;
    const boxes = BOXES.filter(b => t.zoneTotal(b) > 0);
    const stakes = boxes.map(b => t.zoneTotal(b));
    t.lock();
    await clearFelt();
    let res;
    try { res = await api.blackjackStart(stakes, t.tier.floor); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    spotBox = boxes;
    round = res.round;
    const ws = round.hands.map(h => { const w = handWrap(h); handsIn(h).append(w); return w; });
    // Real dealing order: one card to every box, the dealer up card, a second card to every box, then the hole card.
    for (const [i, h] of round.hands.entries()) { await dealCard(cardsOf(ws[i]), h.cards[0], shoe); updateHandTotal(ws[i]); }
    await dealCard(dealerHand, round.dealer[0], shoe); updateDealerTotal(false);
    for (const [i, h] of round.hands.entries()) { await dealCard(cardsOf(ws[i]), h.cards[1], shoe); updateHandTotal(ws[i]); }
    await dealCard(dealerHand, 'HIDDEN', shoe, { faceUp: false });
    if (round.status === 'SETTLED') await finish(res);
    else { markActive(round); if (round.status === 'INSURANCE') { t.banner('Insurance?', 'push'); sound.tick(); voice.say('insurance'); } }
  }

  async function act(action) {
    const prev = round;
    const hand = prev.hands[prev.activeHand];
    let res;
    try { res = await api.blackjackAction(prev.id, action, prev.activeHand); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    const next = res.round;
    if (action === 'INSURANCE' || action === 'NO_INSURANCE') {
      round = next;
      if (action === 'INSURANCE') { await t.addFromTray('ins', next.insurance.stake); t.syncBalance(); }
      if (next.status === 'SETTLED') return finish(res);
      // No dealer blackjack: an insurance bet is lost on the spot and play goes on.
      t.toast(action === 'INSURANCE' ? '딜러 블랙잭이 아니에요. 인슈어런스 칩은 하우스로 가요' : '딜러 블랙잭이 아니에요');
      if (action === 'INSURANCE') await t.rakeZone('ins');
      markActive(round);
      return;
    }
    if (action === 'DOUBLE' || action === 'SPLIT') { await t.addFromTray(boxOf(hand), hand.stake); t.syncBalance(); }
    if (action === 'STAND') sound.tick();

    // Split: lift the second card into its new hand before dealing.
    if (action === 'SPLIT') {
      const src = wraps.get(hand.id);
      const idx = next.hands.findIndex(h => h.id === hand.id);
      const sibling = next.hands[idx + 1];
      const sw = handWrap(sibling);
      src.after(sw);
      const moving = cardsOf(src).lastElementChild;
      const rect = moving.getBoundingClientRect();
      cardsOf(sw).append(moving);
      updateHandTotal(src); updateHandTotal(sw);
      await flyFrom(moving, rect, { duration: 360, lift: 24 });
    }
    crowd(next);
    for (const h of next.hands) {
      const w = handWrap(h);
      if (!w.isConnected) handsIn(h).append(w);
      const have = cardsOf(w).children.length;
      for (let k = have; k < h.cards.length; k++) {
        await dealCard(cardsOf(w), h.cards[k], shoe, { rotate: h.doubled && k === 2 });
        updateHandTotal(w);
      }
      if (h.status === 'BUST' && !w.classList.contains('is-bust')) { w.classList.add('is-bust'); voice.say('bust'); }
    }
    round = next;
    markActive(round);
    if (round.status === 'SETTLED') await finish(res);
  }

  async function finish(res) {
    round = res.round;
    markActive({ hands: [] });
    const hole = dealerHand.children[1];
    await wait(250);
    if (hole) await flipCard(hole, round.dealer[1], { duration: 420 });
    updateDealerTotal(true);
    for (let k = 2; k < round.dealer.length; k++) {
      await wait(380);
      await dealCard(dealerHand, round.dealer[k], shoe);
      updateDealerTotal(true);
    }
    await wait(250);
    for (const h of round.hands) {
      const w = wraps.get(h.id);
      const [label, kind] = RESULT[h.result?.result] || ['', 'push'];
      const tag = w?.querySelector('.hand-result');
      if (tag) { tag.textContent = label; tag.className = `hand-result is-${kind} is-shown`; }
    }
    const net = res.netPnl ?? round.netPnl ?? 0;
    const top = round.hands.map(h => h.result?.result);
    const insured = round.insurance?.taken && round.insurance.result === 'WIN';
    const dealerBust = value(round.dealer).total > 21;
    // Busted boxes were already called as they went over.
    const line = insured ? 'you-win' : top.includes('BLACKJACK') && net > 0 ? 'blackjack' : dealerBust && net > 0 ? 'dealer-busts' : net > 0 ? 'you-win' : net < 0 ? (top.every(r => r === 'BUST') ? null : 'dealer-wins') : 'push';
    voice.say(line);
    const headline = insured ? 'Insurance pays' : top.includes('BLACKJACK') && net > 0 ? 'Blackjack' : net > 0 ? 'You win' : net < 0 ? (top.every(r => r === 'BUST') ? 'Bust' : 'Dealer wins') : 'Push';
    // Each box settles on its own; the insurance line pays or loses separately.
    const zones = new Map();
    for (const h of round.hands) zones.set(boxOf(h), (zones.get(boxOf(h)) || 0) + (h.result?.netPnl || 0));
    if (round.insurance?.taken) zones.set('ins', round.insurance.netPnl);
    await t.settle(net, { label: `${headline}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}`, zones });
    await t.syncBalance();
    refreshActions();
  }

  // Resume an unfinished round so locked chips are never stranded.
  async function resume() {
    let open;
    try { open = await api.blackjackOpen(); } catch { return; }
    t.setServerState(open.state);
    await t.syncBalance();
    if (!open.round) return;
    round = open.round;
    spotBox = BOXES.slice(0, round.spots || 1);
    for (const h of round.hands) t.placeLocked(boxOf(h), h.stake);
    t.refreshBet();
    t.lock();
    crowd(round);
    for (const h of round.hands) { const w = handWrap(h); handsIn(h).append(w); placeCards(cardsOf(w), h.cards); updateHandTotal(w); }
    placeCards(dealerHand, round.dealer); updateDealerTotal(false);
    markActive(round);
    t.toast('진행 중이던 판을 이어서 해요');
  }

  t.onKey(e => {
    if (t.busy) return;
    const k = e.key.toLowerCase();
    const live = round && (round.status === 'PLAYER' || round.status === 'INSURANCE');
    const keys = round?.status === 'INSURANCE' ? ['i', 'n'] : live ? ['h', 's', 'd', 'p'] : [];
    if (keys.includes(k)) { const a = t.actionList.find(x => x.key === k.toUpperCase()); if (a && !a.disabled) { e.preventDefault(); t.run(a.onClick); } }
    else if (!live && e.key === 'Enter' && !e.target.closest('button')) { const a = t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } }
  });

  refreshActions();
  await resume();
  refreshActions();
  return t;
}
