// 다른 기기에서 로그인해도 처음 온 사람처럼 약관·첫 판 팁·시즌 알림이 다시 뜨지 않게:
// "이미 봤음" 표시가 계정에 저장되고(lib/seen.mjs), 새 폰은 로그인하자마자 그걸 받아요(public/js/seen.js).
import './legacy-economy.mjs';
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
const call = (store, method, path, body, { token, device } = {}) => handleApi({
  method,
  header: h => ({ authorization: token ? `Bearer ${token}` : undefined, 'x-device': device, 'x-idempotency-key': `k-seen-${++n}` })[h],
  body: async () => body ?? {}
}, new URL(`http://x${path}`), store, { NODE_ENV: 'production', AUTH_REQUIRED: true });

test('marks saved on one phone come back when signing in on another', async () => {
  const store = memoryStore();
  const up = await call(store, 'POST', '/api/auth/signup', { username: '서연이', password: 'secret12' }, { device: 'phone-a-0001' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.deepEqual(up.data.state.seen, {});
  const me = up.data.state.user.id;
  const saved = await call(store, 'POST', '/api/seen', { flags: { 'vegas:terms': '2026-10-13', 'vegas:guide:blackjack': '1', [`vegas:tier-seen:s1:${me}`]: 'gold', 'not-ours': '1', 'vegas:bad key': '1' } }, { token: up.data.token });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(Object.keys(saved.data.seen).sort(), ['vegas:guide:blackjack', `vegas:tier-seen:s1:${me}`, 'vegas:terms'].sort());

  const other = await call(store, 'POST', '/api/auth/login', { username: '서연이', password: 'secret12' }, { device: 'phone-b-0002' });
  assert.equal(other.status, 200, JSON.stringify(other.data));
  assert.equal(other.data.state.seen['vegas:guide:blackjack'], '1');
  assert.equal(other.data.state.seen['vegas:terms'], '2026-10-13');

  // 설정 → 가이드 다시 보기 forgets a mark everywhere.
  const reset = await call(store, 'POST', '/api/seen', { flags: { 'vegas:guide:blackjack': '' } }, { token: other.data.token });
  assert.equal(reset.data.seen['vegas:guide:blackjack'], undefined);
  const back = await call(store, 'GET', '/api/state', null, { token: up.data.token, device: 'phone-a-0001' });
  assert.equal(back.status, 200, JSON.stringify(back.data).slice(0, 200));
  assert.equal(back.data.seen['vegas:terms'], '2026-10-13', JSON.stringify(back.data.seen)+JSON.stringify(store.peek().users[me].seen));
});

test('the list stays small: the oldest marks go first', async () => {
  const { noteSeen } = await import('../lib/seen.mjs');
  const user = {};
  for (let i = 0; i < 6; i++) noteSeen(user, Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`vegas:guide:g${i}-${k}`, '1'])));
  assert.equal(Object.keys(user.shown).length, 300);
  assert.ok(!('vegas:guide:g0-0' in user.shown));
  assert.ok('vegas:guide:g5-59' in user.shown);
  assert.throws(() => noteSeen(user, 'x'), /BAD_REQUEST/);
});

test('a new phone takes the account marks before deciding what to show, and teaches the account what it saw', async () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
    key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; }
  };
  const posts = [];
  globalThis.fetch = async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ seen: {} }) }; };
  const { absorb, remember } = await import('../public/js/seen.js');
  mem.set('vegas:player', 'u_me');
  mem.set('vegas:session', 'tok');
  mem.set('vegas:guide:seotda', '1');            // seen on this phone before marks were on the account
  mem.set('vegas:bust-seen:u_someone-else', 'b1'); // another account's mark stays here
  mem.set('vegas:muted', '1');                    // a phone setting never travels
  mem.set('vegas:gesture-tip', '3');
  absorb({ user: { id: 'u_me' }, seen: { 'vegas:terms': '2026-10-13', 'vegas:guide:blackjack': '1', 'vegas:gesture-tip': '1', 'vegas:muted': '0' } });
  assert.equal(mem.get('vegas:terms'), '2026-10-13');
  assert.equal(mem.get('vegas:guide:blackjack'), '1');
  assert.equal(mem.get('vegas:gesture-tip'), '3', 'a count keeps the larger');
  assert.equal(mem.get('vegas:muted'), '1');
  remember('vegas:guide:baccarat', '1');
  await new Promise(r => setTimeout(r, 1300));
  assert.equal(posts.length, 1);
  const sent = posts[0].flags;
  assert.equal(sent['vegas:guide:seotda'], '1');
  assert.equal(sent['vegas:guide:baccarat'], '1');
  assert.equal(sent['vegas:gesture-tip'], '3');
  assert.ok(!('vegas:bust-seen:u_someone-else' in sent));
  assert.ok(!('vegas:muted' in sent));
});
