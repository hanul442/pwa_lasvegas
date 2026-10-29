// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { addFriend, resetPresence } from '../lib/friends.mjs';
import { challengeStake, challengeOptions, challengesFor, CHALLENGE_WAIT_MS } from '../lib/challenge.mjs';
import { findRoom, tick as tickTable } from '../lib/table-room.mjs';
import { findRoom as findHoldem, tick as tickHoldem, sweepRooms as sweepHoldem } from '../lib/holdem-room.mjs';
import { newsFor } from '../lib/news.mjs';
import { handleApi } from '../lib/api.mjs';

function setup() {
  resetPresence();
  let state = defaultState();
  for (const [id, nick] of [['ana', 'ANA'], ['bo', 'BO'], ['cy', 'CY']]) newUser(state, id, nick).account.available = 50_000_000_000;
  addFriend(state, state.users.ana, 'BO');
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, who) => handleApi({ method, header: n => (n === 'x-player-id' ? who : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  return { call, get: () => state, set: s => { state = s; } };
}

// Plays the room's clocks out until `done` says stop (every turn times out and is played for them).
function runOut(state, room, tick, done, start) {
  let now = start;
  for (let i = 0; i < 5000 && !done(); i++) {
    now += 26_000;
    Object.values(room.players).forEach(p => { p.missed = 0; });
    tick(state, room, { now, rand: Math.random });
  }
  return now;
}

test('stakes: 맞고 at the floor\'s smallest 점당, Hold\'em with 40 big blinds inside the floor', () => {
  assert.deepEqual(challengeStake('matgo', 'gold-room'), { stake: 1_000_000, need: 10_000_000 });
  assert.equal(challengeStake('holdem', 'gold-room'), null, 'gold room is too small for a Hold\'em buy-in');
  assert.deepEqual(challengeStake('holdem', 'high-limit'), { stake: 80_000_000, need: 80_000_000 });
  const opts = challengeOptions({ account: { available: 100_000_000 } });
  assert.deepEqual(opts.matgo.map(o => o.tier), ['gold-room', 'high-limit']);
  assert.deepEqual(opts.holdem.map(o => o.tier), ['high-limit']);
});

test('맞고 한 판: only the friend can sit, it deals on their arrival, and stops after one hand', async () => {
  const { call, get } = setup();
  const made = await call('POST', '/api/friends/challenge', { friendId: 'bo', game: 'matgo', tier: 'gold-room' }, 'ana');
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  const news = newsFor(get(), 'bo', Date.now() - 60_000).find(n => n.type === 'DUEL_ROOM');
  assert.match(news.title, /ANA님의 도전: 맞고 한 판/);
  assert.equal(news.join.code, code);
  assert.equal(challengesFor(get(), 'bo')[0].incoming, true);
  assert.equal((await call('GET', '/api/rooms?game=matgo', null, 'cy')).data.rooms.length, 0, 'not in the open list');
  assert.equal((await call('POST', '/api/rooms/join', { code }, 'cy')).status, 403, 'a stranger cannot take the seat');
  assert.equal((await call('POST', '/api/rooms/start', { code }, 'ana')).status, 409);
  const joined = await call('POST', '/api/rooms/join', { code }, 'bo');
  assert.equal(joined.status, 200);
  assert.equal(joined.data.room.started, true);
  assert.ok(joined.data.room.round, 'dealt at once');
  const state = get();
  const room = findRoom(state, code);
  runOut(state, room, tickTable, () => room.challenge.done, Date.now());
  assert.equal(room.challenge.played, 1);
  assert.equal(room.started, false);
  const handNo = room.handNo;
  tickTable(state, room, { now: Date.now() + 3_600_000 });
  assert.equal(room.handNo, handNo, 'no second hand');
  const nets = room.challenge.nets;
  assert.equal(nets.ana + nets.bo, 0, 'one friend\'s win is the other\'s loss');
  if (nets.ana !== 0) assert.equal(room.challenge.winner, nets.ana > 0 ? 'ana' : 'bo');
});

test('홀덤 10핸드 heads-up, no bots; an unanswered challenge lapses and returns the buy-in', async () => {
  const { call, get } = setup();
  const before = get().users.ana.account.available;
  const made = await call('POST', '/api/friends/challenge', { friendId: 'bo', game: 'holdem', tier: 'high-limit' }, 'ana');
  assert.equal(made.status, 201, JSON.stringify(made.data));
  let state = get();
  const lapsed = findHoldem(state, made.data.room.code);
  sweepHoldem(state, { now: Date.now() + CHALLENGE_WAIT_MS + 1000 });
  assert.equal(lapsed.status, 'CLOSED');
  assert.equal(state.users.ana.account.available, before, 'buy-in back');
  assert.equal(state.users.ana.account.locked, 0);

  const again = await call('POST', '/api/friends/challenge', { friendId: 'bo', game: 'holdem', tier: 'high-limit' }, 'ana');
  const code = again.data.room.code;
  assert.equal((await call('POST', '/api/holdem/rooms/join', { code }, 'bo')).status, 200);
  state = get();
  const room = findHoldem(state, code);
  assert.equal(room.table.seats.filter(s => s.kind === 'bot').length, 0, 'heads-up, no bots');
  runOut(state, room, tickHoldem, () => room.challenge.done, Date.now());
  assert.ok(room.challenge.played <= 10 && room.challenge.done);
  assert.equal(room.table.seats.filter(s => s.kind === 'bot').length, 0);
});

test('getting up mid-match gives it away', async () => {
  const { call, get } = setup();
  const made = await call('POST', '/api/friends/challenge', { friendId: 'bo', game: 'holdem', tier: 'high-limit' }, 'ana');
  const code = made.data.room.code;
  await call('POST', '/api/holdem/rooms/join', { code }, 'bo');
  const left = await call('POST', '/api/holdem/rooms/leave', { code }, 'bo');
  assert.equal(left.status, 200);
  const room = findHoldem(get(), code);
  assert.equal(room.challenge.done, true);
  assert.equal(room.challenge.winner, 'ana');
  assert.equal(room.challenge.forfeit, 'bo');
});

test('only a friend can be challenged', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/api/friends/challenge', { friendId: 'cy', game: 'matgo', tier: 'gold-room' }, 'ana')).status, 404);
  assert.equal((await call('POST', '/api/friends/challenge', { friendId: 'bo', game: 'slots', tier: 'gold-room' }, 'ana')).status, 400);
});
