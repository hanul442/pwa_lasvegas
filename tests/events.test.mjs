import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { EVENTS, liveEvents, currentEvent, nextEvent, eventOfWeek, ROTATION_START, WEEK } from '../lib/events.mjs';
import { during, holdings } from './event-clock.mjs';
import { trackEventStreak } from '../lib/event-bonus.mjs';
import { createHoldemSession, ROUNDERS } from '../lib/holdem-session.mjs';

function memoryStore() {
  let state = defaultState();
  // Mid-way through High Limit (1억–10억 net worth), so a few wins don't graduate the floor.
  state.users.hanseo.account.available = 300_000_000;
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

test('every event names a lobby game and its rules', () => {
  const games = new Set(['poker', 'gostop', 'blackjack', 'baccarat']);
  for (const e of EVENTS) {
    assert.ok(games.has(e.game), e.id);
    assert.ok(e.rules.length > 0 && e.title && e.blurb, e.id);
  }
});

test('one event runs at a time, a week each from Monday 00:00 KST, in rotation', () => {
  assert.equal(new Date(ROTATION_START).toISOString(), '2026-10-11T15:00:00.000Z', 'Monday 2026-10-12 00:00 KST');
  assert.deepEqual(liveEvents(ROTATION_START - 1), [], 'nothing before the rotation starts');
  const ids = EVENTS.map(e => e.id);
  for (let w = 0; w < ids.length * 2; w++) {
    const at = ROTATION_START + w * WEEK;
    assert.deepEqual(liveEvents(at).map(e => e.id), [ids[w % ids.length]]);
    assert.deepEqual(liveEvents(at + WEEK - 1).map(e => e.id), [ids[w % ids.length]], 'still on until Sunday 23:59');
    assert.equal(nextEvent(at).id, ids[(w + 1) % ids.length]);
    assert.equal(Date.parse(currentEvent(at).until), at + WEEK);
  }
  assert.equal(eventOfWeek(0).id, 'royale');
});

test('a streak bonus pays at the target, resets on a loss and ignores pushes', during('oceans', () => {
  const state = defaultState();
  const user = Object.values(state.users)[0];
  const before = user.account.available;
  const step = net => trackEventStreak(state, user, { event: 'oceans', net, floorMin: 100, roundId: `r${++n}` });
  step(1); step(1); step(0);
  assert.equal(step(-1).streak, 0);
  let last;
  for (let i = 0; i < 5; i++) last = step(1);
  assert.equal(last.bonus, 3000);
  assert.equal(last.streak, 0);
  assert.equal(user.account.available, before + 3000);
}));

test("Ocean's blackjack seats the crew and reports the run", during('oceans', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  holdings(store, 9_999_999_999);
  assert.equal((await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [1_000_000_000], floor: 'penthouse', event: 'oceans' })).data.error, 'EVENT_ENTRY_REQUIRED', 'one 원 under 100억 stays outside');
  holdings(store, 20_000_000_000);
  assert.equal((await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [10_000_000], floor: 'high-limit', event: 'oceans' })).status, 400, 'events play only at the event table');
  const res = await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [1_000_000_000], floor: 'penthouse', event: 'oceans' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.round.ai.map(a => a.name), ['대니', '러스티', '라이너스']);
  assert.equal(res.data.eventStreak.need, 5);
  assert.equal((await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [1_000_000_000], floor: 'penthouse', event: 'rounders' })).status, 409, 'an event of another game is refused');
}));

test('Monte Carlo baccarat tracks the run and pays the gala bonus', during('montecarlo', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  let paid = false;
  for (let i = 0; i < 80 && !paid; i++) {
    holdings(store, 50_000_000_000);
    const res = await call(store, 'POST', '/api/baccarat/play', { stake: 1_000_000_000, floor: 'penthouse', betType: 'BANKER', event: 'montecarlo' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const s = res.data.eventStreak;
    assert.equal(s.need, 3);
    if (s.bonus) { paid = true; assert.equal(s.bonus, 10_000_000_000); }
  }
  assert.ok(paid, 'three banker wins in a row within 80 hands');
}));

test('타짜 나이트 starts every 고스톱 hand at ×2 against 아귀 and 고광렬', during('tazza', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  holdings(store, 20_000_000_000);
  const res = await call(store, 'POST', '/api/gostop/start', { stake: 1_000_000_000, floor: 'penthouse', event: 'tazza' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.round.double, 2);
  assert.deepEqual(res.data.round.seats.slice(1).map(s => s.name), ['아귀', '고광렬']);
}));

test('Rounders seats one boss heads-up by ladder step', during('rounders', async () => {
  const s = createHoldemSession({ userId: 'u', nickname: 'me', buyIn: 1_000_000, tier: 'gold-room', floor: 'gold-room', event: 'rounders', boss: 3 }, Math.random);
  assert.equal(s.table.seats.length, 2);
  assert.equal(s.table.seats[1].name, ROUNDERS.bosses[3].name);
  const store = memoryStore();
  const first = (await call(store, 'GET', '/api/state')).data;
  assert.equal(first.rounders.boss, ROUNDERS.bosses[0].name);
  holdings(store, 20_000_000_000);
  const res = await call(store, 'POST', '/api/holdem/sit', { buyIn: 10_000_000_000, floor: 'penthouse', event: 'rounders' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.session.royale.event, 'rounders');
  assert.equal(res.data.session.royale.bossName, ROUNDERS.bosses[0].name);
}));

test('the state lists this week\'s event and the weeks after it', during('tazza', async () => {
  const store = memoryStore();
  const res = await call(store, 'GET', '/api/state');
  assert.deepEqual(res.data.events.map(e => e.id), ['tazza']);
  assert.deepEqual(res.data.eventSchedule.map(e => e.id), ['tazza', 'oceans', 'rounders', 'montecarlo', 'royale']);
  assert.equal(Date.parse(res.data.eventSchedule[1].from), Date.parse(res.data.eventSchedule[0].until));
  holdings(store, 20_000_000_000);
  const closed = await call(store, 'POST', '/api/baccarat/play', { stake: 1_000_000_000, floor: 'penthouse', betType: 'BANKER', event: 'montecarlo' });
  assert.equal(closed.status, 409, 'an event that is not this week\'s is closed');
}));
