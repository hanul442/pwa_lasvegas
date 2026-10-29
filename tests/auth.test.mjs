// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('without a session the game API refuses, and x-player-id no longer picks a player', async () => {
  const store = memoryStore();
  assert.equal((await call(store, 'GET', '/api/state')).status, 401);
  const spoof = await call(store, 'GET', '/api/state', null, { player: 'hanseo' });
  assert.equal(spoof.status, 401);
  assert.equal(spoof.data.error, 'AUTH_REQUIRED');
  assert.equal((await call(store, 'POST', '/api/daily/claim', {}, { player: 'hanseo' })).status, 401);
  assert.equal((await call(store, 'GET', '/api/health')).status, 200);
});

test('signing up creates a new player with the starting bankroll and a working session', async () => {
  const store = memoryStore();
  const res = await call(store, 'POST', '/api/auth/signup', { username: '민수', password: 'secret12' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.ok(res.data.token);
  assert.equal(res.data.state.user.nickname, '민수');
  assert.equal(res.data.state.username, '민수');
  // New players start with nothing; their first chips come from the bank or a handout.
  assert.equal(res.data.state.user.account.available, 0);
  assert.equal(res.data.state.bank.credit.grade, 6);
  const me = await call(store, 'GET', '/api/state', null, { token: res.data.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, res.data.state.user.id);
  // The password and sessions never reach the client.
  assert.doesNotMatch(JSON.stringify(me.data), /secret12|"hash"|"salt"/);
  const stored = store.peek().auth.accounts['민수'];
  assert.notEqual(stored.hash, 'secret12');
  assert.ok(!Object.keys(store.peek().auth.sessions).includes(res.data.token), 'only a hash of the token is stored');
});

test('usernames are unique, case-insensitively and against existing players', async () => {
  const store = memoryStore();
  assert.equal((await call(store, 'POST', '/api/auth/signup', { username: 'Lucky', password: 'secret12' })).status, 201);
  assert.equal((await call(store, 'POST', '/api/auth/signup', { username: 'lucky', password: 'secret12' })).data.error, 'USERNAME_TAKEN');
  assert.equal((await call(store, 'POST', '/api/auth/signup', { username: 'min', password: 'secret12' })).data.error, 'USERNAME_TAKEN');
  assert.equal((await call(store, 'POST', '/api/auth/signup', { username: 'a', password: 'secret12' })).data.error, 'INVALID_USERNAME');
  assert.equal((await call(store, 'POST', '/api/auth/signup', { username: 'okname', password: '123' })).data.error, 'INVALID_PASSWORD');
});

test('log in, log out, and wrong passwords lock the account after repeated tries', async () => {
  const store = memoryStore();
  await call(store, 'POST', '/api/auth/signup', { username: 'june2', password: 'secret12' });
  const bad = await call(store, 'POST', '/api/auth/login', { username: 'june2', password: 'nope-nope' });
  assert.equal(bad.status, 401);
  assert.equal(store.peek().auth.accounts.june2.failed, 1, 'the failure is remembered');
  assert.equal((await call(store, 'POST', '/api/auth/login', { username: 'ghost', password: 'whatever1' })).status, 401);
  const ok = await call(store, 'POST', '/api/auth/login', { username: 'JUNE2', password: 'secret12' });
  assert.equal(ok.status, 200);
  assert.equal((await call(store, 'GET', '/api/state', null, { token: ok.data.token })).status, 200);
  await call(store, 'POST', '/api/auth/logout', {}, { token: ok.data.token });
  assert.equal((await call(store, 'GET', '/api/state', null, { token: ok.data.token })).status, 401);
  for (let i = 0; i < 8; i++) await call(store, 'POST', '/api/auth/login', { username: 'june2', password: 'wrong-pass' });
  const locked = await call(store, 'POST', '/api/auth/login', { username: 'june2', password: 'secret12' });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.error, 'ACCOUNT_LOCKED');
});

test('the original HANSEO profile can be taken over once, keeping its chips and records', async () => {
  const store = memoryStore();
  const before = store.peek().users.hanseo.account.available;
  const opts = await call(store, 'GET', '/api/auth/options');
  assert.deepEqual(opts.data.claimable.map(p => p.id), ['hanseo']);
  const res = await call(store, 'POST', '/api/auth/signup', { username: '한서', password: 'secret12', claimId: 'hanseo' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.state.user.id, 'hanseo');
  assert.equal(res.data.state.user.isAdmin, true);
  assert.equal(res.data.state.user.account.available, before);
  assert.equal(res.data.state.user.nickname, '한서');
  assert.deepEqual((await call(store, 'GET', '/api/auth/options')).data.claimable, []);
  const again = await call(store, 'POST', '/api/auth/signup', { username: 'thief', password: 'secret12', claimId: 'hanseo' });
  assert.equal(again.data.error, 'PROFILE_NOT_CLAIMABLE');
  assert.equal((await call(store, 'POST', '/api/auth/signup', { username: 'bot', password: 'secret12', claimId: 'zero' })).data.error, 'PROFILE_NOT_CLAIMABLE');
});

test('two accounts play with separate wallets, and the ledger stays consistent', async t => {
  // Mid-month: no new loans in a month's last three days (lib/bank.mjs LOAN_FREEZE_DAYS).
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T03:00:00Z') });
  const store = memoryStore();
  const a = (await call(store, 'POST', '/api/auth/signup', { username: 'alpha', password: 'secret12' })).data;
  const b = (await call(store, 'POST', '/api/auth/signup', { username: 'bravo', password: 'secret12' })).data;
  const loan = await call(store, 'POST', '/api/bank/borrow', { lender: 'shark', amount: 100_000_000, days: 3 }, { token: a.token });
  assert.equal(loan.status, 200, JSON.stringify(loan.data));
  const play = await call(store, 'POST', '/api/sicbo/play', { stake: 1_000_000, floor: 'gold-room', betType: 'BIG' }, { token: a.token });
  assert.equal(play.status, 200, JSON.stringify(play.data));
  const bState = (await call(store, 'GET', '/api/state', null, { token: b.token })).data;
  assert.equal(bState.user.account.available, 0);
  assert.ok(bState.users.some(u => u.nickname === 'alpha'), 'new players show up for everyone');
  const s = store.peek();
  for (const u of Object.values(s.users)) {
    const rows = s.ledger.filter(x => x.userId === u.id);
    assert.equal(rows.at(-1).availableAfter, u.account.available, u.id);
  }
});

test('the deployed Worker and Node server turn accounts on', async () => {
  assert.match(await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'), /AUTH_REQUIRED: true/);
  assert.match(await readFile(new URL('../server.mjs', import.meta.url), 'utf8'), /AUTH_REQUIRED:true/);
});

test('the operator can give and take back chips, recorded in the ledger; other players cannot', async () => {
  const store = memoryStore();
  const admin = (await call(store, 'POST', '/api/auth/signup', { username: '한서', password: 'secret12', claimId: 'hanseo' })).data;
  const guest = (await call(store, 'POST', '/api/auth/signup', { username: 'guest', password: 'secret12' })).data;
  const gid = guest.state.user.id;
  const denied = await call(store, 'POST', '/api/admin/adjust', { userId: gid, amount: 10_000_000 }, { token: guest.token });
  assert.equal(denied.status, 403);
  const give = await call(store, 'POST', '/api/admin/adjust', { userId: gid, amount: 500_000_000, note: '이벤트 보상' }, { token: admin.token });
  assert.equal(give.status, 200, JSON.stringify(give.data));
  assert.equal(give.data.adjustment.available, 500_000_000);
  assert.equal(give.data.state.adminLog[0].note, '이벤트 보상');
  const take = await call(store, 'POST', '/api/admin/adjust', { userId: gid, amount: -200_000_000 }, { token: admin.token });
  assert.equal(take.data.adjustment.available, 300_000_000);
  assert.equal((await call(store, 'POST', '/api/admin/adjust', { userId: gid, amount: -9_990_000_000 }, { token: admin.token })).data.error, 'INSUFFICIENT_BANKROLL');
  assert.equal((await call(store, 'POST', '/api/admin/adjust', { userId: gid, amount: 1.5 }, { token: admin.token })).data.error, 'INVALID_AMOUNT');
  const g = (await call(store, 'GET', '/api/state', null, { token: guest.token })).data;
  assert.equal(g.user.account.available, 300_000_000);
  assert.equal(g.user.account.qualifiedPnl, 0, 'grants are not winnings');
  assert.deepEqual(g.adminLog, [], 'only the operator sees the log');
  const s = store.peek();
  assert.deepEqual(s.ledger.filter(x => x.userId === gid).map(x => x.type), ['INITIAL_GRANT', 'ADMIN_GRANT', 'ADMIN_DEDUCT']);
  assert.equal(s.ledger.filter(x => x.userId === gid).at(-1).availableAfter, 300_000_000);
});
