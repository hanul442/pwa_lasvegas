import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluate, createTable, startHand, applyAction, legalActions, publicTable, potTotal, leadSeat, MAX_RAISES } from '../lib/sevenpoker.mjs';
import { decide, studEquity, pickOpen } from '../lib/sevenpoker-bot.mjs';
import { createSevenSession, dealNextHand, heroAction, SEVEN_ANTES } from '../lib/sevenpoker-session.mjs';
import { MONEY_UNIT, isMoney } from '../lib/constants.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

const U = MONEY_UNIT;
const c = t => ({ r: t.slice(0, -1), s: t.slice(-1) });
const cards = s => s.split(' ').map(c);
const text = x => x.r + x.s;
function stackedDeck(order) {
  const used = new Set(order);
  const rest = [];
  for (const s of ['♠', '♥', '♦', '♣']) for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) if (!used.has(r + s)) rest.push(c(r + s));
  return [...rest, ...order.map(c).reverse()];
}
const seats = (stacks, kind = 'bot') => stacks.map((stack, i) => ({ id: `s${i}`, name: `S${i}`, kind, stack, style: ['ROCK', 'SHARK', 'STATION', 'MANIAC'][i % 4] }));
const checkAround = t => { while (!t.hand.over) { const l = legalActions(t, t.hand.toAct); applyAction(t, t.hand.toAct, { type: l.canCheck ? 'CHECK' : 'CALL' }); } };

test('everyone antes, gets three cards face down and turns one up before 4th street', () => {
  const t = createTable({ seats: seats([50 * U, 50 * U, 50 * U]), ante: U, unit: U });
  startHand(t);
  const h = t.hand;
  assert.equal(h.phase, 'CHOOSE');
  assert.equal(potTotal(t), 3 * U);
  assert.ok(h.players.every(p => p.cards.length === 3 && p.up.every(u => !u) && p.bet === 0));
  assert.deepEqual(h.events.map(e => e.t), ['hand', 'blind', 'blind', 'blind', 'collect', 'deal3']);
  assert.throws(() => applyAction(t, 0, { type: 'CHECK' }), /CHOOSE_FIRST/);
  assert.throws(() => applyAction(t, 0, { type: 'OPEN', index: 3 }), /INVALID_OPEN/);
  const picked = text(h.players[0].cards[0]);
  applyAction(t, 0, { type: 'OPEN', index: 0 });
  assert.equal(text(h.players[0].cards[2]), picked, 'the open card moves to the third place');
  assert.throws(() => applyAction(t, 0, { type: 'OPEN', index: 1 }), /ALREADY_CHOSEN/);
  // The others' cards stay hidden from seat 0 until they open them.
  const v = publicTable(t, 0);
  assert.deepEqual(v.seats[1].cards, ['HIDDEN', 'HIDDEN', 'HIDDEN']);
  assert.equal(v.seats[0].cards.filter(x => x === 'HIDDEN').length, 0);
  assert.equal(v.legal, null, 'seat 0 has chosen and waits for the others');
  applyAction(t, 1, { type: 'OPEN', index: 2 });
  assert.deepEqual(publicTable(t, 0).seats[1].cards, ['HIDDEN', 'HIDDEN', 'HIDDEN'], 'a chosen card stays down until everyone has chosen');
  assert.deepEqual(publicTable(t, 0).seats[1].up, [false, false, false]);
  applyAction(t, 2, { type: 'OPEN', index: 1 });
  assert.equal(h.phase, 'BET');
  assert.equal(h.street, 4);
  assert.ok(h.players.every(p => p.cards.length === 4 && p.up.join() === 'false,false,true,true'));
  const open = h.events.find(e => e.t === 'open');
  assert.equal(open.cards.length, 3);
  const v2 = publicTable(t, 0);
  assert.equal(v2.seats[1].cards.filter(x => x === 'HIDDEN').length, 2, 'two hole cards hidden, two open');
  assert.ok(!JSON.stringify(v2).includes('deck'));
});

