import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { pruneGuests, GUEST_IDLE_DAYS } from '../lib/auth.mjs';
import { INVITE_REWARD, INVITE_MONTHLY_CAP, settleReferral } from '../lib/referral.mjs';
import { previewFor, injectPreview } from '../lib/link-preview.mjs';

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
  header: h => ({ authorization: token ? `Bearer ${token}` : undefined, 'x-device': device, 'x-idempotency-key': `k-guest-${++n}` })[h],
  body: async () => body ?? {}
}, new URL(`http://x${path}`), store, { NODE_ENV: 'production', AUTH_REQUIRED: true });

// Today's pay, then one baccarat hand at the Gold Room.
async function playOne(store, token, device) {
  const pay = await call(store, 'POST', '/api/daily/claim', {}, { token, device });
  // A guest was paid today's pay on arrival.
  assert.ok(pay.status === 200 || pay.data.error === 'DAILY_ALREADY_CLAIMED', JSON.stringify(pay.data));
  const res = await call(store, 'POST', '/api/baccarat/play', { stake: 1_000_000, floor: 'gold-room', betType: 'BANKER' }, { token, device });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.state;
}

test('a guest plays without signing up, stays off the rankings, and keeps the chips on picking a name', async () => {
  const store = memoryStore();
  assert.equal((await call(store, 'POST', '/api/auth/guest', {})).data.error, 'TERMS_REQUIRED');
  const g = await call(store, 'POST', '/api/auth/guest', { terms: true }, { device: 'dev-guest-0001' });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  assert.equal(g.data.state.user.guest, true);
  assert.match(g.data.state.user.nickname, /^게스트#\d{4}$/);
  assert.equal(g.data.state.username, null);
  assert.equal(g.data.state.invite.code, null, 'a guest has no invite code yet');
  assert.ok(g.data.state.user.account.available > 0, 'a guest sits down with today\'s pay');
  const after = await playOne(store, g.data.token, 'dev-guest-0001');
  const chips = after.user.account.available;
  assert.ok(chips > 0);
  // Another player never sees the guest in the player list or the rankings.
  const other = await call(store, 'POST', '/api/auth/signup', { username: '철수', password: 'secret12' });
  const seen = await call(store, 'GET', '/api/state', null, { token: other.data.token });
  assert.ok(!seen.data.users.some(u => u.guest));
  assert.ok(!JSON.stringify(seen.data.rankings).includes(g.data.state.user.id));
  // Picking a name: same rules as signing up, the chips and record stay, the old token stops.
  assert.equal((await call(store, 'POST', '/api/auth/name', { username: '철수', password: 'secret12' }, { token: g.data.token })).data.error, 'USERNAME_TAKEN');
  const named = await call(store, 'POST', '/api/auth/name', { username: '영희', password: 'secret12' }, { token: g.data.token });
  assert.equal(named.status, 200, JSON.stringify(named.data));
  assert.equal(named.data.state.user.guest, false);
  assert.equal(named.data.state.user.nickname, '영희');
  assert.equal(named.data.state.username, '영희');
  assert.equal(named.data.state.user.account.available, chips);
  assert.equal(named.data.state.user.id, g.data.state.user.id);
  assert.ok(named.data.state.invite.code);
  assert.equal((await call(store, 'GET', '/api/state', null, { token: g.data.token })).status, 401);
  assert.equal((await call(store, 'POST', '/api/auth/login', { username: '영희', password: 'secret12' })).status, 200);
  assert.equal((await call(store, 'POST', '/api/auth/name', { username: '영희2', password: 'secret12' }, { token: named.data.token })).data.error, 'NOT_A_GUEST');
});

test('guests are limited per device and cleared after they stop coming', async () => {
  const store = memoryStore();
  for (let i = 0; i < 3; i++) assert.equal((await call(store, 'POST', '/api/auth/guest', { terms: true }, { device: 'same-phone-01' })).status, 201);
  assert.equal((await call(store, 'POST', '/api/auth/guest', { terms: true }, { device: 'same-phone-01' })).data.error, 'GUEST_LIMIT');
  const state = store.peek();
  const ids = Object.keys(state.auth.guests);
  assert.equal(ids.length, 3);
  const later = Date.now() + (GUEST_IDLE_DAYS + 1) * 86_400_000;
  state.users[ids[0]].account.locked = 1_000_000; // still has chips on a table: kept
  const gone = pruneGuests(state, later);
  assert.deepEqual(gone.sort(), ids.slice(1).sort());
  assert.ok(state.users[ids[0]]);
  assert.ok(!Object.values(state.auth.sessions).some(s => gone.includes(s.userId)));
});

test('an invited friend and the inviter both get the reward after the friend finishes a round, once', async () => {
  const store = memoryStore();
  const host = await call(store, 'POST', '/api/auth/signup', { username: '한서2', password: 'secret12' }, { device: 'host-phone-1' });
  const code = host.data.state.invite.code;
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal((await call(store, 'GET', `/api/invite/info?r=${code}`)).data.inviter, '한서2');
  assert.equal((await call(store, 'GET', '/api/invite/info?r=NOPE99')).data.inviter, null);
  // The friend comes in as a guest through the link, plays, and only gets paid once named.
  const friend = await call(store, 'POST', '/api/auth/guest', { terms: true, ref: code }, { device: 'friend-phone' });
  await playOne(store, friend.data.token, 'friend-phone');
  const hostBefore = store.peek().users[host.data.state.user.id].account.available;
  assert.equal(store.peek().users[friend.data.state.user.id].referredBy.paidAt, undefined);
  const named = await call(store, 'POST', '/api/auth/name', { username: '친구1', password: 'secret12' }, { token: friend.data.token });
  assert.deepEqual(named.data.paid, { invitee: INVITE_REWARD, inviter: INVITE_REWARD });
  assert.equal(named.data.state.invite.invitedBy.paid, true);
  const s = store.peek();
  assert.equal(s.users[host.data.state.user.id].account.available, hostBefore + INVITE_REWARD);
  assert.equal(s.ledger.filter(x => x.type === 'INVITE_REWARD').length, 2);
  // More rounds pay nothing more.
  await call(store, 'POST', '/api/baccarat/play', { stake: 1_000_000, floor: 'gold-room', betType: 'BANKER' }, { token: named.data.token });
  assert.equal(store.peek().ledger.filter(x => x.type === 'INVITE_REWARD').length, 2);
  const hostView = await call(store, 'GET', '/api/state', null, { token: host.data.token });
  assert.equal(hostView.data.invite.paidThisMonth, 1);
  assert.equal(hostView.data.invite.friends[0].nickname, '친구1');
  assert.equal(hostView.data.feed.find(f => f.type === 'INVITE')?.friend, '친구1');

  // A 자랑하기 card's link (?from=nickname) names the inviter too.
  assert.equal((await call(store, 'GET', `/api/invite/info?r=${encodeURIComponent('@한서2')}`)).data.inviter, '한서2');
  // A direct sign-up through the link is paid on its first round.
  const direct = await call(store, 'POST', '/api/auth/signup', { username: '친구2', password: 'secret12', ref: code }, { device: 'friend-phone-2' });
  await playOne(store, direct.data.token, 'friend-phone-2');
  assert.equal(store.peek().ledger.filter(x => x.type === 'INVITE_REWARD').length, 4);
});

test('no invite reward for a friend on the inviter\'s own phone, or for yourself', async () => {
  const store = memoryStore();
  const host = await call(store, 'POST', '/api/auth/signup', { username: '호스트', password: 'secret12' }, { device: 'shared-phone' });
  const code = host.data.state.invite.code;
  const alt = await call(store, 'POST', '/api/auth/signup', { username: '부캐', password: 'secret12', ref: code }, { device: 'shared-phone' });
  await playOne(store, alt.data.token, 'shared-phone');
  assert.equal(store.peek().ledger.filter(x => x.type === 'INVITE_REWARD').length, 0);
  assert.equal(store.peek().users[alt.data.state.user.id].referredBy.blocked, 'SAME_DEVICE');
  // A device the inviter used later also counts: the friend's phone the inviter signed in on.
  const sneaky = await call(store, 'POST', '/api/auth/signup', { username: '부캐2', password: 'secret12', ref: code }, { device: 'phone-bbbb' });
  await call(store, 'POST', '/api/auth/login', { username: '호스트', password: 'secret12' }, { device: 'phone-bbbb' });
  await playOne(store, sneaky.data.token, 'phone-bbbb');
  assert.equal(store.peek().ledger.filter(x => x.type === 'INVITE_REWARD').length, 0);
});

test('the inviter is paid for at most the monthly cap of friends; the friends still are', () => {
  const state = defaultState();
  const host = state.users.hanseo;
  host.refCode = 'HOST01';
  host.invites = { month: new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7), paid: INVITE_MONTHLY_CAP };
  const friend = state.users.min;
  friend.referredBy = { userId: 'hanseo', at: new Date().toISOString() };
  friend.stats = { Baccarat: { rounds: 1 } };
  const before = host.account.available;
  assert.deepEqual(settleReferral(state, friend), { invitee: INVITE_REWARD, inviter: 0 });
  assert.equal(host.account.available, before);
});

test('invite links get a preview with the inviter and the game', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) assert.match(html, new RegExp(`property="${p}"`));
  const room = previewFor({ inviter: '한서', game: 'seotda', tier: 'gold-room', code: 'ABCD' }, 'https://v.example');
  assert.match(room.title, /한서님이 섯다/);
  assert.match(room.image, /^https:\/\/v\.example\/og\/seotda\.jpg$/);
  const plain = previewFor({ inviter: null, game: 'nope' }, 'https://v.example');
  assert.match(plain.image, /og\/vegas\.jpg$/);
  const out = injectPreview(html, previewFor({ inviter: '<b>x</b>', game: 'holdem', code: 'WXYZ' }, 'https://v.example'), 'https://v.example/j?join=WXYZ');
  assert.match(out, /<base href="\/">/);
  assert.match(out, /property="og:image" content="https:\/\/v\.example\/og\/holdem\.jpg"/);
  assert.ok(!out.includes('<b>x</b>'), 'names are escaped');
  assert.match(out, /<title>[^<]*홀덤/);
});
