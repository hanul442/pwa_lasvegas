import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

// The same handler runs in the Node server and the Cloudflare Worker, so it must work
// against any store that offers load() and mutate().
function memoryStore() {
  let state = defaultState();
  let queue = Promise.resolve();
  return {
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; });
      queue = task.catch(() => {});
      return task;
    }
  };
}
const call = (store, method, path, body, headers = {}) =>
  handleApi({ method, header: n => headers[n], body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('game API runs against an in-memory store with no file system', async () => {
  const store = memoryStore();
  const before = await call(store, 'GET', '/api/state');
  assert.equal(before.status, 200);
  const start = before.data.user.account.available;
  const res = await call(store, 'POST', '/api/sicbo/play', { stake: 100_000, floor: 'downtown', betType: 'BIG' }, { 'x-idempotency-key': 'k-test-1' });
  assert.equal(res.status, 200);
  assert.equal(res.data.state.user.account.available, start + res.data.round.netPnl);
  const replay = await call(store, 'POST', '/api/sicbo/play', { stake: 100_000, floor: 'downtown', betType: 'BIG' }, { 'x-idempotency-key': 'k-test-1' });
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.state.user.account.available, res.data.state.user.account.available);
});

test('failed bets leave the stored state untouched', async () => {
  const store = memoryStore();
  const before = (await call(store, 'GET', '/api/state')).data.user.account.available;
  const res = await call(store, 'POST', '/api/roulette/play', { stake: 1, floor: 'downtown', betType: 'RED' });
  assert.equal(res.status, 400);
  assert.equal((await call(store, 'GET', '/api/state')).data.user.account.available, before);
});

test('dev reset is closed in production and unknown routes 404', async () => {
  const store = memoryStore();
  assert.equal((await call(store, 'POST', '/api/dev/reset')).status, 404);
  assert.equal((await call(store, 'GET', '/api/nope')).status, 404);
});

test('worker-bound modules never touch node:fs', async () => {
  for (const file of ['lib/api.mjs', 'lib/state.mjs', 'lib/games.mjs', 'lib/economy.mjs', 'lib/blackjack-v2.mjs', 'worker/index.mjs']) {
    assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /node:fs|node:path/, file);
  }
});
