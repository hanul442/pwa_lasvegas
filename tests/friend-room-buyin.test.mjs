// A friend's room above my RP tier (2026-10-29 점검): friends sit together whatever their RP
// (lib/table-room.mjs joinRoom), so the cashier sells the room's floor chips to someone holding its
// code, and floor news in the RP season comes from RP, not from a fat wallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { addLedger, settleHouseGame } from '../lib/economy.mjs';
import { rpOf } from '../lib/rank-points.mjs';

function memoryStore() {
  let state = defaultState();
  let queue = Promise.resolve();
  return {
    peek: () => state,
    edit: fn => fn(state),
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; });
      queue = task.catch(() => {});
      return task;
    }
  };
}
let n = 0;
const call = (store, method, path, body, token, device = 'dev-room-buyin') => handleApi({
  method,
  header: h => ({ authorization: token ? `Bearer ${token}` : undefined, 'x-device': device, 'x-idempotency-key': `k-room-buyin-${++n}` })[h],
  body: async () => body ?? {}
}, new URL(`http://x${path}`), store, { NODE_ENV: 'production', AUTH_REQUIRED: true });

async function guest(store, device) {
  const res = await call(store, 'POST', '/api/auth/guest', { terms: true }, null, device);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return { token: res.data.token, id: res.data.state.user.id };
}

test('a friend below the room\'s RP floor buys its chips with the room code and sits down', async () => {
  const store = memoryStore();
  const host = await guest(store, 'dev-host-0001');
  const friend = await guest(store, 'dev-friend-001');
  // The host's RP opens the High Limit; the friend's doesn't. The friend is a day-old guest, and
  // the High Limit is still a floor a new account may use for friends' rooms.
  store.edit(s => { const u = s.users[host.id]; const rp = rpOf(u); rp.points = rp.peak = 250; u.createdAt = '2026-01-01T00:00:00Z'; });
  let res = await call(store, 'POST', '/api/cashier/buyin', { floor: 'high-limit', amount: 1_500_000_000 }, host.token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  res = await call(store, 'POST', '/api/rooms', { game: 'matgo', stake: 30_000_000, floor: 'high-limit', size: 2 }, host.token);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const code = res.data.room.code;

  // Without the code the floor stays shut; with it the chips are sold.
  res = await call(store, 'POST', '/api/cashier/buyin', { floor: 'high-limit', amount: 1_500_000_000 }, friend.token);
  assert.equal(res.data.error, 'FLOOR_RP_LOCKED');
  res = await call(store, 'POST', '/api/rooms/join', { code }, friend.token);
  assert.equal(res.data.error, 'BUY_IN_REQUIRED');
  res = await call(store, 'POST', '/api/cashier/buyin', { floor: 'salon-prive', amount: 5_000_000_000, room: code }, friend.token);
  assert.equal(res.data.error, 'FLOOR_RP_LOCKED', 'the code opens only the room\'s own floor');
  res = await call(store, 'POST', '/api/cashier/buyin', { floor: 'high-limit', amount: 1_500_000_000, room: code }, friend.token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  res = await call(store, 'POST', '/api/rooms/join', { code }, friend.token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(store.peek().tableRooms.find(r => r.code === code).players[friend.id] != null, true);

  // Sitting in the room, a top-up there needs no code.
  res = await call(store, 'POST', '/api/cashier/buyin', { floor: 'high-limit', amount: 30_000_000 }, friend.token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  // A house table on that floor still checks the RP tier.
  res = await call(store, 'POST', '/api/rooms/leave', { code }, friend.token);
  res = await call(store, 'POST', '/api/baccarat/play', { stake: 30_000_000, bet: 'PLAYER', floor: 'high-limit' }, friend.token);
  assert.equal(res.data.error, 'FLOOR_RP_LOCKED');
  res = await call(store, 'POST', '/api/cashier/buyin', { floor: 'high-limit', amount: 1_500_000_000, room: 'ZZZZ' }, friend.token);
  assert.equal(res.data.error, 'ROOM_NOT_FOUND');
});

test('RP-season floor news: a fat wallet is no news, an RP climb into a new floor is', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  const floorNews = () => state.feed.filter(f => f.type === 'FLOOR_UNLOCK' && f.actorId === u.id).map(f => f.text);
  u.account.totalWagered = 1;
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: 500_000_000_000 });
  assert.deepEqual(floorNews(), [], 'money alone opens nothing now');
  const rp = rpOf(u);
  rp.points = rp.peak = 199;
  rp.promo = { active: true, target: 'silver', wins: 1, losses: 0, minStake: 10_000_000 }; // the next tier takes a 승급전
  settleHouseGame(state, u, { game: 'Baccarat', stake: 100_000_000, netPnl: 100_000_000, roundId: 'r-news-1' });
  assert.deepEqual(floorNews(), [`${u.nickname} unlocked 클럽.`]);
  settleHouseGame(state, u, { game: 'Baccarat', stake: 10_000_000, netPnl: -10_000_000, roundId: 'r-news-2' });
  assert.equal(floorNews().length, 1, 'no repeat while the floor stays open');
});
