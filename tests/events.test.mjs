import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { EVENTS, ROTATION, liveEvents, currentEvent, nextEvent, eventOfWeek, eventOpen, eventById, ROTATION_START, WEEK } from '../lib/events.mjs';
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
  const games = new Set(['poker', 'gostop', 'blackjack', 'baccarat', 'roulette', 'dice']);
  for (const e of EVENTS) {
    assert.ok(games.has(e.game), e.id);
    assert.ok(e.rules.length > 0 && e.title && e.blurb, e.id);
  }
});

test('one event runs at a time, a week each from Monday 00:00 KST, in rotation', () => {
  assert.equal(new Date(ROTATION_START).toISOString(), '2026-10-11T15:00:00.000Z', 'Monday 2026-10-12 00:00 KST');
  const rotating = at => liveEvents(at).filter(e => !e.always);
  assert.deepEqual(rotating(ROTATION_START - 1), [], 'nothing before the rotation starts');
  const ids = ROTATION.map(e => e.id);
  assert.ok(!ids.includes('whale'), 'The Whale Room stays out of the rotation');
  for (let w = 0; w < ids.length * 2; w++) {
    const at = ROTATION_START + w * WEEK;
    assert.deepEqual(rotating(at).map(e => e.id), [ids[w % ids.length]]);
    assert.deepEqual(rotating(at + WEEK - 1).map(e => e.id), [ids[w % ids.length]], 'still on until Sunday 23:59');
    assert.ok(eventOpen(eventById('whale'), at), 'The Whale Room is open every week');
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

test('a hedged multi-spot win leaves the run as it is', during('oceans', () => {
  const state = defaultState();
  const user = Object.values(state.users)[0];
  const step = (net, stake) => trackEventStreak(state, user, { event: 'casablanca', net, stake, floorMin: 100, roundId: `h${++n}` });
  assert.equal(step(100, 100).streak, 1, 'an even-money win counts');
  assert.equal(step(1, 35).streak, 1, 'covering 35 numbers to net one chip is not a winning spin');
  assert.equal(step(50, 100).streak, 2, 'winning half the stake still counts');
  assert.equal(step(-35, 35).streak, 0);
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
  // Three banker wins in a row is missing from 80 hands about 1 time in 70; 400 hands make that ~1 in a billion.
  for (let i = 0; i < 400 && !paid; i++) {
    holdings(store, 50_000_000_000);
    const res = await call(store, 'POST', '/api/baccarat/play', { stake: 1_000_000_000, floor: 'penthouse', betType: 'BANKER', event: 'montecarlo' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const s = res.data.eventStreak;
    assert.equal(s.need, 3);
    if (s.bonus) { paid = true; assert.equal(s.bonus, 10_000_000_000); }
  }
  assert.ok(paid, 'three banker wins in a row within 400 hands');
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
  assert.deepEqual(res.data.events.map(e => e.id), ['tazza', 'casablanca', 'godofgamblers', 'whale']);
  assert.deepEqual(res.data.eventsAlways.map(e => [e.id, e.floor, e.entry]), [['casablanca', 'penthouse', 10_000_000_000], ['godofgamblers', 'penthouse', 10_000_000_000], ['whale', 'sky-lounge', 100_000_000_000]]);
  assert.deepEqual(res.data.eventSchedule.map(e => e.id), ['tazza', 'oceans', 'rounders', 'montecarlo', 'royale']);
  assert.equal(Date.parse(res.data.eventSchedule[1].from), Date.parse(res.data.eventSchedule[0].until));
  holdings(store, 20_000_000_000);
  const closed = await call(store, 'POST', '/api/baccarat/play', { stake: 1_000_000_000, floor: 'penthouse', betType: 'BANKER', event: 'montecarlo' });
  assert.equal(closed.status, 409, 'an event that is not this week\'s is closed');
}));

test('The Whale Room seats only the very rich, at Sky Lounge, for a fixed 1천억', during('tazza', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  holdings(store, 50_000_000_000);
  assert.equal((await call(store, 'POST', '/api/holdem/sit', { buyIn: 100_000_000_000, floor: 'sky-lounge', event: 'whale' })).data.error, 'EVENT_ENTRY_REQUIRED', '500억 is not enough');
  holdings(store, 200_000_000_000);
  assert.equal((await call(store, 'POST', '/api/holdem/sit', { buyIn: 10_000_000_000, floor: 'penthouse', event: 'whale' })).data.error, 'EVENT_FLOOR_ONLY');
  assert.equal((await call(store, 'POST', '/api/holdem/sit', { buyIn: 50_000_000_000, floor: 'sky-lounge', event: 'whale' })).status, 400, 'the buy-in is the table maximum');
  const res = await call(store, 'POST', '/api/holdem/sit', { buyIn: 100_000_000_000, floor: 'sky-lounge', event: 'whale' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.session.royale.event, 'whale');
  assert.equal(res.data.session.table.seats.length, 6);
  assert.ok(res.data.session.table.seats.some(s => s.name === '두바이 왕자'));
  assert.equal(res.data.session.royale.prize, 1_000_000_000_000, 'a champion takes ×10');
}));

test('Casablanca roulette and God of Gamblers sic bo are always open and pay on a win run', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  assert.ok(eventOpen(eventById('casablanca')) && eventOpen(eventById('godofgamblers')));
  holdings(store, 9_000_000_000);
  assert.equal((await call(store, 'POST', '/api/roulette/spin', { bets: [{ betType: 'RED', stake: 1_000_000_000 }], floor: 'penthouse', event: 'casablanca' })).data.error, 'EVENT_ENTRY_REQUIRED');
  assert.equal((await call(store, 'POST', '/api/sicbo/play', { stake: 1_000_000_000, floor: 'penthouse', betType: 'BIG', event: 'godofgamblers' })).data.error, 'EVENT_ENTRY_REQUIRED');
  holdings(store, 50_000_000_000);
  assert.equal((await call(store, 'POST', '/api/roulette/spin', { bets: [{ betType: 'RED', stake: 1_000_000_000 }], floor: 'high-limit', event: 'casablanca' })).data.error, 'EVENT_FLOOR_ONLY');
  assert.equal((await call(store, 'POST', '/api/sicbo/play', { stake: 1_000_000_000, floor: 'penthouse', betType: 'BIG', event: 'casablanca' })).status, 409, 'an event belongs to its own game');
  const run = async (path, body, need, bonus) => {
    for (let i = 0; i < 300; i++) {
      holdings(store, 50_000_000_000);
      const res = await call(store, 'POST', path, body);
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal(res.data.eventStreak.need, need);
      if (res.data.eventStreak.bonus) { assert.equal(res.data.eventStreak.bonus, bonus); return true; }
    }
    return false;
  };
  assert.ok(await run('/api/roulette/spin', { bets: [{ betType: 'RED', stake: 1_000_000_000 }], floor: 'penthouse', event: 'casablanca' }, 3, 15_000_000_000), 'three reds in a row');
  assert.ok(await run('/api/sicbo/play', { stake: 1_000_000_000, floor: 'penthouse', betType: 'BIG', event: 'godofgamblers' }, 4, 25_000_000_000), 'four bigs in a row');
  assert.ok(store.peek().ledger.filter(x => x.type === 'EVENT_BONUS').length >= 2);
});