test('the best open hand bets first, ties go to the higher suit, and 7th street comes face down', () => {
  // Deal order: three passes round seats 0,1,2; then each street from the lead (seat 0 on 4th).
  const t = createTable({ seats: seats([100 * U, 100 * U, 100 * U]), ante: U, unit: U });
  startHand(t, stackedDeck([
    '9♣', '7♦', '5♣', '10♦', '8♦', '6♦', '2♣', 'K♠', 'K♦', // first three: open the third card
    '3♦', '4♣', '4♥', // 4th: K♠4♣ and K♦4♥ tie on rank, the spade leads
    '2♦', '2♥', '3♥', // 5th from seat 1: seat 1 gets 2♦, seat 2 gets 2♥, seat 0 pairs its threes
    'A♠', 'A♦', 'A♣', // 6th from seat 0
    'J♠', 'J♦', 'J♣' // 7th hidden
  ]));
  for (const i of [0, 1, 2]) applyAction(t, i, { type: 'OPEN', index: 2 });
  assert.equal(t.hand.toAct, 1, 'K♠ beats K♦ by suit');
  assert.equal(leadSeat(t), 1);
  const street = t.hand.events.filter(e => e.t === 'street').at(-1);
  assert.equal(street.lead, 1);
  assert.equal(street.showing[1], '하이카드');
  checkStreet(t);
  assert.equal(t.hand.street, 5);
  assert.equal(t.hand.toAct, 0, 'a pair of open threes now leads');
  assert.equal(t.hand.events.filter(e => e.t === 'street').at(-1).showing[0], '원페어');
  checkStreet(t);
  checkStreet(t);
  assert.equal(t.hand.street, 7);
  const hidden = t.hand.events.filter(e => e.t === 'street').at(-1);
  assert.equal(hidden.up, false);
  assert.ok(hidden.cards.every(x => x.card === 'HIDDEN'));
  const v = publicTable(t, 1);
  assert.equal(v.seats[0].cards[6], 'HIDDEN');
  assert.notEqual(v.seats[1].cards[6], 'HIDDEN');
  checkStreet(t);
  assert.ok(t.hand.over);
  assert.equal(t.hand.events.filter(e => e.t === 'show').length, 3);
  // Seat 0 has a pair of threes; seat 1 holds 7♦ 8♦ 2♦ A♦ J♦, a diamond flush.
  assert.deepEqual(t.hand.results.winners, [1]);
  assert.equal(t.hand.events.find(e => e.t === 'win').hand, '플러시');
  assert.equal(t.seats.reduce((a, s) => a + s.stack, 0), 300 * U);
});
function checkStreet(t) {
  const street = t.hand.street;
  while (!t.hand.over && t.hand.street === street) applyAction(t, t.hand.toAct, { type: 'CHECK' });
}

