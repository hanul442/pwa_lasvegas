import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, createTable, startHand, applyAction, legalActions, buildPots, publicTable } from '../lib/holdem.mjs';
import { decide, equity, preflopStrength } from '../lib/holdem-bot.mjs';
import { createHoldemSession, dealNextHand, heroAction } from '../lib/holdem-session.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

const c = t => ({ r: t.slice(0, -1), s: t.slice(-1) });
const cards = s => s.split(' ').map(c);
const score = s => evaluate(cards(s)).score;

// A deck whose pop() order is the given cards (first listed is dealt first), padded with the rest.
function stackedDeck(order) {
  const used = new Set(order);
  const rest = [];
  for (const s of ['♠', '♥', '♦', '♣']) for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) if (!used.has(r + s)) rest.push(c(r + s));
  return [...rest, ...order.map(c).reverse()];
}

test('hand ranks order correctly, including the wheel and kickers', () => {
  const ladder = [
    'A♠ K♦ 9♣ 7♥ 4♠ 3♦ 2♣', // high card
    '9♠ 9♦ A♣ 7♥ 4♠ 3♦ 2♣', // pair
    '9♠ 9♦ 4♣ 4♥ A♠ 3♦ 2♣', // two pair
    '9♠ 9♦ 9♣ 7♥ 4♠ 3♦ 2♣', // trips
    'A♠ 2♦ 3♣ 4♥ 5♠ 9♦ K♣', // wheel straight
    '6♠ 2♦ 3♣ 4♥ 5♠ 9♦ K♣', // six-high straight
    'A♥ J♥ 9♥ 6♥ 2♥ 3♦ K♣', // flush
    '9♠ 9♦ 9♣ 4♥ 4♠ 3♦ 2♣', // full house
    '9♠ 9♦ 9♣ 9♥ 4♠ 3♦ 2♣', // quads
    '5♥ 4♥ 3♥ 2♥ A♥ 9♦ K♣' // steel wheel
  ];
  for (let i = 1; i < ladder.length; i++) assert.ok(score(ladder[i]) > score(ladder[i - 1]), ladder[i]);
  assert.equal(evaluate(cards(ladder[9])).name, '스트레이트 플러시');
  assert.ok(score('A♠ A♦ K♣ 7♥ 4♠') > score('A♣ A♥ Q♣ J♥ 10♠'), 'kicker decides');
  assert.equal(score('A♠ K♦ 9♣ 7♥ 4♠ 3♦ 2♣'), score('A♣ K♥ 9♦ 7♠ 4♥ 3♣ 2♦'), 'suits never break ties');
  assert.ok(score('9♠ 9♦ 9♣ 4♥ 4♠ 4♦ 2♣') > score('8♠ 8♦ 8♣ A♥ A♠ 4♦ 2♣'), 'two trips make the higher boat');
});

test('side pots split by what each player put in', () => {
  const p = (committed, folded = false) => ({ committed, folded });
  const pots = buildPots([p(100), p(300), p(300), p(50, true)]);
  assert.deepEqual(pots, [{ amount: 350, eligible: [0, 1, 2] }, { amount: 400, eligible: [1, 2] }]);
});

test('heads-up: the button posts the small blind and acts first preflop', () => {
  const t = createTable({ seats: [{ id: 'a', name: 'A', kind: 'human', stack: 1000 }, { id: 'b', name: 'B', kind: 'bot', stack: 1000 }], smallBlind: 5, bigBlind: 10, button: 0 });
  startHand(t);
  assert.equal(t.button, 0);
  assert.equal(t.hand.players[0].bet, 5);
  assert.equal(t.hand.players[1].bet, 10);
  assert.equal(t.hand.toAct, 0);
  applyAction(t, 0, { type: 'CALL' });
  assert.equal(t.hand.toAct, 1, 'big blind gets the option');
  assert.ok(legalActions(t, 1).canCheck);
  applyAction(t, 1, { type: 'CHECK' });
  assert.equal(t.hand.street, 'FLOP');
  assert.equal(t.hand.board.length, 3);
  assert.equal(t.hand.toAct, 1, 'after the flop the big blind acts first heads-up');
});

test('everyone folding to a raise hands the pot over without a showdown', () => {
  const t = createTable({ seats: ['a', 'b', 'c'].map(id => ({ id, name: id, kind: 'bot', stack: 1000 })), smallBlind: 5, bigBlind: 10, button: 0 });
  startHand(t);
  const first = t.hand.toAct;
  applyAction(t, first, { type: 'RAISE', amount: 40 });
  while (!t.hand.over) applyAction(t, t.hand.toAct, { type: 'FOLD' });
  assert.equal(t.hand.results.showdown, false);
  assert.deepEqual(t.hand.results.winners, [first]);
  assert.equal(t.seats.reduce((a, s) => a + s.stack, 0), 3000);
  assert.ok(!t.hand.events.some(e => e.t === 'show'));
});

