// Baccarat: back a side, then watch the cards turn and the third-card rule play out.
// "친구와 함께" seats friends at the same shoe (room-client.js): each seat backs a side in turn,
// then the dealer turns the coup for everyone at once.
import { api } from '../api.js';
import { gameName } from '../names.js';
import { dealCard, flipCard, parseCard, placeCards } from '../cards.js';
import { gatherCards, riffle, needsShuffle, rake } from '../dealer.js';
import { wait, formatCH, animate, el, flyFrom, flyTo, sound } from '../fx.js';
import { createChip } from '../chips.js';
import { buzz } from '../haptics.js';
import { Table } from '../table.js';
import { createDoubleOrNothing } from '../double-or-nothing.js';
import { eventInfo, createStreakMeter } from '../event-table.js';
import { seatCrowd, chipsFor } from '../npc.js';
import { voice } from '../voice.js';
import { createRoomClient } from './room-client.js';

const point = texts => texts.reduce((s, t) => { const c = parseCard(t); if (!c) return s; return s + (c.rank === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 0 : Number(c.rank)); }, 0) % 10;
const MAIN = ['PLAYER', 'BANKER', 'TIE'];
const PAIRS = ['PLAYER_PAIR', 'BANKER_PAIR'];
const rankOf = text => parseCard(text)?.rank;

// One bet's net under real rules: tie pushes Player/Banker, banker pays 0.95, pairs 11:1.
function betNet(zone, stake, r) {
  if (PAIRS.includes(zone)) return r.pairs?.[zone] ? stake * 11 : -stake;
  if (r.winner === 'TIE') return zone === 'TIE' ? stake * 8 : 0;
  if (zone !== r.winner) return -stake;
  return zone === 'BANKER' ? stake - Math.round(stake * 0.05 / 1e6) * 1e6 : stake; // the 5% commission, to the nearest 100만 (lib/games.mjs)
}

// What the AI regulars back this hand: a side (often following the last result) and now and then a pair.
function crowdPlan(last) {
  return (npc, t) => {
    const unit = t.tier.chips[0];
    const stake = Math.ceil(t.tier.min * (1 + Math.floor(Math.random() * (npc.bold > 0.6 ? 6 : 3))) / 2 / unit) * unit;
    const roll = Math.random();
    const zone = roll < 0.08 ? 'TIE' : last() && roll < 0.55 ? last() : roll < 0.78 ? 'BANKER' : 'PLAYER';
    const lines = {
      PLAYER: ['플레이어로 갈게요.', '이번엔 플레이어.'],
      BANKER: ['뱅커 따라갈게요.', '흐름은 뱅커예요.'],
      TIE: ['타이 한번 가 보죠.', '왠지 타이 느낌이에요.']
    };
    const bets = [{ zone, amount: Math.max(stake, t.tier.min), line: Math.random() < 0.4 ? lines[zone][Math.floor(Math.random() * 2)] : null }];
    if (Math.random() < 0.22) bets.push({ zone: Math.random() < 0.5 ? 'PLAYER_PAIR' : 'BANKER_PAIR', amount: unit * (1 + Math.floor(Math.random() * 2)), line: Math.random() < 0.5 ? '페어도 하나 걸게요.' : null });
    return bets;
  };
}