test('Korean bet sizes: 삥, 쿼터, 하프, 따당, all in money units, and a cap per street', () => {
  const t = createTable({ seats: seats([100 * U, 100 * U, 100 * U]), ante: U, unit: U });
  startHand(t);
  for (const i of [0, 1, 2]) applyAction(t, i, { type: 'OPEN', index: 0 });
  const first = t.hand.toAct;
  let l = legalActions(t, first);
  const opt = a => l.options.find(o => o.action === a);
  // A quarter of a 3 unit pot rounds up to one unit, the same as a 삥: it shows once, as 삥.
  assert.deepEqual(l.options.map(o => o.action), ['FOLD', 'CHECK', 'BBING', 'HALF']);
  assert.equal(opt('BBING').to, U, '삥 is the ante');
  assert.equal(opt('HALF').to, 2 * U, 'half of 3 rounds up to 2');
  applyAction(t, first, { type: 'HALF' });
  const second = t.hand.toAct;
  l = legalActions(t, second);
  assert.deepEqual(l.options.map(o => o.action), ['FOLD', 'CALL', 'DDADANG', 'HALF'], 'call 2 + a quarter of 7 (2) is the 따당 amount');
  assert.equal(opt('CALL').cost, 2 * U);
  assert.equal(opt('DDADANG').to, 4 * U, '따당 doubles the bet');
  assert.equal(opt('HALF').to, 2 * U + 4 * U, 'half: call 2, then half of the 7 unit pot (rounded up to 4) on top');
  for (const o of l.options) assert.ok(isMoney(o.to) || o.to === 0, o.action);
  applyAction(t, second, { type: 'DDADANG' });
  l = legalActions(t, t.hand.toAct);
  assert.equal(opt('DDADANG').to, 8 * U);
  assert.equal(opt('QUARTER'), undefined, 'call 4, then a quarter of 13 (4) lands on the 따당 amount');
  applyAction(t, t.hand.toAct, { type: 'HALF' });
  assert.equal(t.hand.raises, MAX_RAISES);
  l = legalActions(t, t.hand.toAct);
  assert.deepEqual(l.options.map(o => o.action), ['FOLD', 'CALL'], 'capped: call or die');
  assert.throws(() => applyAction(t, t.hand.toAct, { type: 'HALF' }), /INVALID_ACTION/);
  applyAction(t, t.hand.toAct, { type: 'DIE' });
  applyAction(t, t.hand.toAct, { type: 'CALL' });
  assert.equal(t.hand.street, 5);
  l = legalActions(t, t.hand.toAct);
  assert.equal(l.pot, 27 * U, 'antes 3, the 다이 player\'s 2, and 11 each from the two left');
  assert.equal(opt('QUARTER').to, 7 * U, 'a quarter of the 27 unit pot, rounded up');
  assert.equal(opt('HALF').to, 14 * U);
});

test('a short all-in wins only the main pot it covered; the side pot goes to the best of the rest', () => {
  const t = createTable({ seats: seats([6 * U, 100 * U, 100 * U]), ante: U, unit: U });
  startHand(t, stackedDeck([
    '9♠', 'A♠', 'K♠', '9♦', 'A♦', 'K♦', '9♣', '2♣', '3♣',
    '4♥', '6♥', '8♣', 'J♠', 'Q♦', '2♦', '7♣', '10♥', '5♠', '3♦', '4♣', '6♠'
  ]));
  for (const i of [0, 1, 2]) applyAction(t, i, { type: 'OPEN', index: 2 });
  // Seat 0 bets the biggest size every time until it is all in; seat 1 keeps betting a 삥 once
  // it is, and seat 2 calls everything.
  while (!t.hand.over) {
    const i = t.hand.toAct;
    const l = legalActions(t, i);
    const has = a => l.options.some(o => o.action === a);
    if (i === 0) applyAction(t, 0, { type: l.options.at(-1).action });
    else if (i === 1 && t.hand.players[0].allIn && has('BBING')) applyAction(t, 1, { type: 'BBING' });
    else applyAction(t, i, { type: l.canCheck ? 'CHECK' : 'CALL' });
  }
  const p = t.hand.players;
  assert.equal(p[0].committed, 6 * U);
  assert.ok(p[1].committed > 6 * U, 'a side pot was built');
  const score = i => evaluate(p[i].cards).score;
  const won = t.hand.results.won;
  const side = p[1].committed - 6 * U + p[2].committed - 6 * U;
  const mainWinner = [0, 1, 2].reduce((a, b) => (score(b) > score(a) ? b : a));
  const sideWinner = score(1) >= score(2) ? 1 : 2;
  assert.equal(score(0) > score(1) && score(0) > score(2), true, 'the stacked deck gives the short stack the best hand');
  assert.equal(won[mainWinner], 18 * U, 'main pot: six units from each of three');
  assert.equal(won[sideWinner], side);
  assert.equal(t.seats.reduce((a, s) => a + s.stack, 0), 206 * U);
  assert.ok(t.hand.events.filter(e => e.t === 'win').every(e => isMoney(e.amount)));
});

