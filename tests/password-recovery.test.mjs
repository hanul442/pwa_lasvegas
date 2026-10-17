import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

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
let n = 0;
const call = (store, method, path, body, { token, player } = {}) => handleApi({
  method,
  header: h => ({ authorization: token ? `Bearer ${token}` : undefined, 'x-player-id': player, 'x-idempotency-key': `k-auth-${++n}` })[h],
  body: async () => body ?? {}
}, new URL(`http://x${path}`), store, { NODE_ENV: 'production', AUTH_REQUIRED: true });

const signup = async (store, username, extra = {}) => (await call(store, 'POST', '/api/auth/signup', { username, password: 'secret12', ...extra })).data;
const login = (store, username, password) => call(store, 'POST', '/api/auth/login', { username, password });

test('a recovery code resets a forgotten password once, and signs other devices out', async () => {
  const store = memoryStore();
  const me = await signup(store, '민수');
  assert.equal(me.state.hasRecovery, false);
  const made = await call(store, 'POST', '/api/auth/recovery', {}, { token: me.token });
  assert.equal(made.status, 200);
  assert.match(made.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(made.data.state.hasRecovery, true);
  assert.doesNotMatch(JSON.stringify(store.peek().auth), new RegExp(made.data.code.replace(/-/g, '')), 'only a hash of the code is stored');

  const wrong = await call(store, 'POST', '/api/auth/reset', { username: '민수', code: 'AAAA-BBBB-CCCC', password: 'newpass1' });
  assert.equal(wrong.data.error, 'BAD_RECOVERY');
  // Typed in lower case without dashes still works.
  const ok = await call(store, 'POST', '/api/auth/reset', { username: '민수', code: made.data.code.toLowerCase().replace(/-/g, ' '), password: 'newpass1' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.state.user.id, me.state.user.id);
  assert.equal(ok.data.state.hasRecovery, false);
  assert.equal((await call(store, 'GET', '/api/state', null, { token: me.token })).status, 401, 'the old device is signed out');
  assert.equal((await login(store, '민수', 'secret12')).status, 401);
  assert.equal((await login(store, '민수', 'newpass1')).status, 200);
  const again = await call(store, 'POST', '/api/auth/reset', { username: '민수', code: made.data.code, password: 'other123' });
  assert.equal(again.data.error, 'BAD_RECOVERY', 'a used code is spent');
});

test('without a recovery code, unknown names and no code look the same', async () => {
  const store = memoryStore();
  await signup(store, '민수');
  const a = await call(store, 'POST', '/api/auth/reset', { username: '민수', code: 'AAAA-BBBB-CCCC', password: 'newpass1' });
  const b = await call(store, 'POST', '/api/auth/reset', { username: '없는사람', code: 'AAAA-BBBB-CCCC', password: 'newpass1' });
  assert.deepEqual([a.status, a.data.error], [401, 'BAD_RECOVERY']);
  assert.deepEqual([b.status, b.data.error], [401, 'BAD_RECOVERY']);
});

test('the operator can hand out a temporary password, and the player changes it', async () => {
  const store = memoryStore();
  const admin = await signup(store, '한서', { claimId: 'hanseo' });
  const me = await signup(store, '민수');
  const denied = await call(store, 'POST', '/api/admin/password', { userId: admin.state.user.id }, { token: me.token });
  assert.equal(denied.data.error, 'FORBIDDEN');
  const bot = await call(store, 'POST', '/api/admin/password', { userId: 'june' }, { token: admin.token });
  assert.equal(bot.data.error, 'NO_ACCOUNT');
  const temp = await call(store, 'POST', '/api/admin/password', { userId: me.state.user.id }, { token: admin.token });
  assert.equal(temp.status, 200);
  assert.equal(temp.data.username, '민수');
  assert.equal((await call(store, 'GET', '/api/state', null, { token: me.token })).status, 401);
  const back = await login(store, '민수', temp.data.password);
  assert.equal(back.status, 200);
  const bad = await call(store, 'POST', '/api/auth/password', { current: 'nope', password: 'mine1234' }, { token: back.data.token });
  assert.equal(bad.data.error, 'BAD_CREDENTIALS');
  const changed = await call(store, 'POST', '/api/auth/password', { current: temp.data.password, password: 'mine1234' }, { token: back.data.token });
  assert.equal(changed.status, 200);
  assert.equal((await call(store, 'GET', '/api/state', null, { token: changed.data.token })).status, 200);
  assert.equal((await login(store, '민수', 'mine1234')).status, 200);
});