test('raises below the minimum are refused unless they are all in', () => {
  const t = createTable({ seats: [{ id: 'a', name: 'A', kind: 'bot', stack: 1000 }, { id: 'b', name: 'B', kind: 'bot', stack: 25 }], smallBlind: 5, bigBlind: 10, button: 0 });
  startHand(t);
  assert.throws(() => applyAction(t, 0, { type: 'RAISE', amount: 15 }), /INVALID_RAISE/);
  applyAction(t, 0, { type: 'RAISE', amount: 20 });
  // B has 15 behind its 10 blind: shoving to 25 is legal even though a full raise would be 30.
  applyAction(t, 1, { type: 'ALL_IN' });
  assert.equal(t.hand.players[1].allIn, true);
  applyAction(t, 0, { type: 'CALL' });
  assert.ok(t.hand.over, 'board runs out once nobody can bet');
  assert.equal(t.hand.board.length, 5);
  assert.equal(t.seats[0].stack + t.seats[1].stack, 1025);
});

test('a short all-in wins only the side pot it covered', () => {
  // Seat 0 holds aces and is short; seat 1 beats seat 2 for the side pot.
  const t = createTable({ seats: [{ id: 'a', name: 'A', kind: 'bot', stack: 100 }, { id: 'b', name: 'B', kind: 'bot', stack: 1000 }, { id: 'c', name: 'C', kind: 'bot', stack: 1000 }], smallBlind: 5, bigBlind: 10, button: 2 });
  // button stays at 2 for hand 1; SB = 0, BB = 1. Deal order 0,1,2,0,1,2 then burn, flop, burn, turn, burn, river.
  startHand(t, stackedDeck(['A♠', 'K♠', '2♦', 'A♥', 'K♥', '7♣', '3♣', '9♦', 'J♣', '4♥', '5♠', 'Q♦', '8♣', '6♥']));
  assert.deepEqual(t.hand.players[0].cards.map(x => x.r + x.s), ['A♠', 'A♥']);
  applyAction(t, 2, { type: 'RAISE', amount: 300 });
  applyAction(t, 0, { type: 'ALL_IN' });
  applyAction(t, 1, { type: 'CALL' });
  while (!t.hand.over) applyAction(t, t.hand.toAct, legalActions(t, t.hand.toAct).canCheck ? { type: 'CHECK' } : { type: 'CALL' });
  const won = t.hand.results.won;
  assert.equal(won[0], 300, 'main pot: 100 from each of three players');
  assert.equal(won[1], 400, 'side pot: 200 more from B and C');
  assert.equal(won[2], 0);
  assert.equal(t.seats.reduce((a, s) => a + s.stack, 0), 2100);
});

