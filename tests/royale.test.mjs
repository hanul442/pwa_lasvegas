import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { during, holdings } from './event-clock.mjs';
import { createHoldemSession, dealNextHand, heroAction, royaleAfterHand, royaleRebuy, royaleBlinds, ROYALE, holdemPublic, standUp } from '../lib/holdem-session.mjs';

function seededRand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// The hero goes all in every hand, so tournaments end quickly one way or the other.
function playOut(seed, { rebuy = true } = {}) {
  const rand = seededRand(seed);
  const s = createHoldemSession({ userId: 'u1', nickname: '본드', buyIn: 1_000_000, tier: 'gold-room', floor: 'gold-room', royale: true }, rand);
  const total = () => s.table.seats.reduce((a, x) => a + x.stack, 0) + (s.table.hand && !s.table.hand.over ? 0 : 0);
  for (let i = 0; i < 400 && s.status === 'SEATED'; i++) {
    if (s.royale.canRebuy) { if (rebuy) royaleRebuy(s); else { standUp(s); break; } }
    dealNextHand(s, rand);
    for (let g = 0; g < 50 && s.table.hand && !s.table.hand.over && s.table.hand.toAct === 0; g++) heroAction(s, { type: 'ALL_IN' }, rand);
    royaleAfterHand(s);
    if (s.table.hand?.over) assert.equal(total(), s.royale.entry * (6 + s.royale.rebuys), 'chips are conserved');
  }
  return s;
}

test('Casino Royale seats five named rivals with equal stacks and rising blinds', () => {
  const s = createHoldemSession({ userId: 'u1', nickname: '본드', buyIn: 100_000_000, tier: 'salon-prive', floor: 'salon-prive', royale: true }, seededRand(1));
  assert.equal(s.table.seats.length, 6);
  assert.ok(s.table.seats.every(x => x.stack === 100_000_000));
  assert.equal(s.table.seats[1].name, '르 시프르');
  assert.equal(s.table.bigBlind, 100_000_000 / ROYALE.depth);
  assert.ok(royaleBlinds(100_000_000, 3).big > royaleBlinds(100_000_000, 2).big);
  assert.equal(royaleBlinds(100_000_000, 1).big % 2_000_000, 0, 'blinds stay in 200만s so the small blind is a whole 100만');
  assert.equal(royaleBlinds(1_000_000, 0).big, 2_000_000, 'never under 100만/200만');
  const v = holdemPublic(s);
  assert.equal(v.royale.prize, 1_000_000_000, 'the pot of six buy-ins plus the champion bonus of four');
  assert.equal(v.royale.level, 1);
});

test('a Royale tournament always ends with a place, and the winner takes the whole table', () => {
  let wins = 0, losses = 0;
  for (let seed = 1; seed < 60; seed++) {
    const s = playOut(seed);
    assert.equal(s.status, 'SETTLED', `seed ${seed}`);
    assert.ok(s.royale.place >= 1 && s.royale.place <= 6);
    if (s.royale.place === 1) { wins++; assert.equal(s.cashOut, s.royale.entry * (6 + s.royale.rebuys)); }
    else { losses++; assert.equal(s.cashOut, 0); assert.equal(s.netPnl, -s.buyIn); }
    assert.ok(s.royale.rebuys <= 1);
  }
  assert.ok(wins > 0 && losses > 0, `wins ${wins}, losses ${losses}`);
});

test('leaving a Royale table early forfeits the seat', () => {
  const rand = seededRand(7);
  const s = createHoldemSession({ userId: 'u1', nickname: '본드', buyIn: 1_000_000, tier: 'gold-room', floor: 'gold-room', royale: true }, rand);
  dealNextHand(s, rand);
  standUp(s);
  assert.equal(s.cashOut, 0);
  assert.equal(s.netPnl, -1_000_000);
  assert.ok(s.royale.forfeit);
});

function memoryStore() {
  let state = defaultState();
  let queue = Promise.resolve();
  return {
    peek: () => state,
    load: async () => structuredClone(state),
    mutate(fn) { const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; }); queue = task.catch(() => {}); return task; }
  };
}
let n = 0;
const call = (store, method, path, body) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? `k-room-${++n}` : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('the Royale API takes the fixed 100억 entry at the event table and settles the ledger cleanly', during('royale', async () => {
  const store = memoryStore();
  const first = (await call(store, 'GET', '/api/state')).data;
  assert.ok(Array.isArray(first.events));
  assert.deepEqual(first.eventEntry, { floor: 'penthouse', entry: 10_000_000_000 });
  holdings(store, 9_000_000_000);
  assert.equal((await call(store, 'POST', '/api/holdem/sit', { buyIn: 10_000_000_000, floor: 'penthouse', royale: true })).status, 409, 'under 100억 cannot sit');
  holdings(store, 20_000_000_000);
  assert.equal((await call(store, 'POST', '/api/holdem/sit', { buyIn: 100_000_000, floor: 'high-limit', royale: true })).status, 400, 'only at the event table');
  assert.equal((await call(store, 'POST', '/api/holdem/sit', { buyIn: 5_000_000_000, floor: 'penthouse', royale: true })).status, 400, 'entry must be the maximum');
  let res = await call(store, 'POST', '/api/holdem/sit', { buyIn: 10_000_000_000, floor: 'penthouse', royale: true });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.session.royale.prize, 100_000_000_000);
  res = await call(store, 'POST', '/api/holdem/leave', { sessionId: res.data.session.id });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.state.user.account.locked, 0);
  assert.equal(res.data.state.user.account.available, 10_000_000_000);
}));