// `event: 'montecarlo'` seats the Monte Carlo Gala (lib/events.mjs): a bonus after three wins in a row.
export async function mountBaccarat(ctx, { event = null } = {}) {
  const ev = event ? eventInfo(ctx.state, event) : null;
  // Multi-zone for the pair side bets; the main bet still sits on exactly one of Player/Banker/Tie.
  const t = new Table({ ...ctx, game: 'baccarat', title: ev ? ev.title : gameName('baccarat'), feltClass: 'felt--blue', multi: true, zoneMin: false, zoneWord: '한 곳당', pushDouble: true, hot: !ev });
  const don = createDoubleOrNothing(t);
  const meter = ev?.streak ? createStreakMeter(t, ev, ctx.state?.eventStreaks?.[ev.id] || 0) : null;
  if (ev) t.root.classList.add('is-event', `is-event--${ev.id}`);
  t.body.innerHTML = `
    <div class="bac">
      <div class="shoe" data-shoe aria-hidden="true"><span></span></div>
      <div class="discard" data-discard aria-hidden="true"></div>
      <div class="bac-sides">
        <section class="bac-side bac-side--player" data-side="PLAYER"><h3>Player</h3><div class="hand" data-hand></div><span class="bac-score" data-score>–</span></section>
        <section class="bac-side bac-side--banker" data-side="BANKER"><h3>Banker</h3><div class="hand" data-hand></div><span class="bac-score" data-score>–</span></section>
      </div>
      <div class="bac-bets">
        <div class="bac-pairs">
          <button type="button" class="zone zone--pair zone--player" data-zone="PLAYER_PAIR" aria-label="플레이어 페어, 11 대 1"><strong>P Pair</strong><small>11 : 1</small></button>
          <button type="button" class="zone zone--pair zone--banker" data-zone="BANKER_PAIR" aria-label="뱅커 페어, 11 대 1"><strong>B Pair</strong><small>11 : 1</small></button>
        </div>
        <div class="bac-zones">
          <button type="button" class="zone zone--player" data-zone="PLAYER"><strong>Player</strong><small>1 : 1</small></button>
          <button type="button" class="zone zone--tie" data-zone="TIE"><strong>Tie</strong><small>8 : 1</small></button>
          <button type="button" class="zone zone--banker" data-zone="BANKER"><strong>Banker</strong><small>0.95 : 1</small></button>
        </div>
      </div>
      <div class="bac-foot">
        <ol class="road" data-road aria-label="최근 결과"></ol>
        <button type="button" class="pk-friends-open bac-friends" data-friends-open>친구와 함께</button>
      </div>
    </div>`;
  t.body.querySelectorAll('[data-zone]').forEach(z => t.addZone(z));
  const shoe = t.body.querySelector('[data-shoe]');
  const discard = t.body.querySelector('[data-discard]');
  const side = s => t.body.querySelector(`[data-side="${s}"]`);
  const hand = s => side(s).querySelector('[data-hand]');
  const score = s => side(s).querySelector('[data-score]');
  const road = t.body.querySelector('[data-road]');
  let lastWinner = null;
  const crowd = seatCrowd(t, { plan: crowdPlan(() => lastWinner) });
  let room = null; // the friends' room client, set up below

  // Picking another side moves the main bet there, as before; the pair spots stack independently.
  const addChip = t.addChip.bind(t);
  t.addChip = async (zoneId, value, fromRect, opts) => {
    if (t.locked || t.busy) return;
    const held = MAIN.includes(zoneId) && MAIN.find(z => z !== zoneId && t.chipsOf(z).length);
    if (held) await t.moveBet(held, zoneId);
    return addChip(zoneId, value, fromRect, opts);
  };
  const mainZone = () => MAIN.find(z => t.chipsOf(z).length) || null;
  // Ready when the main bet meets the table minimum; pair bets ride along at any size.
  Object.defineProperty(t, 'betReady', {
    get() {
      const main = mainZone();
      return Boolean(main) && t.zoneTotal(main) >= t.tier.min && t.total <= t.available && t.betZones.every(z => t.zoneTotal(z) <= t.tier.max);
    }
  });

  function setScore(s) {
    const texts = [...hand(s).querySelectorAll('.card.is-faceup')].map(c => c.dataset.card);
    const node = score(s);
    node.textContent = texts.length ? point(texts) : '–';
    if (texts.length) animate(node, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, fill: 'none' });
  }

  function roadDot(winner) {
    const dot = document.createElement('li');
    dot.className = `road-dot road-dot--${winner.toLowerCase()}`;
    dot.textContent = winner === 'TIE' ? 'T' : winner[0];
    return dot;
  }
  function addRoad(winner) {
    road.prepend(roadDot(winner));
    while (road.children.length > 14) road.lastElementChild.remove();
  }

  function hit(zone) {
    const node = t.zones.get(zone);
    node?.classList.add('is-hit');
    setTimeout(() => node?.classList.remove('is-hit'), 2600);
  }

  function refreshActions() {
    if (room?.active) return roomActions();
    t.setActions(t.idleActions('딜', deal));
  }
  t.refreshActions = refreshActions;
  t.onBetChange = () => {
    room?.onBetChange();
    if (room?.active) return;
    const main = mainZone();
    if (t.total && !main) t.hint('Player · Banker · Tie 중 하나에도 거세요');
    else if (main && t.zoneTotal(main) < t.tier.min) t.hint(`최소 ${formatCH(t.tier.min)}`);
    refreshActions();
  };

  async function deal() {
    if (!t.betReady || room?.active) return;
    const betType = mainZone();
    const sideBets = Object.fromEntries(PAIRS.filter(z => t.zoneTotal(z)).map(z => [z, t.zoneTotal(z)]));
    const zones = t.betZones;
    const key = t.roundKey(ev?.id || '');
    t.lock();
    // The bet goes to the server while the last hand is swept away, not after.
    const request = api.baccarat(t.zoneTotal(betType), t.tier.floor, betType, Object.keys(sideBets).length ? sideBets : undefined, ev?.id, key);
    request.catch(() => {});
    // The used cards go to the discard tray; at the cut card (or the first hand here) the
    // dealer riffles a fresh deck into the shoe.
    await Promise.all([
      crowd.close(),
      (async () => {
        if (hand('PLAYER').children.length) await gatherCards([hand('PLAYER'), hand('BANKER')], discard, { at: t.body.querySelector('.bac-sides').getBoundingClientRect() });
        if (needsShuffle(discard, 48)) await riffle(t.felt, { shoe, discard, at: t.body.querySelector('.bac-sides').getBoundingClientRect() });
      })()
    ]);
    ['PLAYER', 'BANKER'].forEach(s => { score(s).textContent = '–'; side(s).classList.remove('is-winner'); });
    let res;
    try { res = await request; }
    catch (e) { t.roundFailed(e, deal); return; }
    t.roundDone();
    t.setServerState(res.state);
    const r = res.round;
    // Deal P, B, P, B face down, then turn them, the bettor's side last.
    const nodes = { PLAYER: [], BANKER: [] };
    for (let i = 0; i < 2; i++) for (const s of ['PLAYER', 'BANKER']) nodes[s].push(await dealCard(hand(s), 'HIDDEN', shoe, { faceUp: false }));
    // The side you backed turns last (a Tie or pairs-only bet counts as Player).
    const mine = betType === 'BANKER' ? 'BANKER' : 'PLAYER';
    const order = mine === 'BANKER' ? ['PLAYER', 'BANKER'] : ['BANKER', 'PLAYER'];
    const reveal = async (s, cards, texts) => {
      for (const [i, card] of cards.entries()) await flipCard(card, texts[i]);
    };
    for (const s of order) {
      const texts = s === 'PLAYER' ? r.player : r.banker;
      await wait(200);
      await reveal(s, nodes[s], texts.slice(0, 2));
      setScore(s);
      if (rankOf(texts[0]) === rankOf(texts[1])) hit(`${s}_PAIR`);
    }
    for (const s of ['PLAYER', 'BANKER']) {
      const texts = s === 'PLAYER' ? r.player : r.banker;
      if (texts.length > 2) {
        await wait(450);
        const third = await dealCard(hand(s), 'HIDDEN', shoe, { faceUp: false, rotate: true });
        await reveal(s, [third], [texts[2]]);
        setScore(s);
      }
    }
    await wait(300);
    if (r.winner !== 'TIE') side(r.winner).classList.add('is-winner');
    lastWinner = r.winner === 'TIE' ? null : r.winner;
    addRoad(r.winner);
    const hot = r.hotTable;
    const net = r.netPnl + (hot?.bonus || 0);
    // Each spot is paid or raked on its own: the main bet, then each pair from the server's result.
    const nets = new Map(zones.map(z => [z, z === betType ? r.mainPnl ?? r.netPnl : r.sideBets?.find(b => b.betType === z)?.netPnl ?? betNet(z, t.zoneTotal(z), r)]));
    const pairs = PAIRS.filter(z => r.pairs?.[z]).map(z => (z === 'PLAYER_PAIR' ? 'P Pair' : 'B Pair'));
    const label = `${r.winner === 'TIE' ? 'Tie' : `${r.winner === 'PLAYER' ? 'Player' : 'Banker'} wins`}${pairs.length ? ` · ${pairs.join(' · ')}` : ''}`;
    voice.say(r.winner === 'TIE' ? 'tie' : r.winner === 'PLAYER' ? 'player-wins' : 'banker-wins');
    await Promise.all([t.settle(net, { label, zones: nets, hot }), crowd.settle((zone, stake) => betNet(zone, stake, r))]);
    await t.syncBalance();
    crowd.open();
    if (res.eventStreak) await meter?.update(res.eventStreak);
    if (r.netPnl > 0 && r.id) don.offer(r.id, r.netPnl); // 묻고 더블 rides the table win, not the hot bonus
  }

  // ---------- friends' room ----------
  // The server turns the room so I sit in seat 0. The other seats sit on a rail of their own in
  // place of the AI regulars; their chips land on the side they back, mine come out of the tray.
  const crowdRail = t.body.querySelector('.crowd');
  const rail = el('div', 'crowd bac-rail');
  rail.setAttribute('aria-label', '같은 테이블의 친구와 AI');
  rail.hidden = true;
  t.body.append(rail);
  const SIDE_NAME = { PLAYER: 'Player', BANKER: 'Banker', TIE: 'Tie' };
  let rv = null, seated = [];
  const railSeat = s => seated[s - 1] || null;

  function railSeats(v) {
    seated = v.seats.slice(1).map((x, i) => {
      const node = el('div', 'crowd-seat');
      node.innerHTML = '<span class="crowd-avatar" aria-hidden="true"></span><span class="crowd-meta"><b></b><span></span></span><span class="crowd-bubble" role="status"></span>';
      node.querySelector('.crowd-avatar').textContent = (x.name || '?').slice(0, 1);
      node.querySelector('b').textContent = x.name || '손님';
      node.querySelector('.crowd-meta span').textContent = x.kind === 'ai' ? 'AI' : '친구';
      node.classList.toggle('is-friend', x.kind !== 'ai');
      node.dataset.seat = String(i);
      return node;
    });
    rail.replaceChildren(...seated);
  }
  function mark(seat) {
    seated.forEach((n, i) => n.classList.toggle('is-active', i + 1 === seat));
  }
  function bubble(node, text, hold = 2200) {
    const b = node?.querySelector('.crowd-bubble');
    if (!b) return;
    rail.querySelectorAll('.crowd-bubble.is-shown').forEach(x => { if (x !== b) x.classList.remove('is-shown'); });
    b.textContent = text;
    b.classList.add('is-shown');
    clearTimeout(b.timer);
    b.timer = setTimeout(() => b.classList.remove('is-shown'), hold);
  }
  // Another seat's chips on the side it backed, in its own corner of the spot.
  function seatStack(s, zone, { fly = true } = {}) {
    const node = railSeat(s), spot = t.zones.get(zone);
    if (!node || !spot) return;
    const stack = el('span', 'npc-stack bac-seat-stack');
    stack.dataset.seat = String(s - 1);
    spot.append(stack);
    const from = node.querySelector('.crowd-avatar').getBoundingClientRect();
    chipsFor(rv.stake, t.tier.chips, 5).forEach((v, i) => {
      const chip = createChip(v);
      chip.style.setProperty('--i', i);
      stack.append(chip);
      if (fly) flyFrom(chip, from, { duration: 380, delay: i * 70, lift: 60, scale: 1.1, spin: 40 });
    });
    if (fly) sound.chip();
  }
  // The other seats are paid or raked like the house regulars: winnings out of the rack, then home.
  async function settleSeats(bets, nets) {
    const rack = t.rack.getBoundingClientRect(), moves = [];
    bets.forEach((zone, s) => {
      if (!s) return;
      const node = railSeat(s), stack = t.zones.get(zone)?.querySelector(`.bac-seat-stack[data-seat="${s - 1}"]`);
      if (!node || !stack) return;
      const net = nets[s];
      if (net > 0) chipsFor(net, t.tier.chips, 6).forEach((v, i) => {
        const c = createChip(v); c.style.setProperty('--i', stack.children.length); stack.append(c);
        moves.push(flyFrom(c, rack, { duration: 460, delay: i * 70, lift: 40 }));
      });
      const meta = node.querySelector('.crowd-meta span');
      meta.textContent = net > 0 ? `+${formatCH(net)}` : net < 0 ? `-${formatCH(-net)}` : '본전';
      node.classList.remove('is-up', 'is-down');
      if (net) node.classList.add(net > 0 ? 'is-up' : 'is-down');
    });
    await Promise.all(moves);
    await wait(moves.length ? 500 : 200);
    const back = [];
    bets.forEach((zone, s) => {
      const stack = s && t.zones.get(zone)?.querySelector(`.bac-seat-stack[data-seat="${s - 1}"]`);
      if (!stack) return;
      const to = nets[s] < 0 ? rack : railSeat(s).querySelector('.crowd-avatar').getBoundingClientRect();
      if (nets[s] < 0) back.push(rake([...stack.children], rack).then(() => stack.remove()));
      else back.push(Promise.all([...stack.children].map((c, i) => flyTo(c, to, { duration: 420, delay: i * 30, lift: 50, fade: true }))).then(() => stack.remove()));
    });
    await Promise.all(back);
  }

  function setRoomScore(side, value) {
    const node = score(side);
    node.textContent = value ?? '–';
    if (value !== null && value !== undefined) animate(node, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, fill: 'none' });
  }

  async function roomEvents(events) {
    for (const e of events) {
      if (e.type === 'turn') {
        mark(e.seat);
        if (e.seat === 0) buzz('step');
        await wait(e.seat > 0 ? 200 : 60);
      } else if (e.type === 'bet') {
        if (e.seat === 0) { await t.addFromTray(e.side, rv.stake); t.syncBalance(); }
        else {
          seatStack(e.seat, e.side);
          if (!e.timeout && Math.random() < 0.5) bubble(railSeat(e.seat), `${SIDE_NAME[e.side]}!`, 1400);
          await wait(320);
        }
      } else if (e.type === 'deal') {
        if (!hand(e.side).children.length && e.side === 'PLAYER') mark(-1);
        await dealCard(hand(e.side), 'HIDDEN', shoe, { faceUp: false });
      } else if (e.type === 'open') {
        await wait(200);
        const cards = [...hand(e.side).querySelectorAll('.card')].slice(0, 2);
        for (const [i, card] of cards.entries()) await flipCard(card, e.cards[i]);
        setRoomScore(e.side, e.score);
      } else if (e.type === 'third') {
        await wait(450);
        const card = await dealCard(hand(e.side), 'HIDDEN', shoe, { faceUp: false, rotate: true });
        await flipCard(card, e.card);
        setRoomScore(e.side, e.score);
      } else if (e.type === 'end') await roomEnd(e);
    }
  }

  async function roomEnd(e) {
    mark(-1);
    await wait(300);
    if (e.winner !== 'TIE') side(e.winner).classList.add('is-winner');
    addRoad(e.winner);
    voice.say(e.winner === 'TIE' ? 'tie' : e.winner === 'PLAYER' ? 'player-wins' : 'banker-wins');
    await settleSeats(e.bets, e.nets);
    const mine = e.bets[0], net = e.nets[0];
    const label = `${e.winner === 'TIE' ? 'Tie' : `${SIDE_NAME[e.winner]} wins`} · ${e.playerScore} : ${e.bankerScore}`;
    if (mine) await t.settle(net, { label, zones: new Map([[mine, net]]) });
    t.locked = true;
    await t.syncBalance();
  }

  async function clearCards() {
    if (hand('PLAYER').children.length || hand('BANKER').children.length) await gatherCards([hand('PLAYER'), hand('BANKER')], discard, { at: t.body.querySelector('.bac-sides').getBoundingClientRect() });
    ['PLAYER', 'BANKER'].forEach(s => { score(s).textContent = '–'; side(s).classList.remove('is-winner'); });
  }
  function clearSeatStacks() {
    t.body.querySelectorAll('.bac-seat-stack, .npc-stack').forEach(n => n.remove());
  }

  async function roomBegin(res) {
    rv = res.round;
    await clearCards();
    if (needsShuffle(discard, 48)) await riffle(t.felt, { shoe, discard, at: t.body.querySelector('.bac-sides').getBoundingClientRect() });
    clearSeatStacks();
    t.resetRound(); t.locked = true; t.root.classList.add('is-playing');
    railSeats(rv);
    await roomEvents(res.events);
    rv = res.round;
    mark(rv.status === 'PLAYING' ? rv.turn : -1);
  }
  async function roomApply(res) {
    if (!rv) return roomSnapshot(res.round);
    await roomEvents(res.events);
    rv = res.round;
    mark(rv.status === 'PLAYING' ? rv.turn : -1);
  }
  async function roomSnapshot(v) {
    await roomClear();
    paintRoad(room.view?.road);
    if (v.status !== 'PLAYING') return;
    rv = v;
    t.locked = true; t.root.classList.add('is-playing');
    railSeats(v);
    v.seats.forEach((x, s) => { if (!x.bet) return; if (s) seatStack(s, x.bet, { fly: false }); else { t.placeLocked(x.bet, v.stake); t.refreshBet(); } });
    placeCards(hand('PLAYER'), v.player);
    placeCards(hand('BANKER'), v.banker);
    setRoomScore('PLAYER', v.playerScore);
    setRoomScore('BANKER', v.bankerScore);
    mark(v.turn);
  }
  async function roomClear() {
    rv = null;
    await clearCards();
    clearSeatStacks();
    t.resetRound();
    seated = [];
    rail.replaceChildren();
    // The house regulars step aside while friends hold the table, and come back after.
    const inRoom = Boolean(room?.active);
    rail.hidden = !inRoom;
    if (crowdRail) {
      crowdRail.hidden = inRoom;
      crowd.seats.forEach(n => { clearTimeout(n.timer); n.bets = []; });
      if (!inRoom && !t.locked) crowd.open();
    }
    if (!inRoom) road.replaceChildren();
  }
  function paintRoad(list) {
    if (!Array.isArray(list)) return;
    road.replaceChildren(...list.slice(-14).reverse().map(roadDot));
  }

  // My turn: back a side, with the buttons or the spots themselves.
  const myTurn = () => rv?.status === 'PLAYING' && rv.turn === 0 && Boolean(rv.options);
  const send = action => { buzz('chip'); return room.act({ action }); };
  function roomActions() {
    t.root.classList.toggle('is-my-bet', myTurn());
    if (!rv || rv.status !== 'PLAYING') { t.setActions(room.idleActions()); t.hint(''); return; }
    if (!myTurn()) {
      t.setActions([room.leaveAction(), { label: `${rv.seats[rv.turn]?.name || '다른 사람'} 차례`, ghost: true, disabled: true }]);
      t.hint('');
      return;
    }
    t.hint(`${formatCH(rv.stake)}을 걸 곳을 고르세요`);
    t.setActions(['PLAYER', 'TIE', 'BANKER'].map(z => ({ label: SIDE_NAME[z], primary: z !== 'TIE', onClick: () => send(z) })));
  }
  // In a room a tap on a spot is my pick.
  t.body.querySelectorAll('.bac-zones [data-zone]').forEach(z => z.addEventListener('click', () => {
    if (room?.active && myTurn() && !t.busy) t.run(() => send(z.dataset.zone));
  }));

  room = createRoomClient(t, 'baccarat', {
    label: '바카라', word: '베팅', sizes: [2, 3, 4, 5], size: 4,
    stake: () => { const z = mainZone(); return z ? t.zoneTotal(z) : 0; },
    soloBusy: () => t.locked,
    begin: roomBegin, apply: roomApply, snapshot: roomSnapshot, refreshActions,
    clear: roomClear
  });
  const friendsBtn = t.body.querySelector('[data-friends-open]');
  friendsBtn.addEventListener('click', () => { sound.tick(); room.open(); });
  if (ev) friendsBtn.hidden = true;
  const destroyRoom = t.destroy.bind(t);
  t.destroy = () => { room.stop(); return destroyRoom(); };

  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  refreshActions();
  crowd.open();
  if (!ev) await room.resume().catch(() => false);
  refreshActions();
  return t;
}