test('bots only ever make offered moves; chips are conserved and every amount is whole 100만s', () => {
  for (let g = 0; g < 40; g++) {
    const count = 3 + (g % 3);
    const t = createTable({ seats: seats(Array.from({ length: count }, (_, i) => (20 + i * 7) * U)), ante: U, unit: U, level: g % 6 });
    const total = t.seats.reduce((a, s) => a + s.stack, 0);
    for (let k = 0; k < 15 && t.seats.filter(s => s.stack > 0).length > 1; k++) {
      startHand(t);
      let guard = 0;
      while (!t.hand.over) {
        assert.ok(++guard < 400);
        const h = t.hand;
        const i = h.phase === 'CHOOSE' ? h.players.findIndex(p => p && !p.folded && !p.chosen) : h.toAct;
        const l = legalActions(t, i);
        const move = decide(t, i);
        if (l.phase === 'CHOOSE') assert.equal(move.type, 'OPEN');
        else assert.ok(l.options.some(o => o.action === move.type), `${move.type} offered`);
        applyAction(t, i, move);
      }
      assert.equal(t.seats.reduce((a, s) => a + s.stack, 0), total);
      assert.ok(t.seats.every(s => s.stack >= 0 && isMoney(s.stack) || s.stack === 0));
      assert.ok(t.hand.events.every(e => (e.amount === undefined || isMoney(e.amount)) && (e.bet === undefined || isMoney(e.bet) || e.bet === 0)));
      assert.equal(t.hand.events.at(-1).t, 'end');
    }
  }
});

test('bots read seven-card hands sensibly and keep a pair hidden', () => {
  assert.ok(studEquity(cards('A♠ A♦ A♣ K♠'), [cards('7♦ 2♣')], [], 300) > 0.8);
  assert.ok(studEquity(cards('7♠ 2♦ 9♣ 4♥'), [cards('A♦ A♣')], [], 300) < 0.3);
  assert.equal(pickOpen(cards('Q♠ 5♦ Q♣'), 1, () => 0), 1, 'show the odd card, keep the queens');
  assert.equal(pickOpen(cards('9♠ 3♦ K♣'), 1, () => 0), 1, 'nothing to hide: show the lowest');
});

test('a session seats two to four bots, antes by the floor, and bots open their cards themselves', () => {
  assert.equal(SEVEN_ANTES['gold-room'], U);
  assert.throws(() => createSevenSession({ userId: 'me', nickname: 'ME', buyIn: 50 * U, tier: 'high-limit', opponents: 5, floor: 'high-limit' }), /INVALID_OPPONENTS/);
  assert.throws(() => createSevenSession({ userId: 'me', nickname: 'ME', buyIn: 5 * U, tier: 'high-limit', opponents: 3, floor: 'high-limit' }), /BET_OUTSIDE_TABLE_LIMIT/);
  const s = createSevenSession({ userId: 'me', nickname: 'ME', buyIn: 50 * U, tier: 'high-limit', opponents: 3, floor: 'high-limit' });
  dealNextHand(s);
  const h = s.table.hand;
  assert.equal(h.phase, 'CHOOSE');
  assert.ok(h.players.slice(1).every(p => p.chosen), 'bots chose at the deal');
  assert.equal(h.players[0].chosen, false);
  heroAction(s, { type: 'OPEN', index: 1 });
  assert.ok(s.table.hand.over || s.table.hand.toAct === 0, 'bots play on until it is my turn');
});

