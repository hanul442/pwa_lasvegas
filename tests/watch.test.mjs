import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { addFriend, friendsView, notePresence, resetPresence } from '../lib/friends.mjs';
import { watchRefusal, resetWatchers } from '../lib/watch.mjs';
import { createRoom, joinRoom, startRoom, tick, findRoom } from '../lib/table-room.mjs';
import { createRoom as createHoldem, startRoom as startHoldem, roomView as holdemView } from '../lib/holdem-room.mjs';
import { handleApi } from '../lib/api.mjs';

const T0 = Date.parse('2026-10-29T06:00:00Z');
const ctx = now => ({ now, rand: Math.random, validateStake: () => {} });

function world() {
  resetPresence(); resetWatchers();
  const state = defaultState();
  for (const [id, nick] of [['ana', 'ANA'], ['bo', 'BO'], ['cy', 'CY'], ['di', 'DI']]) newUser(state, id, nick).account.available = 5_000_000_000;
  return state;
}

test('only a friend who counts me can be watched, and never with another friend of mine at the table', () => {
  const state = world();
  const room = createRoom(state, state.users.ana, { game: 'seotda', stake: 1_000_000, floor: 'gold-room', size: 4 }, ctx(T0));
  joinRoom(state, state.users.cy, room.code, ctx(T0));
  addFriend(state, state.users.bo, 'ANA'); // bo counts ana, but ana doesn't count bo
  assert.equal(watchRefusal(state, state.users.bo, room, 'ana'), 'WATCH_NOT_FRIEND');
  addFriend(state, state.users.ana, 'BO');
  assert.equal(watchRefusal(state, state.users.bo, room, 'ana'), null);
  addFriend(state, state.users.cy, 'BO'); // cy at the same table knows bo: bo's view could reach cy
  assert.equal(watchRefusal(state, state.users.bo, room, 'ana'), 'WATCH_CONFLICT');
  assert.equal(watchRefusal(state, state.users.bo, room, 'di'), 'WATCH_GONE');
  assert.equal(watchRefusal(state, state.users.cy, room, 'ana'), 'WATCH_CONFLICT', 'someone at the table just plays');
});

test('the rail sees the hand from the friend\'s chair, can\'t act, and the players see the rail', async () => {
  let state = world();
  addFriend(state, state.users.ana, 'BO');
  addFriend(state, state.users.bo, 'ANA');
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, who) => handleApi({ method, header: n => (n === 'x-player-id' ? who : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  const made = await call('POST', '/api/rooms', { game: 'seotda', stake: 1_000_000, floor: 'gold-room', size: 3 }, 'ana');
  assert.equal(made.status, 201);
  const code = made.data.room.code;
  await call('POST', '/api/rooms/start', { code }, 'ana');
  notePresence('ana');
  const fv = friendsView(state, state.users.bo);
  assert.equal(fv.list[0].where.watchable, true);
  const seen = await call('GET', `/api/room?code=${code}&watch=ana`, null, 'bo');
  assert.equal(seen.status, 200);
  const v = seen.data.room;
  assert.equal(v.watching.nickname, 'ANA');
  assert.equal(v.seated, false);
  assert.equal(v.isHost, false);
  const anaView = (await call('GET', `/api/room?code=${code}`, null, 'ana')).data.room;
  assert.deepEqual(v.round.hand, anaView.round.hand, 'the same cards ana holds');
  assert.deepEqual(anaView.watchers.map(w => w.nickname), ['BO'], 'ana sees who is watching');
  const act = await call('POST', '/api/rooms/action', { code, handNo: v.handNo, seq: v.seq, action: 'CALL' }, 'bo');
  assert.equal(act.status, 409, 'the rail cannot play');
  const stranger = await call('GET', `/api/room?code=${code}&watch=ana`, null, 'cy');
  assert.equal(stranger.status, 403);
});

test('Hold\'em rail: the friend\'s hole cards, no legal moves', () => {
  const state = world();
  addFriend(state, state.users.ana, 'BO');
  const room = createHoldem(state, state.users.ana, { buyIn: 100_000_000, floor: 'gold-room', size: 4 }, ctx(T0));
  startHoldem(state, state.users.ana, room.code, ctx(T0));
  assert.equal(watchRefusal(state, state.users.bo, room, 'ana'), null);
  const v = holdemView(room, 'bo', {}, T0, state, { watch: 'ana' });
  const seat = room.players.ana.seat;
  assert.equal(v.me, seat);
  assert.equal(v.table.legal, null);
  assert.ok(v.table.seats[seat].cards.every(c => c !== 'HIDDEN'), 'ana\'s hole cards');
  assert.ok(v.table.seats.some((s, i) => i !== seat && s.cards.length && s.cards.every(c => c === 'HIDDEN')), 'everyone else face down');
});
