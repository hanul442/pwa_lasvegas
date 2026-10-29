import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { friendMap, friendsView, addFriend, removeFriend, notePresence, isOnline, resetPresence, arrivalDue, noteArrival, whereIs, ONLINE_MS, ARRIVAL_IDLE_MS, FRIEND_PUSH_GAP_MS } from '../lib/friends.mjs';
import { noteFriendTable } from '../lib/friend-record.mjs';
import { createRoom } from '../lib/table-room.mjs';
import { handleApi } from '../lib/api.mjs';

// 2026-10-29 15:00 KST: inside push hours.
const T0 = Date.parse('2026-10-29T06:00:00Z');
const sub = { endpoint: 'https://push.example/x', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } };

function world() {
  resetPresence();
  const state = defaultState();
  for (const [id, nick] of [['ana', 'ANA'], ['bo', 'BO'], ['cy', 'CY']]) {
    const u = newUser(state, id, nick);
    u.createdAt = new Date(T0 - 30 * 86_400_000).toISOString();
  }
  state.ledger.forEach(tx => { tx.createdAt = new Date(T0 - 30 * 86_400_000).toISOString(); });
  return state;
}

test('friends are people I played with, invited, or added; taken-off friends stay off', () => {
  const state = world();
  noteFriendTable(state, { game: 'Seotda', room: 'ABCD', people: [{ id: 'ana', nickname: 'ANA', net: 5 }, { id: 'bo', nickname: 'BO', net: -5 }] }, T0);
  state.users.cy.referredBy = { userId: 'ana', at: new Date(T0).toISOString() };
  const map = friendMap(state, state.users.ana);
  assert.equal(map.get('bo'), 'played');
  assert.equal(map.get('cy'), 'invite');
  assert.equal(friendMap(state, state.users.cy).get('ana'), 'invite', 'the invited side sees the inviter');
  assert.equal(map.has('min'), false, 'demo regulars are never friends');
  addFriend(state, state.users.bo, 'cy');
  assert.equal(friendMap(state, state.users.bo).get('cy'), 'added');
  assert.throws(() => addFriend(state, state.users.bo, 'bo'), /FRIEND_IS_ME/);
  assert.throws(() => addFriend(state, state.users.bo, 'nobody'), /FRIEND_NOT_FOUND/);
  assert.throws(() => addFriend(state, state.users.bo, 'min'), /FRIEND_NOT_FOUND/);
  removeFriend(state, state.users.ana, 'bo');
  assert.equal(friendMap(state, state.users.ana).has('bo'), false);
  addFriend(state, state.users.ana, 'BO');
  assert.equal(friendMap(state, state.users.ana).get('bo'), 'added', 'adding again brings them back');
});

test('the list shows who is here and the room they sit in', () => {
  const state = world();
  addFriend(state, state.users.ana, 'BO');
  addFriend(state, state.users.ana, 'CY');
  state.users.bo.account.available = 1_000_000_000;
  createRoom(state, state.users.bo, { game: 'seotda', stake: 1_000_000, floor: 'gold-room', size: 4 }, { now: T0, rand: Math.random, validateStake: () => {} });
  notePresence('bo', T0);
  const v = friendsView(state, state.users.ana, T0 + 1000);
  assert.equal(v.online, 1);
  assert.equal(v.list[0].id, 'bo', 'online first');
  assert.deepEqual({ kind: v.list[0].where.kind, game: v.list[0].where.game, open: v.list[0].where.open }, { kind: 'room', game: 'seotda', open: true });
  assert.equal(v.list[1].online, false);
  assert.equal(v.list[1].where, null, 'where an offline friend was is not shown');
  assert.equal(isOnline('bo', T0 + ONLINE_MS + 1), false);
  assert.equal(whereIs(state, 'cy'), null);
});

test('coming back after a long gap pushes friends once, not at night, not to someone already here', () => {
  const state = world();
  addFriend(state, state.users.ana, 'BO');
  addFriend(state, state.users.cy, 'BO');
  state.users.ana.push = { subs: [sub], sent: {} };
  state.users.cy.push = { subs: [sub], sent: {} };
  notePresence('cy', T0); // cy is looking at the app right now
  const due = arrivalDue(state, state.users.bo, T0);
  assert.ok(due, 'bo was away for a month');
  const plan = noteArrival(state, state.users.bo, { ...due, now: T0 });
  assert.deepEqual(plan.map(p => p.userId), ['ana']);
  assert.match(plan[0].message.title, /BO님이 들어왔어요/);
  assert.equal(arrivalDue(state, state.users.bo, T0 + 60_000), null, 'the same visit says nothing new');
  // Gone again for a while, back within three hours of the last push: no second push to ana.
  resetPresence();
  state.users.bo.push.lastSeenAt = new Date(T0 - ARRIVAL_IDLE_MS).toISOString();
  const again = arrivalDue(state, state.users.bo, T0 + 30 * 60_000);
  assert.ok(again);
  assert.deepEqual(noteArrival(state, state.users.bo, { ...again, now: T0 + 30 * 60_000 }).map(p => p.userId), ['cy'], 'ana already heard; cy has left since and hears now');
  // At 23:00 KST nobody is woken up.
  resetPresence();
  const late = Date.parse('2026-10-29T14:00:00Z');
  state.users.bo.push.lastSeenAt = new Date(late - 2 * ARRIVAL_IDLE_MS).toISOString();
  state.users.ana.push.sent.friendAt = new Date(late - FRIEND_PUSH_GAP_MS - 1).toISOString();
  const night = arrivalDue(state, state.users.bo, late);
  assert.equal(noteArrival(state, state.users.bo, { ...night, now: late }).length, 0);
});

test('friends API: add by name, list, remove', async () => {
  resetPresence();
  let state = world();
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, who = 'ana') => handleApi({ method, header: n => (n === 'x-player-id' ? who : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  const added = await call('POST', '/api/friends/add', { nickname: 'bo' });
  assert.equal(added.status, 200);
  assert.deepEqual(added.data.friends.list.map(f => f.id), ['bo']);
  assert.equal((await call('POST', '/api/friends/add', { nickname: 'zzz' })).status, 404);
  await call('GET', '/api/news?since=1', null, 'bo');
  const list = await call('GET', '/api/friends');
  assert.equal(list.data.friends.list[0].online, true, 'the news poll marks bo as here');
  const removed = await call('POST', '/api/friends/remove', { id: 'bo' });
  assert.deepEqual(removed.data.friends.list, []);
});
