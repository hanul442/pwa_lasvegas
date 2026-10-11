// Blackjack: chips into the circle, cards out of the shoe, hole card turned at the end.
import { api, errorMessage } from '../api.js';
import { dealCard, flipCard, placeCards, sweepCards, parseCard } from '../cards.js';
import { el, wait, formatCH, flyFrom, sound } from '../fx.js';
import { Table } from '../table.js';

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

export async function mountBlackjack(ctx) {
  const t = new Table({ ...ctx, game: 'blackjack', title: 'Blackjack' });
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
      <div class="bj-hands" data-hands></div>
      <button class="bet-circle" type="button" data-zone="main" aria-label="베팅 원"><span class="bet-circle-label">BET</span></button>
    </div>`;
  const shoe = t.body.querySelector('[data-shoe]');
  const discard = t.body.querySelector('[data-discard]');
  const dealerHand = t.body.querySelector('[data-dealer]');
  const dealerTotal = t.body.querySelector('[data-dealer-total]');
  const handsEl = t.body.querySelector('[data-hands]');
  t.addZone(t.body.querySelector('[data-zone="main"]'));

  let round = null;
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
    if (!round || round.status === 'SETTLED') {
      t.setActions([
        { label: '지우기', ghost: true, disabled: !t.total, onClick: () => t.clearBet() },
        ...(t.lastBet ? [{ label: '다시 베팅', ghost: true, onClick: () => t.rebet() }] : []),
        { label: '딜', key: '↵', primary: true, disabled: !t.betReady, onClick: deal }
      ]);
      return;
    }
    const hand = round.hands[round.activeHand];
    t.setActions([
      { label: '히트', key: 'H', primary: true, onClick: () => act('HIT') },
      { label: '스탠드', key: 'S', onClick: () => act('STAND') },
      { label: '더블', key: 'D', disabled: !hand?.canDouble || t.available < hand.stake, onClick: () => act('DOUBLE') },
      ...(hand?.canSplit ? [{ label: '스플릿', key: 'P', disabled: t.available < hand.stake, onClick: () => act('SPLIT') }] : [])
    ]);
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function clearFelt() {
    const containers = [dealerHand, ...[...wraps.values()].map(cardsOf)];
    if (containers.some(c => c.children.length)) await sweepCards(containers, discard);
    handsEl.replaceChildren(); wraps.clear();
    dealerTotal.hidden = true;
  }

  async function deal() {
    if (!t.betReady) return;
    t.lock();
    await clearFelt();
    let res;
    try { res = await api.blackjackStart(t.total, t.tier.floor); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    round = res.round;
    const hand = round.hands[0];
    const w = handWrap(hand);
    handsEl.append(w);
    // Real dealing order: player, dealer, player, dealer (hole card face down).
    await dealCard(cardsOf(w), hand.cards[0], shoe); updateHandTotal(w);
    await dealCard(dealerHand, round.dealer[0], shoe); updateDealerTotal(false);
    await dealCard(cardsOf(w), hand.cards[1], shoe); updateHandTotal(w);
    await dealCard(dealerHand, 'HIDDEN', shoe, { faceUp: false });
    if (round.status === 'SETTLED') await finish(res);
    else markActive(round);
  }

  async function act(action) {
    const prev = round;
    const hand = prev.hands[prev.activeHand];
    let res;
    try { res = await api.blackjackAction(prev.id, action, prev.activeHand); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    const next = res.round;
    if (action === 'DOUBLE' || action === 'SPLIT') await t.addFromTray('main', hand.stake);
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
    for (const h of next.hands) {
      const w = handWrap(h);
      if (!w.isConnected) handsEl.append(w);
      const have = cardsOf(w).children.length;
      for (let k = have; k < h.cards.length; k++) {
        await dealCard(cardsOf(w), h.cards[k], shoe, { rotate: h.doubled && k === 2 });
        updateHandTotal(w);
      }
      if (h.status === 'BUST') w.classList.add('is-bust');
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
    const headline = top.includes('BLACKJACK') && net > 0 ? 'Blackjack' : net > 0 ? 'You win' : net < 0 ? (top.every(r => r === 'BUST') ? 'Bust' : 'Dealer wins') : 'Push';
    await t.settle(net, { label: `${headline}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}` });
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
    t.bet = { zone: 'main', chips: [round.stake] };
    t.pushChip('main', t.tier.chips.find(c => c <= round.stake) || t.tier.chips[0]);
    t.betEl.textContent = formatCH(round.stake);
    t.lock();
    for (const h of round.hands) { const w = handWrap(h); handsEl.append(w); placeCards(cardsOf(w), h.cards); updateHandTotal(w); }
    placeCards(dealerHand, round.dealer); updateDealerTotal(false);
    markActive(round);
    t.toast('진행 중이던 판을 이어서 해요');
  }

  t.onKey(e => {
    if (t.busy) return;
    const k = e.key.toLowerCase();
    const live = round && round.status === 'PLAYER';
    const map = live ? { h: 'HIT', s: 'STAND', d: 'DOUBLE', p: 'SPLIT' } : {};
    if (map[k]) { const a = t.actionList.find(x => x.key === k.toUpperCase()); if (a && !a.disabled) { e.preventDefault(); t.run(a.onClick); } }
    else if (!live && e.key === 'Enter' && t.betReady && !e.target.closest('button')) { e.preventDefault(); t.run(deal); }
  });

  refreshActions();
  await resume();
  refreshActions();
  return t;
}