test('thousands of bot hands conserve every chip and always finish', () => {
  for (let g = 0; g < 60; g++) {
    const n = 2 + (g % 5);
    const t = createTable({ seats: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}`, kind: 'bot', stack: 200 + i * 37, style: ['ROCK', 'SHARK', 'STATION', 'MANIAC'][i % 4] })), smallBlind: 5, bigBlind: 10 });
    const total = t.seats.reduce((a, s) => a + s.stack, 0);
    for (let k = 0; k < 40 && t.seats.filter(s => s.stack > 0).length > 1; k++) {
      startHand(t);
      let guard = 0;
      while (!t.hand.over) { assert.ok(++guard < 500); applyAction(t, t.hand.toAct, decide(t, t.hand.toAct)); }
      assert.equal(t.seats.reduce((a, s) => a + s.stack, 0), total);
      assert.ok(t.seats.every(s => s.stack >= 0));
      assert.equal(t.hand.events.at(-1).t, 'end');
    }
  }
});

test('the public view hides other hole cards until they are shown', () => {
  const session = createHoldemSession({ userId: 'me', nickname: 'ME', buyIn: 500_000, tier: 'low', opponents: 3, floor: 'downtown' });
  dealNextHand(session);
  const view = publicTable(session.table, 0);
  assert.equal(view.seats[0].cards.length, 2);
  assert.ok(view.seats[0].cards.every(x => x !== 'HIDDEN'));
  const shown = new Set(session.table.hand.events.filter(e => e.t === 'show').map(e => e.seat));
  view.seats.slice(1).forEach((s, k) => { if (!shown.has(k + 1) && s.inHand) assert.deepEqual(s.cards, ['HIDDEN', 'HIDDEN']); });
  assert.ok(!JSON.stringify(view).includes('deck'));
});

test('bots read hand strength sensibly', () => {
  assert.ok(preflopStrength(cards('A♠ A♦')) > preflopStrength(cards('7♠ 2♦')));
  assert.ok(preflopStrength(cards('A♠ K♠')) > preflopStrength(cards('A♠ 7♦')));
  assert.ok(equity(cards('A♠ A♦'), [], 1, 400) > 0.75);
  assert.ok(equity(cards('K♠ K♣'), cards('A♣ A♥ K♦'), 1, 400) > 0.9);
  assert.ok(equity(cards('7♠ 2♦'), cards('A♣ A♥ K♦'), 1, 400) < 0.4);
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
const call = (store, method, path, body, key = `k-holdem-${++n}`) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? key : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('sitting locks the buy-in, playing moves the stack and standing up settles the difference', async () => {
  const store = memoryStore();
  const start = store.peek().users.hanseo.account.available;
  const sit = await call(store, 'POST', '/api/holdem/sit', { buyIn: 500_000, floor: 'downtown', opponents: 3 });
  assert.equal(sit.status, 200, JSON.stringify(sit.data));
  assert.equal(sit.data.state.user.account.available, start - 500_000);
  assert.equal(sit.data.state.user.account.locked, 500_000);
  assert.equal(sit.data.session.table.seats.length, 4);
  assert.equal(sit.data.events[0].t, 'hand');
  assert.equal((await call(store, 'POST', '/api/holdem/sit', { buyIn: 500_000, floor: 'downtown' })).data.error, 'OPEN_HOLDEM_SESSION');

  let session = sit.data.session;
  for (let hand = 0; hand < 4 && session.status === 'SEATED'; hand++) {
    while (session.status === 'SEATED' && !session.table.handOver) {
      const t = session.table;
      const res = await call(store, 'POST', '/api/holdem/action', { sessionId: session.id, handNo: t.handNo, seq: t.seq, action: t.legal.canCheck ? 'CHECK' : 'CALL' });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      session = res.data.session;
    }
    if (session.status !== 'SEATED') break;
    const next = await call(store, 'POST', '/api/holdem/next', { sessionId: session.id, handNo: session.table.handNo });
    assert.equal(next.status, 200, JSON.stringify(next.data));
    session = next.data.session;
  }
  if (session.status === 'SEATED') {
    const leave = await call(store, 'POST', '/api/holdem/leave', { sessionId: session.id });
    assert.equal(leave.status, 200);
    session = leave.data.session;
  }
  const after = store.peek().users.hanseo.account;
  assert.equal(session.status, 'SETTLED');
  assert.equal(after.locked, 0);
  assert.equal(after.available, start + session.netPnl);
  assert.equal((await call(store, 'GET', '/api/holdem/open')).data.session, null);
});

test('a replayed action is applied once and a stale one is refused', async () => {
  const store = memoryStore();
  const sit = await call(store, 'POST', '/api/holdem/sit', { buyIn: 500_000, floor: 'downtown', opponents: 1 });
  let session = sit.data.session;
  // Heads-up hands can end before the person acts (bot folds); deal until it's our turn.
  while (session.table.handOver) session = (await call(store, 'POST', '/api/holdem/next', { sessionId: session.id, handNo: session.table.handNo })).data.session;
  const body = { sessionId: session.id, handNo: session.table.handNo, seq: session.table.seq, action: 'FOLD' };
  const first = await call(store, 'POST', '/api/holdem/action', body, 'k-same-fold-1');
  const again = await call(store, 'POST', '/api/holdem/action', body, 'k-same-fold-1');
  assert.equal(again.data.replayed, true);
  assert.deepEqual(again.data.events, first.data.events);
  assert.equal(again.data.state.user.account.available, first.data.state.user.account.available);
  const stale = await call(store, 'POST', '/api/holdem/action', body);
  assert.equal(stale.status, 409);
});

test('buy-ins outside the table limits are refused before any chips move', async () => {
  const store = memoryStore();
  const before = store.peek().users.hanseo.account.available;
  const res = await call(store, 'POST', '/api/holdem/sit', { buyIn: 1_000, floor: 'downtown' });
  assert.equal(res.status, 400);
  assert.equal(store.peek().users.hanseo.account.available, before);
});
