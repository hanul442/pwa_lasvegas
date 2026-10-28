// Blackjack: up to three betting boxes with Perfect Pairs and 21+3 side bets, AI players at the
// same table, cards out of one shoe, insurance when the dealer shows an ace, hole card turned at the end.
// "친구와 함께" seats friends in the AI chairs against the same dealer (room-client.js); in a room
// I play one box at the room's stake and every seat's moves play out as they happen.
import { api, errorMessage } from '../api.js';
import { dealCard, flipCard, placeCards, parseCard } from '../cards.js';
import { gatherCards, riffle, needsShuffle, rake } from '../dealer.js';
import { buzz } from '../haptics.js';
import { feltGestures } from '../gestures.js';
import { createChip, breakdown } from '../chips.js';
import { el, wait, formatCH, flyFrom, animate, sound } from '../fx.js';
import { settings, onSettings } from '../settings.js';
import { basicStrategy } from '../bj-strategy.js';
import { Table } from '../table.js';
import { gameName } from '../names.js';
import { createDoubleOrNothing } from '../double-or-nothing.js';
import { eventInfo, createStreakMeter } from '../event-table.js';
import { voice } from '../voice.js';
import { createRoomClient } from './room-client.js';

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
const SIDE_NAMES = {
  PERFECT: 'Perfect Pair', COLOURED: 'Coloured Pair', MIXED: 'Mixed Pair',
  SUITED_TRIPS: 'Suited Trips', STRAIGHT_FLUSH: 'Straight Flush', TRIPS: 'Three of a Kind', STRAIGHT: 'Straight', FLUSH: 'Flush'
};
const TEMPER = { steady: '정석파', cautious: '신중파', reckless: '승부사' };
const SAY = { HIT: '히트', STAND: '스탠드', DOUBLE: '더블' };
const ACTIONS = ['HIT', 'STAND', 'DOUBLE', 'SPLIT'];

// Per-device record of how often the player's move matched basic strategy.
const HINT_KEY = 'vegas:bj-strategy';
function hintRecord() { try { const r = JSON.parse(localStorage.getItem(HINT_KEY) || 'null'); return r && r.total >= 0 ? r : { right: 0, total: 0 }; } catch { return { right: 0, total: 0 }; } }
function saveHint(r) { try { localStorage.setItem(HINT_KEY, JSON.stringify(r)); } catch {} }

