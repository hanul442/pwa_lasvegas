import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { EVENTS, liveEvents } from '../lib/events.mjs';
import { trackEventStreak } from '../lib/event-bonus.mjs';
import { createHoldemSession, ROUNDERS } from '../lib/holdem-session.mjs';

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
const live = id => liveEvents().some(e => e.id === id);

test('every event names a lobby game, a window and its rules', () => {
  const games = new Set(['poker', 'gostop', 'blackjack', 'baccarat']);
  for (const e of EVENTS) {
    assert.ok(games.has(e.game), e.id);
    assert.ok(Date.parse(e.until) > Date.parse(e.from), e.id);
    assert.ok(e.rules.length > 0 && e.title && e.blurb, e.id);
  }
  assert.deepEqual(liveEvents(Date.parse('2030-01-01')), []);
});

test('a streak bonus pays at the target, resets on a loss and ignores pushes', () => {
  if (!live('oceans')) return;
  const state = defaultState();
  const user = Object.values(state.users)[0];
  const before = user.account.available;
  const step = net => trackEventStreak(state, user, { event: 'oceans', net, floorMin: 100, roundId: `r${++n}` });
  step(1); step(1); step(0);
  assert.equal(step(-1).streak, 0);
  let last;
  for (let i = 0; i < 5; i++) last = step(1);
  assert.equal(last.bonus, 1000);
  assert.equal(last.streak, 0);
  assert.equal(user.account.available, before + 1000);
});

test("Ocean's blackjack seats the crew and reports the run", async () => {
  if (!live('oceans')) return;
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  const res = await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [10_000_000], floor: 'high-limit', event: 'oceans' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.round.ai.map(a => a.name), ['대니', '러스티', '라이너스']);
  assert.equal(res.data.eventStreak.need, 5);
  assert.equal((await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [10_000_000], floor: 'high-limit', event: 'rounders' })).status, 409, 'an event of another game is refused');
});

test('Monte Carlo baccarat tracks the run and pays the gala bonus', async () => {
  if (!live('montecarlo')) return;
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  let paid = false;
  for (let i = 0; i < 80 && !paid; i++) {
    const res = await call(store, 'POST', '/api/baccarat/play', { stake: 10_000_000, floor: 'high-limit', betType: 'BANKER', event: 'montecarlo' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const s = res.data.eventStreak;
    assert.equal(s.need, 3);
    if (s.bonus) { paid = true; assert.equal(s.bonus, 30_000_000); }
  }
  assert.ok(paid, 'three banker wins in a row within 80 hands');
});

test('타짜 나이트 starts every 고스톱 hand at ×2 against 아귀 and 고광렬', async () => {
  if (!live('tazza')) return;
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  const res = await call(store, 'POST', '/api/gostop/start', { stake: 10_000_000, floor: 'high-limit', event: 'tazza' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.round.double, 2);
  assert.deepEqual(res.data.round.seats.slice(1).map(s => s.name), ['아귀', '고광렬']);
});

test('Rounders seats one boss heads-up by ladder step', async () => {
  const s = createHoldemSession({ userId: 'u', nickname: 'me', buyIn: 1_000_000, tier: 'gold-room', floor: 'gold-room', event: 'rounders', boss: 3 }, Math.random);
  assert.equal(s.table.seats.length, 2);
  assert.equal(s.table.seats[1].name, ROUNDERS.bosses[3].name);
  if (!live('rounders')) return;
  const store = memoryStore();
  const first = (await call(store, 'GET', '/api/state')).data;
  assert.equal(first.rounders.boss, ROUNDERS.bosses[0].name);
  const res = await call(store, 'POST', '/api/holdem/sit', { buyIn: 100_000_000, floor: 'high-limit', event: 'rounders' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.session.royale.event, 'rounders');
  assert.equal(res.data.session.royale.bossName, ROUNDERS.bosses[0].name);
});