// ---------- API ----------
function memoryStore() {
  let state = defaultState();
  let queue = Promise.resolve();
  return {
    peek: () => state,
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; });
      queue = task.catch(() => {});
      return task;
    }
  };
}
let n = 0;
const call = (store, method, path, body, key = `k-sevenpoker-${++n}`) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? key : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('7포커 API: sitting locks the buy-in, hands play through and standing up settles the difference', async () => {
  const store = memoryStore();
  const start = store.peek().users.hanseo.account.available;
  const sit = await call(store, 'POST', '/api/sevenpoker/sit', { buyIn: 50 * U, floor: 'high-limit', opponents: 3 });
  assert.equal(sit.status, 200, JSON.stringify(sit.data));
  assert.equal(sit.data.state.user.account.locked, 50 * U);
  assert.equal(sit.data.session.table.seats.length, 4);
  assert.equal(sit.data.session.table.phase, 'CHOOSE');
  assert.equal((await call(store, 'POST', '/api/sevenpoker/sit', { buyIn: 50 * U, floor: 'high-limit' })).data.error, 'OPEN_SEVENPOKER_SESSION');
  assert.equal((await call(store, 'GET', '/api/sevenpoker/open')).data.session.id, sit.data.session.id);
  let session = sit.data.session;
  for (let hand = 0; hand < 4 && session.status === 'SEATED'; hand++) {
    while (session.status === 'SEATED' && !session.table.handOver) {
      const t = session.table;
      const l = t.legal;
      assert.ok(l, 'it is my move whenever the hand waits');
      const body = { sessionId: session.id, handNo: t.handNo, seq: t.seq };
      if (l.phase === 'CHOOSE') Object.assign(body, { action: 'OPEN', index: 0 });
      else body.action = l.canCheck ? 'CHECK' : 'CALL';
      const res = await call(store, 'POST', '/api/sevenpoker/action', body);
      assert.equal(res.status, 200, JSON.stringify(res.data));
      session = res.data.session;
    }
    if (session.status !== 'SEATED') break;
    const next = await call(store, 'POST', '/api/sevenpoker/next', { sessionId: session.id, handNo: session.table.handNo });
    assert.equal(next.status, 200, JSON.stringify(next.data));
    session = next.data.session;
  }
  if (session.status === 'SEATED') session = (await call(store, 'POST', '/api/sevenpoker/leave', { sessionId: session.id })).data.session;
  const after = store.peek().users.hanseo.account;
  assert.equal(session.status, 'SETTLED');
  assert.equal(after.locked, 0);
  assert.equal(after.available, start + session.netPnl);
  assert.ok(isMoney(session.netPnl) || session.netPnl === 0);
  assert.equal((await call(store, 'GET', '/api/sevenpoker/open')).data.session, null);
  const row = store.peek().ledger.filter(x => x.referenceId === session.id).at(-1);
  assert.equal(row.metadata.game, 'Seven Poker');
});

test('7포커 API refuses a stale move and a table on a floor that is not open', async () => {
  const store = memoryStore();
  const locked = await call(store, 'POST', '/api/sevenpoker/sit', { buyIn: 50_000 * U, floor: 'vault' });
  assert.notEqual(locked.status, 200);
  const sit = await call(store, 'POST', '/api/sevenpoker/sit', { buyIn: 50 * U, floor: 'high-limit', opponents: 2 });
  const s = sit.data.session;
  const body = { sessionId: s.id, handNo: s.table.handNo, seq: s.table.seq, action: 'OPEN', index: 2 };
  const first = await call(store, 'POST', '/api/sevenpoker/action', body, 'k-sevenpoker-same');
  const again = await call(store, 'POST', '/api/sevenpoker/action', body, 'k-sevenpoker-same');
  assert.equal(again.data.replayed, true);
  assert.deepEqual(again.data.events, first.data.events);
  assert.equal((await call(store, 'POST', '/api/sevenpoker/action', body)).status, 409);
});

test('7포커 is in the lobby with its guide, music, art and offline files', async () => {
  const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
  const [app, guides, sw, names, music, api] = await Promise.all(['app.js', 'js/guides.js', 'sw.js', 'js/names.js', 'js/music.js', 'js/api.js'].map(read));
  assert.match(app, /id: 'sevenpoker', name: '7포커'.*mount: lazyGame\('sevenpoker', 'mountSevenPoker'\)/);
  assert.match(guides, /\n  sevenpoker: \{\n    id: 'sevenpoker'/);
  assert.match(sw, /'js\/games\/sevenpoker\.js'/);
  assert.match(sw, /sevenpoker/);
  assert.match(names, /sevenpoker: '7포커'/);
  assert.match(music, /\n  sevenpoker: \{ tempo: \d+, bar: pokerBar \}/);
  for (const route of ['sevenOpen', 'sevenSit', 'sevenAction', 'sevenNext', 'sevenLeave']) assert.ok(api.includes(route), route);
  await readFile(new URL('../public/art/sevenpoker.webp', import.meta.url));
});
