import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { recordError, errorLogView, ERROR_GROUPS_KEPT, unexpected } from '../lib/error-log.mjs';

function memoryStore() {
  let state = defaultState();
  let queue = Promise.resolve();
  return {
    peek: () => state,
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; });
      queue = task.catch(() => {});
      return task;
    }
  };
}
const call = (store, player, method, path, body) =>
  handleApi({ method, header: h => (h === 'x-player-id' ? player : h === 'x-idempotency-key' ? `k-err-${Math.random()}` : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('the same error groups into one line with a count, and old groups fall off', () => {
  const state = defaultState();
  recordError(state, { message: 'x is undefined', where: 'app.js:1:2', userId: 'hanseo' }, 1);
  recordError(state, { message: 'x is undefined', where: 'app.js:1:2', userId: 'min' }, 2);
  recordError(state, { message: 'x is undefined', where: 'app.js:1:2', userId: 'min' }, 3);
  assert.equal(state.errorLog.length, 1);
  assert.equal(state.errorLog[0].count, 3);
  assert.deepEqual(errorLogView(state)[0].players, [state.users.hanseo.nickname, state.users.min.nickname]);
  for (let k = 0; k < ERROR_GROUPS_KEPT + 10; k++) recordError(state, { message: `e${k}` }, 10 + k);
  assert.equal(state.errorLog.length, ERROR_GROUPS_KEPT);
  assert.equal(errorLogView(state)[0].message, `e${ERROR_GROUPS_KEPT + 9}`);
  assert.equal(unexpected(new Error('INSUFFICIENT_BANKROLL')), false);
  assert.equal(unexpected(new TypeError("Cannot read properties of undefined (reading 'x')")), true);
});

test('phones report errors; only the operator reads and clears them', async () => {
  const store = memoryStore();
  const r = await call(store, 'min', 'POST', '/api/client-error', { message: 'boom', stack: 'at a\nat b', where: '/#table-poker', ua: 'Galaxy' });
  assert.equal(r.status, 200);
  assert.equal((await call(store, 'min', 'GET', '/api/admin/errors')).status, 403);
  const seen = await call(store, 'hanseo', 'GET', '/api/admin/errors');
  assert.equal(seen.status, 200);
  assert.equal(seen.data.errors[0].message, 'boom');
  assert.equal(seen.data.errors[0].source, 'client');
  // A game refusal is not a bug; nothing is logged for it.
  await call(store, 'min', 'POST', '/api/shop/buy', { itemId: 'nope' });
  assert.equal(store.peek().errorLog.length, 1);
  const cleared = await call(store, 'hanseo', 'POST', '/api/admin/errors/clear');
  assert.deepEqual(cleared.data.errors, []);
  assert.equal(store.peek().errorLog.length, 0);
});
