// Friends' room polls wait on the server for the next change (lib/hold.mjs), so a friend's move
// shows at once instead of on the next 1.5s poll.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeSignal, holdView, viewKey } from '../lib/hold.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('holdView answers at once without a key, waits for a change with one, and gives up after the hold', async () => {
  const signal = changeSignal();
  let view = { cursor: { hand: 1, from: 3 }, serverNow: 1 };
  const look = async () => ({ view: { ...view, serverNow: Date.now() } });
  const seen = viewKey(view);
  assert.equal(viewKey({ ...view, serverNow: 99, events: [1], prev: {} }), seen, 'the clock and the event tail are not part of the key');
  let t = Date.now();
  await holdView({ look, wait: signal.wait });
  assert.ok(Date.now() - t < 50);
  t = Date.now();
  setTimeout(() => { view = { cursor: { hand: 1, from: 4 } }; signal.fire(); }, 80);
  const got = await holdView({ seen, look, wait: signal.wait });
  assert.deepEqual(got.view.cursor, { hand: 1, from: 4 });
  assert.ok(Date.now() - t >= 70 && Date.now() - t < 600, `${Date.now() - t}ms`);
  t = Date.now();
  await holdView({ seen: viewKey(view), look, wait: signal.wait, holdMs: 150 });
  assert.ok(Date.now() - t >= 140 && Date.now() - t < 600, `${Date.now() - t}ms`);
  // A move that is due (an AI's turn) ends the wait so the caller can play it.
  let due = false;
  setTimeout(() => { due = true; }, 30);
  const out = await holdView({ seen: viewKey(view), look: async () => (due ? { due: true } : { view }), wait: signal.wait, holdMs: 5000 });
  assert.equal(out.due, true);
});

function memoryStore() {
  let state = defaultState(), queue = Promise.resolve();
  for (const uid of ['hanseo', 'min']) state.users[uid].account.available = Math.min(state.users[uid].account.available, 900_000_000);
  const changes = changeSignal();
  return {
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; changes.fire(); return out; });
      queue = task.catch(() => {});
      return task;
    },
    changed: ms => changes.wait(ms)
  };
}
let n = 0;
const call = (store, player, method, path, body) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? `k-hold-${++n}` : h === 'x-player-id' ? player : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('a friend-room poll with the last key is answered as soon as a friend does something', async () => {
  const store = memoryStore();
  const made = await call(store, 'hanseo', 'POST', '/api/rooms', { game: 'seotda', stake: 50_000_000, floor: 'high-limit', size: 3 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  const first = await call(store, 'hanseo', 'GET', `/api/room?code=${code}`);
  assert.ok(first.data.key);
  assert.equal((await call(store, 'hanseo', 'GET', `/api/room?code=${code}`)).data.key, first.data.key, 'nothing changed, same key');
  const t = Date.now();
  const held = call(store, 'hanseo', 'GET', `/api/room?code=${code}&wait=${first.data.key}`);
  await sleep(120);
  assert.equal((await call(store, 'min', 'POST', '/api/rooms/join', { code })).status, 200);
  const got = await held;
  assert.equal(got.status, 200);
  assert.notEqual(got.data.key, first.data.key);
  assert.ok(got.data.room.players.some(p => p.userId === 'min'), 'the answer shows min sitting down');
  assert.ok(Date.now() - t >= 100 && Date.now() - t < 1000, `${Date.now() - t}ms`);
});

test("a Hold'em room poll waits the same way", async () => {
  const store = memoryStore();
  const made = await call(store, 'hanseo', 'POST', '/api/holdem/rooms', { buyIn: 50_000_000, floor: 'high-limit', size: 3 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  const first = await call(store, 'hanseo', 'GET', `/api/holdem/room?code=${code}`);
  assert.ok(first.data.key);
  const t = Date.now();
  const held = call(store, 'hanseo', 'GET', `/api/holdem/room?code=${code}&wait=${first.data.key}`);
  await sleep(120);
  assert.equal((await call(store, 'min', 'POST', '/api/holdem/rooms/join', { code })).status, 200);
  const got = await held;
  assert.notEqual(got.data.key, first.data.key);
  assert.ok(Date.now() - t >= 100 && Date.now() - t < 1000, `${Date.now() - t}ms`);
});