// `event: 'oceans'` seats Ocean's Heist (lib/events.mjs): the crew at the table and a vault
// that opens after five winning hands in a row.
export async function mountBlackjack(ctx, { event = null } = {}) {
  const ev = event ? eventInfo(ctx.state, event) : null;
  const t = new Table({ ...ctx, game: 'blackjack', title: ev ? ev.title : gameName('blackjack'), multi: true, pushDouble: true, hot: !ev });
  const don = createDoubleOrNothing(t);
  t.body.innerHTML = `
    <div class="bj">
      <div class="shoe" data-shoe aria-hidden="true"><span></span></div>
      <div class="discard" data-discard aria-hidden="true"></div>
      <div class="bj-stat" data-stat hidden></div>
      <div class="bj-dealer">
        <div class="hand" data-dealer></div>
        <span class="hand-total" data-dealer-total hidden></span>
      </div>
      <svg class="felt-arc" viewBox="0 0 420 100" aria-hidden="true">
        <path id="bj-arc" d="M24 14 Q210 92 396 14" fill="none"/>
        <path id="bj-arc2" d="M74 44 Q210 112 346 44" fill="none"/>
        <path class="arc-line" d="M14 4 Q210 96 406 4"/>
        <text font-size="17"><textPath href="#bj-arc" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
        <text class="arc-sub" font-size="9"><textPath href="#bj-arc2" startOffset="50%" text-anchor="middle">${t.tier.h17 ? 'DEALER HITS SOFT 17' : 'DEALER MUST STAND ON ALL 17'}</textPath></text>
      </svg>
      <div class="bj-insurance" data-zone="ins" aria-hidden="true"><span>INSURANCE PAYS 2 TO 1</span></div>
      <div class="bj-ai" data-ai aria-label="같은 테이블의 다른 플레이어"></div>
      <button type="button" class="pk-friends-open bj-friends" data-friends-open>친구와 함께</button>
      <div class="bj-spots">
        ${BOXES.map((b, i) => `
        <div class="bj-spot">
          <div class="bj-hands" data-hands="${b}"></div>
          <div class="bj-box">
            <button class="side-circle" type="button" data-zone="pp-${b}" aria-label="박스 ${i + 1} 퍼펙트 페어"><span class="side-label">PP</span><span class="side-tag"></span></button>
            <button class="bet-circle" type="button" data-zone="${b}" aria-label="베팅 박스 ${i + 1}"><span class="bet-circle-label">${i + 1}</span><span class="zone-amount"></span></button>
            <button class="side-circle side-circle--t3" type="button" data-zone="t3-${b}" aria-label="박스 ${i + 1} 21+3"><span class="side-label">21+3</span><span class="side-tag"></span></button>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  const shoe = t.body.querySelector('[data-shoe]');
  const discard = t.body.querySelector('[data-discard]');
  const dealerHand = t.body.querySelector('[data-dealer]');
  const dealerTotal = t.body.querySelector('[data-dealer-total]');
  const aiRow = t.body.querySelector('[data-ai]');
  const stat = t.body.querySelector('[data-stat]');
  const bj = t.body.querySelector('.bj');
  BOXES.forEach(b => t.addZone(t.body.querySelector(`[data-zone="${b}"]`)));
  BOXES.forEach(b => ['pp', 't3'].forEach(k => t.addZone(t.body.querySelector(`[data-zone="${k}-${b}"]`), { side: true })));
  t.addZone(t.body.querySelector('[data-zone="ins"]'), { passive: true });
  t.setFocus('b2');

  let round = null;
  // Server hands carry spot 1..n for the boxes in play; this maps each spot back to its box.
  let spotBox = [];
  const boxOf = hand => spotBox[hand.spot - 1] || BOXES[hand.spot - 1];
  const sideZone = bet => `${bet.kind === 'PP' ? 'pp' : 't3'}-${boxOf(bet)}`;
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
  function updateHandTotal(w, refitRow = true) {
    const texts = [...cardsOf(w).querySelectorAll('.card')].map(c => c.dataset.card);
    const tag = w.querySelector('.hand-total');
    tag.textContent = texts.length ? totalText(texts) : '';
    tag.classList.toggle('is-bust', value(texts).total > 21);
    tag.classList.toggle('is-21', value(texts).total === 21);
    if (refitRow) fit();
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

  // ---------- AI players ----------
  // Seats stay on the felt between rounds; the server decides who sits down each deal.
  const seats = new Map();
  function seatNode(ai) {
    let s = seats.get(ai.name);
    if (!s) {
      s = el('div', 'bj-seat');
      s.innerHTML = `<div class="hand-wrap bj-seat-hand"><div class="hand"></div><span class="hand-total"></span><span class="hand-result"></span><span class="bj-say" aria-live="polite"></span><span class="bj-seat-ins" aria-label="인슈어런스"></span></div>
        <div class="bj-seat-plate"><span class="bj-seat-chips"></span><b></b><small></small></div>`;
      s.querySelector('b').textContent = ai.name;
      seats.set(ai.name, s);
      animate(s, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
    }
    s.dataset.temper = ai.temper;
    s.querySelector('small').textContent = TEMPER[ai.temper] || '';
    return s;
  }
  const seatWrap = s => s.querySelector('.bj-seat-hand');
  function seatChips(s, amount) {
    const box = s.querySelector('.bj-seat-chips');
    box.replaceChildren(...breakdown(amount, t.tier.chips, 5).map((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); return c; }));
  }
  function seatAll(list = []) {
    const nodes = list.map(seatNode);
    for (const [name, s] of seats) if (!list.some(a => a.name === name)) { seats.delete(name); s.remove(); }
    aiRow.replaceChildren(...nodes);
    aiRow.dataset.count = String(nodes.length);
    list.forEach((a, i) => { seatChips(nodes[i], a.stake); clearSeat(nodes[i]); });
    return nodes;
  }
  function clearSeat(s) {
    const w = seatWrap(s);
    s.querySelector('.bj-seat-ins').replaceChildren();
    w.classList.remove('is-active', 'is-bust');
    w.querySelector('.hand-result').className = 'hand-result';
    w.querySelector('.bj-say').classList.remove('is-shown');
  }
  async function say(s, text, kind = '') {
    const bubble = s.querySelector('.bj-say');
    bubble.textContent = text;
    bubble.className = `bj-say is-shown${kind ? ` is-${kind}` : ''}`;
    await wait(420);
  }
  // Replay what the AI seats did, in seat order, after the player and before the dealer.
  async function playSeats(r) {
    const nodes = [...aiRow.children];
    for (const [i, ai] of (r.ai || []).entries()) {
      const s = nodes[i]; if (!s || !ai.log.length) continue;
      const w = seatWrap(s);
      w.classList.add('is-active');
      await wait(260);
      for (const step of ai.log) {
        await say(s, SAY[step.action] || step.action);
        if (step.action === 'DOUBLE') { seatChips(s, ai.stake); sound.chip(); }
        if (step.card) { await dealCard(cardsOf(w), step.card, shoe, { rotate: step.action === 'DOUBLE' }); updateHandTotal(w, false); }
        if (step.total > 21) { w.classList.add('is-bust'); await say(s, '버스트', 'lose'); }
      }
      await wait(200);
      w.classList.remove('is-active');
      s.querySelector('.bj-say').classList.remove('is-shown');
    }
  }
  // With the dealer's ace up, the seats that insure put half their bet on the insurance line.
  const insChips = s => s.querySelector('.bj-seat-ins');
  async function seatsInsure(r) {
    const nodes = [...aiRow.children];
    let any = false;
    for (const [i, ai] of (r.ai || []).entries()) {
      const s = nodes[i]; if (!s || !ai.insurance || insChips(s).children.length) continue;
      const box = insChips(s);
      box.replaceChildren(...breakdown(ai.insurance.stake, t.tier.chips, 3).map((v, k) => { const c = createChip(v); c.style.setProperty('--i', k); return c; }));
      sound.chip();
      await say(s, '인슈어런스');
      any = true;
    }
    if (any) { await wait(300); nodes.forEach(s => s.querySelector('.bj-say').classList.remove('is-shown')); }
  }
  // No dealer blackjack: the seats' insurance goes to the house with the player's.
  async function seatsInsuranceLost(r) {
    const nodes = [...aiRow.children];
    const rack = t.rack.getBoundingClientRect();
    await Promise.all((r.ai || []).map((ai, i) => {
      const box = nodes[i] && insChips(nodes[i]);
      if (!box?.children.length || ai.insurance?.result !== 'LOSS') return null;
      return rake([...box.children], rack).then(() => box.replaceChildren());
    }));
  }

  // The AI seats' own chips: paid from the rack or raked, for show only.
  async function settleSeats(r) {
    await seatsInsuranceLost(r);
    const nodes = [...aiRow.children];
    const rack = t.rack.getBoundingClientRect();
    const moves = [];
    (r.ai || []).forEach((ai, i) => {
      const s = nodes[i]; if (!s || !ai.result) return;
      const [label, kind] = RESULT[ai.result.result] || ['', 'push'];
      const tag = seatWrap(s).querySelector('.hand-result');
      tag.textContent = label; tag.className = `hand-result is-${kind} is-shown`;
      const box = s.querySelector('.bj-seat-chips');
      if (ai.result.netPnl < 0) moves.push(rake([...box.children], rack).then(() => box.replaceChildren()));
      else if (ai.result.netPnl > 0) breakdown(ai.result.netPnl, t.tier.chips, 5).forEach((v, k) => {
        const c = createChip(v); c.style.setProperty('--i', box.children.length); box.append(c);
        moves.push(flyFrom(c, rack, { duration: 420, delay: k * 60, lift: 30 }));
      });
      // Insurance pays 2 to 1 beside the seat's hand.
      const ins = insChips(s);
      if (ai.insurance?.result === 'WIN' && ins.children.length) breakdown(ai.insurance.netPnl, t.tier.chips, 3).forEach((v, k) => {
        const c = createChip(v); c.style.setProperty('--i', ins.children.length); ins.append(c);
        moves.push(flyFrom(c, rack, { duration: 420, delay: k * 60, lift: 30 }));
      });
    });
    await Promise.all(moves);
  }

  // ---------- side bets ----------
  function paySide(zoneId, amount, { animated = true } = {}) {
    const node = t.zones.get(zoneId);
    const stack = t.stackOf(zoneId);
    if (!node || !stack) return [];
    const pay = el('span', 'bet-stack bet-stack--payout');
    stack.after(pay);
    const rack = t.rack.getBoundingClientRect();
    return breakdown(amount, t.tier.chips, 8).map((v, i) => {
      const c = createChip(v); c.style.setProperty('--i', i); pay.append(c);
      return animated ? flyFrom(c, rack, { duration: 460, delay: i * 70, lift: 40 }) : null;
    }).filter(Boolean);
  }
  function markSide(bet) {
    const node = t.zones.get(sideZone(bet));
    if (!node) return;
    node.classList.add(bet.netPnl > 0 ? 'is-won' : 'is-lost');
    node.querySelector('.side-tag').textContent = bet.netPnl > 0 ? `${bet.pays}:1` : '';
  }
  // Side bets are decided by the first two cards and the dealer's up card, right after the deal.
  async function sideMoment(r) {
    const bets = r.sideBets || [];
    if (!bets.length) return;
    await wait(250);
    bets.forEach(markSide);
    const winners = bets.filter(b => b.netPnl > 0).sort((a, b) => b.pays - a.pays);
    if (winners.length) {
      const best = winners[0];
      t.banner(`${best.kind === 'PP' ? '' : '21+3 '}${SIDE_NAMES[best.result]} ${best.pays}:1`, 'win');
      sound.win(); buzz('win'); t.glow();
      const pays = winners.flatMap(b => paySide(sideZone(b), b.netPnl));
      sound.chips(Math.min(pays.length, 6));
      await Promise.all(pays);
    }
    const losers = bets.filter(b => b.netPnl < 0).map(sideZone);
    if (losers.length) { await wait(winners.length ? 500 : 150); await Promise.all(losers.map(z => t.rakeZone(z))); }
    await wait(winners.length ? 700 : 150);
  }
  function clearSides() {
    t.body.querySelectorAll('.side-circle').forEach(n => { n.classList.remove('is-won', 'is-lost'); n.querySelector('.side-tag').textContent = ''; });
  }

  // ---------- basic-strategy hint ----------
  function recommend(r = round) {
    if (r?.status !== 'PLAYER') return null;
    const hand = r.hands[r.activeHand];
    if (!hand) return null;
    const afford = t.available >= hand.stake;
    return basicStrategy(hand.cards, r.dealer[0], { canDouble: hand.canDouble && afford, canSplit: hand.canSplit && afford, h17: Boolean(r.h17) });
  }
  function paintStat() {
    const on = Boolean(settings.get('bjHint'));
    stat.hidden = !on;
    if (!on) return;
    const r = hintRecord();
    stat.innerHTML = r.total ? `<span>정석</span><b>${Math.round(r.right / r.total * 100)}%</b><small>${r.total}수</small>` : '<span>정석</span><small>힌트</small>';
    stat.title = r.total ? `기본 전략대로 친 비율 ${r.right}/${r.total}` : '기본 전략이 권하는 버튼이 표시돼요';
  }
  function tally(action, rec) {
    if (!rec) return;
    const r = hintRecord();
    r.total++; if (action === rec) r.right++;
    saveHint(r);
    paintStat();
  }

  function refreshActions() {
    if (room.active) return roomActions();
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
    const rec = settings.get('bjHint') && !t.busy ? recommend() : null;
    if (rec) {
      const b = t.actions.children[ACTIONS.indexOf(rec)];
      b?.classList.add('is-hint');
      b?.setAttribute('aria-description', '기본 전략 추천');
    }
  }
  // Hand signals ride on whatever the action row offers: tap = 히트, wave = 스탠드.
  const myTurn = () => !t.busy && (room.active ? rv?.status === 'PLAYING' && rv.turn === 0 && Boolean(rv.options) : round?.status === 'PLAYER');
  const signal = key => { const a = t.actionList?.find(x => x.key === key); if (a && !a.disabled) t.run(a.onClick); };
  const hands = feltGestures(t.felt, { live: myTurn, onTap: () => signal('H'), onWave: () => signal('S'), tip: text => (t.firstTips?.active ? false : t.toast(text)) });
  let wasTurn = false;
  const refreshAll = () => {
    refreshActions();
    hands.sync();
    const turn = myTurn();
    if (turn && !wasTurn) hands.showTip();
    wasTurn = turn;
  };
  t.refreshActions = refreshAll;
  t.onBetChange = () => { refreshAll(); room.onBetChange(); };
  const offSettings = onSettings(key => { if (key === 'bjHint' || key === 'gestures' || key === null) { paintStat(); refreshAll(); } });
  const destroy = t.destroy.bind(t);
  t.destroy = () => { offSettings(); hands.destroy(); destroy(); };
  paintStat();

  // The dealer picks the cards up into the discard tray; at the cut card, or the first hand at
  // this table, the deck is riffled and loaded into the shoe before the next deal.
  async function clearFelt({ shuffle = true } = {}) {
    const containers = [dealerHand, ...[...wraps.values()].map(cardsOf), ...[...seats.values()].map(s => cardsOf(seatWrap(s)))];
    if (containers.some(c => c.children.length)) await gatherCards(containers, discard);
    if (shuffle && needsShuffle(discard, 60)) await riffle(t.felt, { shoe, discard, at: dealerHand.getBoundingClientRect() });
    allHands().forEach(h => h.replaceChildren()); wraps.clear();
    [...seats.values()].forEach(s => { clearSeat(s); updateHandTotal(seatWrap(s), false); });
    dealerTotal.hidden = true;
    clearSides();
    crowd(null);
    bj.style.removeProperty('--card-w');
  }

  // A side bet needs a main bet on its box, and can't be bigger than it.
  function sideProblem() {
    for (const b of BOXES) for (const k of ['pp', 't3']) {
      const side = t.zoneTotal(`${k}-${b}`);
      if (!side) continue;
      if (!t.zoneTotal(b)) return '사이드 베팅은 메인 베팅이 있는 박스에만 걸 수 있어요';
      if (side > t.zoneTotal(b)) return '사이드 베팅은 그 박스 베팅 금액까지만 걸 수 있어요';
    }
    return '';
  }

  async function deal() {
    if (!t.betReady) return;
    const problem = sideProblem();
    if (problem) return t.reject(problem);
    const boxes = BOXES.filter(b => t.zoneTotal(b) > 0);
    const stakes = boxes.map(b => t.zoneTotal(b));
    const pairs = boxes.map(b => t.zoneTotal(`pp-${b}`)), trips = boxes.map(b => t.zoneTotal(`t3-${b}`));
    const sides = pairs.some(Boolean) || trips.some(Boolean) ? { pairs, trips } : {};
    t.lock();
    // The deal goes to the server while the last hand is swept away, not after.
    const request = api.blackjackStart(stakes, t.tier.floor, ev ? { ...sides, event: ev.id } : sides);
    request.catch(() => {});
    await clearFelt();
    let res;
    try { res = await request; }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    spotBox = boxes;
    round = res.round;
    const ws = round.hands.map(h => { const w = handWrap(h); handsIn(h).append(w); return w; });
    const sw = seatAll(round.ai).map(seatWrap);
    // Real dealing order: one card to every box, then each AI seat, the dealer up card, a second card all round, then the hole card.
    for (const [i, h] of round.hands.entries()) { await dealCard(cardsOf(ws[i]), h.cards[0], shoe); updateHandTotal(ws[i]); }
    for (const [i, a] of round.ai.entries()) { await dealCard(cardsOf(sw[i]), a.cards[0], shoe); updateHandTotal(sw[i], false); }
    await dealCard(dealerHand, round.dealer[0], shoe); updateDealerTotal(false);
    for (const [i, h] of round.hands.entries()) { await dealCard(cardsOf(ws[i]), h.cards[1], shoe); updateHandTotal(ws[i]); }
    for (const [i, a] of round.ai.entries()) { await dealCard(cardsOf(sw[i]), a.cards[1], shoe); updateHandTotal(sw[i], false); }
    await dealCard(dealerHand, 'HIDDEN', shoe, { faceUp: false });
    await sideMoment(round);
    if (round.status === 'INSURANCE') { t.banner('Insurance?', 'push'); sound.tick(); voice.say('insurance'); }
    await seatsInsure(round);
    if (round.status === 'SETTLED') await finish(res);
    else { if (round.status !== 'INSURANCE') await seatsInsuranceLost(round); markActive(round); }
  }

  async function act(action) {
    const prev = round;
    const hand = prev.hands[prev.activeHand];
    const rec = recommend(prev);
    buzz({ HIT: 'hit', STAND: 'stand', DOUBLE: 'double', SPLIT: 'split' }[action] || 'chip');
    let res;
    try { res = await api.blackjackAction(prev.id, action, prev.activeHand); }
    catch (e) { t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    if (!res.replayed) tally(action, rec);
    const next = res.round;
    if (action === 'INSURANCE' || action === 'NO_INSURANCE') {
      round = next;
      if (action === 'INSURANCE') { await t.addFromTray('ins', next.insurance.stake); t.syncBalance(); }
      if (next.status === 'SETTLED') return finish(res);
      // No dealer blackjack: an insurance bet is lost on the spot and play goes on.
      t.toast(action === 'INSURANCE' ? '딜러 블랙잭이 아니에요. 인슈어런스 칩은 하우스로 가요' : '딜러 블랙잭이 아니에요');
      await Promise.all([action === 'INSURANCE' ? t.rakeZone('ins') : null, seatsInsuranceLost(next)]);
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
    await playSeats(round);
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
    await settleSeats(round);
    const base = res.netPnl ?? round.netPnl ?? 0;
    const hot = res.hotTable;
    const net = base + (hot?.bonus || 0);
    const top = round.hands.map(h => h.result?.result);
    const handNet = round.hands.reduce((a, h) => a + (h.result?.netPnl || 0), 0);
    const insured = round.insurance?.taken && round.insurance.result === 'WIN';
    const dealerBust = value(round.dealer).total > 21;
    // Busted boxes were already called as they went over.
    const line = insured ? 'you-win' : top.includes('BLACKJACK') && handNet > 0 ? 'blackjack' : dealerBust && net > 0 ? 'dealer-busts' : net > 0 ? 'you-win' : net < 0 ? (top.every(r => r === 'BUST') ? null : 'dealer-wins') : 'push';
    voice.say(line);
    const headline = insured ? 'Insurance pays' : top.includes('BLACKJACK') && handNet > 0 ? 'Blackjack' : net > 0 ? 'You win' : net < 0 ? (top.every(r => r === 'BUST') ? 'Bust' : 'Dealer wins') : 'Push';
    // Each box settles on its own; the insurance line pays or loses separately. Side bets were
    // paid at the deal, so their chips just go home with the rest.
    const zones = new Map();
    for (const h of round.hands) zones.set(boxOf(h), (zones.get(boxOf(h)) || 0) + (h.result?.netPnl || 0));
    if (round.insurance?.taken) zones.set('ins', round.insurance.netPnl);
    for (const b of round.sideBets || []) if (b.netPnl > 0) zones.set(sideZone(b), 0);
    await t.settle(net, { label: `${headline}`, zones, hot, big: headline === 'Blackjack' ? { title: 'BLACKJACK', subtitle: '3 대 2' } : null });
    await t.syncBalance();
    refreshAll();
    if (res.eventStreak) await meter?.update(res.eventStreak);
    if (base > 0 && round.id && !room.active) don.offer(round.id, base); // 묻고 더블 rides the table win, not the hot bonus
  }

  // Resume an unfinished round so locked chips are never stranded.
  async function resume() {
    let open;
    try { open = await api.blackjackOpen(); } catch { return; }
    t.setServerState(open.state);
    await t.syncBalance();
    if (!open.round) { seatAll(open.seats || []); return; }
    round = open.round;
    spotBox = BOXES.slice(0, round.spots || 1);
    for (const h of round.hands) t.placeLocked(boxOf(h), h.stake);
    // Side bets already settled at the deal: winners sit with their payout, losers are gone.
    for (const b of round.sideBets || []) if (b.netPnl > 0) { t.placeLocked(sideZone(b), b.stake); paySide(sideZone(b), b.netPnl, { animated: false }); markSide(b); }
    t.refreshBet();
    t.lock();
    crowd(round);
    for (const h of round.hands) { const w = handWrap(h); handsIn(h).append(w); placeCards(cardsOf(w), h.cards); updateHandTotal(w); }
    seatAll(round.ai).forEach((s, i) => {
      const a = round.ai[i], w = seatWrap(s);
      placeCards(cardsOf(w), a.cards); updateHandTotal(w, false);
      if (a.insurance && a.insurance.result !== 'LOSS') insChips(s).replaceChildren(...breakdown(a.insurance.stake, t.tier.chips, 3).map((v, k) => { const c = createChip(v); c.style.setProperty('--i', k); return c; }));
    });
    placeCards(dealerHand, round.dealer); updateDealerTotal(false);
    markActive(round);
    t.toast('진행 중이던 판을 이어서 해요');
  }

  t.onKey(e => {
    if (t.busy) return;
    const k = e.key.toLowerCase();
    const live = room.active ? rv?.status === 'PLAYING' && rv.turn === 0 : round && (round.status === 'PLAYER' || round.status === 'INSURANCE');
    const keys = round?.status === 'INSURANCE' ? ['i', 'n'] : live ? ['h', 's', 'd', 'p'] : [];
    if (keys.includes(k)) { const a = t.actionList.find(x => x.key === k.toUpperCase()); if (a && !a.disabled) { e.preventDefault(); t.run(a.onClick); } }
    else if (!live && e.key === 'Enter' && !e.target.closest('button')) { const a = t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } }
  });

  // ---------- friends' room ----------
  // The server turns the room so I sit in seat 0; the other seats (friends and house players)
  // sit in the row above my box. `model` is what the felt shows while events play out.
  const MY_BOX = 'b2';
  const myHands = () => t.body.querySelector(`[data-hands="${MY_BOX}"]`);
  let rv = null, model = null;
  const others = () => [...aiRow.children];
  const seatOf = s => others()[s - 1];
  const fromView = v => v.seats.map((x, i) => ({ hands: x.hands.map(h => ({ id: h.id, cards: [...h.cards], stake: h.stake })), shown: i ? x.active : 0 }));

  function roomSeats(v) {
    const nodes = seatAll(v.seats.slice(1).map(x => ({ name: x.name, temper: x.temper, stake: v.stake })));
    v.seats.slice(1).forEach((x, i) => { if (x.kind !== 'ai') nodes[i].querySelector('small').textContent = '친구'; nodes[i].classList.toggle('is-friend', x.kind !== 'ai'); });
    return nodes;
  }
  function myWrap(id) {
    const w = handWrap({ id });
    if (!w.isConnected) myHands().append(w);
    return w;
  }
  // Another seat shows one hand at a time: the one it is playing, or its first.
  function showSeatHand(s, idx) {
    const node = seatOf(s); if (!node) return null;
    const w = seatWrap(node);
    if (model[s].shown !== idx) { model[s].shown = idx; placeCards(cardsOf(w), model[s].hands[idx].cards); updateHandTotal(w, false); }
    return w;
  }
  function roomMark(seat, hand) {
    others().forEach((n, i) => seatWrap(n).classList.toggle('is-active', i + 1 === seat));
    model?.[0].hands.forEach((h, i) => wraps.get(h.id)?.classList.toggle('is-active', seat === 0 && i === hand && model[0].hands.length > 1));
  }

  async function roomEvents(events) {
    for (const e of events) {
      if (e.type === 'deal') {
        if (e.seat < 0) { await dealCard(dealerHand, e.card, shoe, { faceUp: e.card !== 'HIDDEN' }); updateDealerTotal(false); continue; }
        const h = model[e.seat].hands[e.hand];
        h.cards.push(e.card);
        const w = e.seat === 0 ? myWrap(h.id) : seatWrap(seatOf(e.seat));
        await dealCard(cardsOf(w), e.card, shoe);
        updateHandTotal(w, e.seat === 0);
      } else if (e.type === 'turn') {
        if (e.seat > 0) showSeatHand(e.seat, e.hand);
        roomMark(e.seat, e.hand);
        if (e.seat !== 0) await wait(240);
      } else if (e.type === 'act') {
        const h = model[e.seat].hands[e.hand];
        const w = e.seat === 0 ? myWrap(h.id) : showSeatHand(e.seat, e.hand);
        if (e.seat > 0) await say(seatOf(e.seat), SAY[e.action] || e.action);
        else if (e.action === 'STAND') sound.tick();
        if (e.action === 'DOUBLE') {
          if (e.seat === 0) { await t.addFromTray(MY_BOX, h.stake); t.syncBalance(); } else { seatChips(seatOf(e.seat), e.stake); sound.chip(); }
          h.stake = e.stake;
        }
        if (e.card) { h.cards.push(e.card); await dealCard(cardsOf(w), e.card, shoe, { rotate: e.action === 'DOUBLE' }); updateHandTotal(w, e.seat === 0); }
        if (e.status === 'BUST') {
          w.classList.add('is-bust');
          if (e.seat > 0) await say(seatOf(e.seat), '버스트', 'lose');
          else voice.say('bust');
        }
      } else if (e.type === 'split') {
        const hands = model[e.seat].hands, h = hands[e.hand];
        const sib = { id: e.id, cards: [h.cards.pop()], stake: e.stake };
        hands.splice(e.hand + 1, 0, sib);
        if (e.seat === 0) {
          await t.addFromTray(MY_BOX, e.stake); t.syncBalance();
          const src = myWrap(h.id), sw = handWrap({ id: sib.id });
          src.after(sw);
          const moving = cardsOf(src).lastElementChild, rect = moving.getBoundingClientRect();
          cardsOf(sw).append(moving);
          await flyFrom(moving, rect, { duration: 360, lift: 24 });
          crowd({ hands });
          for (const [x, w, c] of [[h, src, e.cards[0]], [sib, sw, e.cards[1]]]) { x.cards.push(c); await dealCard(cardsOf(w), c, shoe); updateHandTotal(w); }
        } else {
          h.cards.push(e.cards[0]); sib.cards.push(e.cards[1]);
          await say(seatOf(e.seat), '스플릿');
          model[e.seat].shown = -1;
          showSeatHand(e.seat, e.hand);
        }
      } else if (e.type === 'reveal') {
        roomMark(-1, -1);
        const hole = dealerHand.children[1];
        await wait(250);
        if (hole) await flipCard(hole, e.card, { duration: 420 });
        updateDealerTotal(true);
      } else if (e.type === 'draw') {
        await wait(380);
        await dealCard(dealerHand, e.card, shoe);
        updateDealerTotal(true);
      } else if (e.type === 'end') await roomEnd(e);
    }
  }

  // Every hand gets its result; the other seats' chips go home or to the rack, then mine.
  async function roomEnd(e) {
    await wait(250);
    e.hands[0].forEach(r => {
      const tag = wraps.get(r.id)?.querySelector('.hand-result');
      const [label, kind] = RESULT[r.result] || ['', 'push'];
      if (tag) { tag.textContent = label; tag.className = `hand-result is-${kind} is-shown`; }
    });
    await settleSeats({ ai: e.hands.slice(1).map((hs, i) => ({ result: { result: hs.length === 1 ? hs[0].result : e.nets[i + 1] > 0 ? 'WIN' : e.nets[i + 1] < 0 ? 'LOSS' : 'PUSH', netPnl: e.nets[i + 1] } })) });
    const net = e.nets[0];
    const top = e.hands[0].map(r => r.result);
    const dealerBust = e.total > 21;
    voice.say(top.includes('BLACKJACK') && net > 0 ? 'blackjack' : dealerBust && net > 0 ? 'dealer-busts' : net > 0 ? 'you-win' : net < 0 ? (top.every(r => r === 'BUST') ? null : 'dealer-wins') : 'push');
    const headline = top.includes('BLACKJACK') && net > 0 ? 'Blackjack' : net > 0 ? 'You win' : net < 0 ? (top.every(r => r === 'BUST') ? 'Bust' : 'Dealer wins') : 'Push';
    await t.settle(net, { label: `${headline}`, big: headline === 'Blackjack' ? { title: 'BLACKJACK', subtitle: '3 대 2' } : null });
    t.locked = true;
    await t.syncBalance();
  }

  async function roomBegin(res) {
    await clearFelt();
    t.resetRound(); t.locked = true; t.root.classList.add('is-playing');
    rv = res.round;
    t.placeLocked(MY_BOX, rv.stake); t.refreshBet();
    roomSeats(rv);
    model = rv.seats.map(x => ({ hands: [{ id: x.hands[0].id, cards: [], stake: rv.stake }], shown: 0 }));
    await roomEvents(res.events);
    model = fromView(rv);
    roomMark(rv.status === 'PLAYING' ? rv.turn : -1, rv.seats[0].active);
  }
  async function roomApply(res) {
    if (!model) return roomSnapshot(res.round);
    await roomEvents(res.events);
    rv = res.round;
    model = fromView(rv);
    roomMark(rv.status === 'PLAYING' ? rv.turn : -1, rv.seats[0].active);
  }
  async function roomSnapshot(v) {
    await roomClear();
    if (v.status !== 'PLAYING') return;
    rv = v;
    model = fromView(v);
    t.locked = true; t.root.classList.add('is-playing');
    t.placeLocked(MY_BOX, v.seats[0].hands.reduce((a, h) => a + h.stake, 0)); t.refreshBet();
    crowd({ hands: v.seats[0].hands });
    v.seats[0].hands.forEach(h => { const w = myWrap(h.id); placeCards(cardsOf(w), h.cards); updateHandTotal(w); if (h.status === 'BUST') w.classList.add('is-bust'); });
    roomSeats(v).forEach((n, i) => { const x = v.seats[i + 1], w = seatWrap(n); placeCards(cardsOf(w), x.hands[x.active]?.cards || []); updateHandTotal(w, false); });
    placeCards(dealerHand, v.dealer); updateDealerTotal(false);
    roomMark(v.turn, v.seats[0].active);
  }
  async function roomClear() {
    rv = null; model = null;
    await clearFelt({ shuffle: false });
    t.resetRound();
    seatAll([]);
  }

  function roomActions() {
    bj.classList.remove('is-insurance');
    if (!rv || rv.status !== 'PLAYING') { t.setActions(room.idleActions()); return; }
    if (rv.turn !== 0 || !rv.options) {
      t.setActions([room.leaveAction(), { label: `${rv.seats[rv.turn]?.name || '다른 사람'} 차례`, ghost: true, disabled: true }]);
      return;
    }
    const o = rv.options, short = t.available < o.stake;
    const send = action => { buzz({ HIT: 'hit', STAND: 'stand', DOUBLE: 'double', SPLIT: 'split' }[action]); return room.act({ action }); };
    t.setActions([
      { label: '히트', key: 'H', primary: true, onClick: () => send('HIT') },
      { label: '스탠드', key: 'S', onClick: () => send('STAND') },
      { label: '더블', key: 'D', disabled: !o.canDouble || short, onClick: () => send('DOUBLE') },
      { label: '스플릿', key: 'P', disabled: !o.canSplit || short, onClick: () => send('SPLIT') }
    ]);
  }

  const room = createRoomClient(t, 'blackjack', {
    label: '블랙잭', word: '베팅', sizes: [2, 3, 4], size: 4,
    soloBusy: () => Boolean(round && round.status !== 'SETTLED'),
    begin: roomBegin, apply: roomApply, snapshot: roomSnapshot, refreshActions: refreshAll,
    clear: async () => { await roomClear(); }
  });
  t.body.querySelector('[data-friends-open]').addEventListener('click', () => { sound.tick(); room.open(); });
  const meter = ev?.streak ? createStreakMeter(t, ev, ctx.state?.eventStreaks?.[ev.id] || 0) : null;
  if (ev) { t.root.classList.add('is-event', `is-event--${ev.id}`); t.body.querySelector('[data-friends-open]').hidden = true; }
  const destroyRoom = t.destroy.bind(t);
  t.destroy = () => { room.stop(); return destroyRoom(); };

  refreshAll();
  await resume();
  if (!round) await room.resume().catch(() => false);
  refreshAll();
  return t;
}
