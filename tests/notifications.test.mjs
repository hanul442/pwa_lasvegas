// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { defaultState } from '../lib/state.mjs';
import { handleApi } from '../lib/api.mjs';
import { claimDaily } from '../lib/engagement.mjs';
import { b64url, fromB64url, encryptPayload, generateVapidKeys, vapidAuthorization } from '../lib/webpush.mjs';
import { messageFor, planPushes, runPushRound, subscribe, formatWon, ensureVapid } from '../lib/notifications.mjs';
const ensureVapidFor = ensureVapid;

const HOUR = 3_600_000, DAY = 24 * HOUR;
// Seoul clock helpers: 2026-10-14 at hh:00 KST.
const kst = (h, d = 0) => Date.parse('2026-10-14T00:00:00Z') - 9 * HOUR + h * HOUR + d * DAY;

function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint: `https://push.example.com/send/${crypto.randomUUID()}`, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } } };
}

// RFC 8291 decryption, as a browser would do it, to prove the payload is readable.
async function decrypt(body, ecdh, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const shared = ecdh.computeSecret(asPublic);
  const h = (salt, ikm, info, n) => new Uint8Array(crypto.hkdfSync('sha256', ikm, salt, info, n));
  const ikm = h(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32);
  const cek = h(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = h(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, -1).toString();
}

function memoryStore(state = defaultState()) {
  return { state, load: async () => state, mutate: async fn => fn(state) };
}

test('payload encryption follows RFC 8291 and VAPID tokens verify', async () => {
  const { ecdh, auth, sub } = browserKeys();
  const body = await encryptPayload(sub, '{"title":"출석"}');
  assert.equal(await decrypt(Buffer.from(body), ecdh, auth), '{"title":"출석"}');

  const vapid = await generateVapidKeys();
  assert.equal(fromB64url(vapid.publicKey).length, 65);
  const header = await vapidAuthorization(sub.endpoint, vapid, 'mailto:x@y.z', Date.parse('2026-10-14T00:00:00Z'));
  const [, jwt, k] = header.match(/^vapid t=(.+), k=(.+)$/);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(fromB64url(c)).toString()), { aud: 'https://push.example.com', exp: Date.parse('2026-10-14T12:00:00Z') / 1000, sub: 'mailto:x@y.z' });
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: vapid.privateJwk.x, y: vapid.privateJwk.y }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, fromB64url(s)));
  assert.equal(k, vapid.publicKey);
});

test('amounts read like the app', () => {
  assert.equal(formatWon(5_000_000), '500만원');
  assert.equal(formatWon(120_000_000), '1억 2천만원');
  assert.equal(formatWon(50_000_000), '5천만원');
});

test('subscribing over the API stores the device on the signed-in player only', async () => {
  const store = memoryStore();
  const req = (method, body, player = 'hanseo') => ({ method, header: n => ({ 'x-player-id': player, origin: 'https://vegas.example' })[n], body: async () => body });
  const key = await handleApi(req('GET'), new URL('http://x/api/push/key'), store);
  assert.equal(key.status, 200);
  assert.equal(fromB64url(key.data.publicKey).length, 65);
  // The key is made once and kept.
  assert.equal((await handleApi(req('GET'), new URL('http://x/api/push/key'), store)).data.publicKey, key.data.publicKey);

  const { sub } = browserKeys();
  assert.equal((await handleApi(req('POST', { subscription: sub }), new URL('http://x/api/push/subscribe'), store)).data.devices, 1);
  assert.equal(store.state.push.origin, 'https://vegas.example');
  assert.equal((await handleApi(req('POST', { subscription: { endpoint: 'http://evil', keys: {} } }), new URL('http://x/api/push/subscribe'), store)).status, 400);
  // Signing in as someone else on the same phone moves the device to them.
  await handleApi(req('POST', { subscription: sub }, 'min'), new URL('http://x/api/push/subscribe'), store);
  assert.equal(store.state.users.hanseo.push.subs.length, 0);
  assert.equal(store.state.users.min.push.subs.length, 1);
  await handleApi(req('POST', { endpoint: sub.endpoint }, 'min'), new URL('http://x/api/push/unsubscribe'), store);
  assert.equal(store.state.users.min.push.subs.length, 0);
  // Nothing about push leaks into the public profile.
  const state = await handleApi(req('GET'), new URL('http://x/api/state'), store);
  assert.equal(JSON.stringify(state.data).includes('push.example.com'), false);
});

test('the test notification reaches every device of the player', async () => {
  const store = memoryStore();
  const { ecdh, auth, sub } = browserKeys();
  const seen = [];
  const pushFetch = async (url, init) => { seen.push(JSON.parse(await decrypt(Buffer.from(init.body), ecdh, auth))); assert.match(init.headers.authorization, /^vapid t=/); return new Response(null, { status: 201 }); };
  const req = (method, body) => ({ method, header: n => ({ 'x-player-id': 'hanseo' })[n], body: async () => body });
  assert.equal((await handleApi(req('POST', {}), new URL('http://x/api/push/test'), store, { pushFetch })).status, 409);
  await handleApi(req('GET'), new URL('http://x/api/push/key'), store);
  await handleApi(req('POST', { subscription: sub }), new URL('http://x/api/push/subscribe'), store);
  const out = await handleApi(req('POST', {}), new URL('http://x/api/push/test'), store, { pushFetch });
  assert.equal(out.data.sent, 1);
  assert.equal(seen[0].title, '알림이 켜졌어요');
});

function subscribedPlayer(lastSeen) {
  const state = defaultState();
  const u = state.users.hanseo;
  u.createdAt = new Date(lastSeen - 30 * DAY).toISOString();
  state.ledger = state.ledger.map(t => ({ ...t, createdAt: new Date(lastSeen - 30 * DAY).toISOString() }));
  subscribe(state, u, browserKeys().sub, lastSeen);
  return { state, u };
}

test('the daily bonus reminder comes once in the morning, never at night or mid-game', () => {
  const { state, u } = subscribedPlayer(kst(8, -1));
  assert.equal(messageFor(state, u, kst(3)), null); // 3 a.m.
  assert.equal(messageFor(state, u, kst(9)), null); // too early for the morning slot
  const first = planPushes(state, kst(10));
  assert.equal(first.length, 1);
  assert.match(first[0].message.title, /오늘 일급 100억원/);
  assert.equal(planPushes(state, kst(11)).length, 0); // once a day
  // Someone playing right now is left alone.
  const fresh = subscribedPlayer(kst(9, 0));
  assert.equal(messageFor(fresh.state, fresh.u, kst(10)), null);
  // Already claimed: nothing to remind.
  const claimed = subscribedPlayer(kst(8, -1));
  claimDaily(claimed.state, claimed.u, kst(8, -1) + 1);
  claimDaily(claimed.state, claimed.u, kst(7));
  claimed.u.push.lastSeenAt = new Date(kst(7)).toISOString();
  claimed.state.ledger.forEach(t => { t.createdAt = new Date(kst(7)).toISOString(); });
  assert.equal(messageFor(claimed.state, claimed.u, kst(10)), null);
});

test('the evening slot offers unclaimed missions, then free chips, then the streak warning', () => {
  const { state, u } = subscribedPlayer(kst(8, -1));
  u.missions = { day: '2026-10-14', items: [{ id: 'rounds-any', progress: 10, claimed: false }, { id: 'variety', progress: 0, claimed: false }, { id: 'streak-3', progress: 0, claimed: false }], games: [], swept: false };
  planPushes(state, kst(10));
  const evening = planPushes(state, kst(19));
  assert.equal(evening[0].message.tag, 'missions');
  assert.match(evening[0].message.body, /4천만원/);
  assert.equal(planPushes(state, kst(20)).length, 0);

  const broke = subscribedPlayer(kst(8, -1));
  broke.u.account.available = 0;
  planPushes(broke.state, kst(10));
  assert.equal(planPushes(broke.state, kst(19))[0].message.tag, 'free-chips');

  const streaky = subscribedPlayer(kst(8, -1));
  streaky.u.daily = { lastClaim: '2026-10-13', streak: 4 };
  planPushes(streaky.state, kst(10));
  assert.match(planPushes(streaky.state, kst(21))[0].message.title, /4일 연속 출근이 끊기려고/);
});

test('players who stay away get a come-back nudge every few days, then we stop', () => {
  const { state, u } = subscribedPlayer(kst(15, -4));
  assert.equal(messageFor(state, u, kst(10)), null); // come-backs wait for the afternoon
  const first = planPushes(state, kst(13));
  assert.equal(first[0].message.title, '요즘 안 보이시네요');
  assert.equal(planPushes(state, kst(13, 1)).length, 0);
  assert.equal(planPushes(state, kst(16, 3))[0].message.title, '일주일 넘게 안 오셨네요');
  assert.match(planPushes(state, kst(13, 11))[0].message.title, /많이 조용해요/);
  assert.equal(messageFor(state, u, kst(13, 40)), null);
});

test('a cron round sends, then forgets devices the browser dropped', async () => {
  const { state, u } = subscribedPlayer(kst(8, -1));
  subscribe(state, u, browserKeys().sub, kst(8, -1));
  const store = memoryStore(state);
  let calls = 0;
  const fetchFn = async () => new Response(null, { status: calls++ === 0 ? 201 : 410 });
  const out = await runPushRound(store, { now: kst(10), fetchFn });
  assert.deepEqual(out, { players: 1, sent: 1, gone: 1 });
  assert.equal(u.push.subs.length, 1);
});

test('big news reads per player: others see the jackpot, duels reach both sides', async () => {
  const { newsFor } = await import('../lib/news.mjs');
  const { pushFeed } = await import('../lib/engagement.mjs');
  const { createChallenge } = await import('../lib/social-competition.mjs');
  const state = defaultState();
  const since = Date.now() - 1000;
  pushFeed(state, { type: 'JACKPOT', actorId: 'min', game: 'Slots', amount: 250_000_000 });
  pushFeed(state, { type: 'HOT_WIN', actorId: 'zero', game: 'Roulette', amount: 35_000_000, multiple: 35 });
  createChallenge(state, 'min', 'hanseo', 'WINS');
  const mine = newsFor(state, 'hanseo', since);
  assert.deepEqual(mine.map(n => n.type).sort(), ['DUEL_IN', 'HOT_WIN', 'JACKPOT']);
  assert.match(mine.find(n => n.type === 'JACKPOT').body, /MIN님이 슬롯 잭팟 2억 5천만원/);
  assert.equal(mine.find(n => n.type === 'HOT_WIN').push, true); // 35x: big enough for phones
  pushFeed(state, { type: 'HOT_WIN', actorId: 'june', game: 'Baccarat', amount: 20_000_000, multiple: 1 });
  pushFeed(state, { type: 'BANKRUPTCY', actorId: 'june' });
  const later = newsFor(state, 'hanseo', since);
  assert.equal(later.find(n => n.type === 'HOT_WIN' && n.body.includes('바카라')).push, false); // 2천만 at 1x: banner only
  assert.equal(later.find(n => n.type === 'BANKRUPTCY').push, true);
  // The jackpot winner doesn't get a banner about themselves.
  assert.equal(newsFor(state, 'min', since).some(n => n.type === 'JACKPOT'), false);
  assert.deepEqual(newsFor(state, 'hanseo', Date.now() + 1000), []);
});

test('a jackpot pushes to subscribed players right away, at most every two hours', async () => {
  const { state, u } = subscribedPlayer(kst(8, -1));
  const store = memoryStore(state);
  await ensureVapidFor(state);
  const seen = [];
  const pushFetch = async (url, init) => { seen.push(init); return new Response(null, { status: 201 }); };
  const realNow = Date.now;
  let clock = kst(14);
  Date.now = () => clock;
  try {
    const req = { method: 'POST', header: n => ({ 'x-player-id': 'min' })[n], body: async () => ({}) };
    // The first change only starts the clock; the jackpot comes with the next one.
    await handleApi(req, new URL('http://x/api/daily/claim'), store, { pushFetch });
    const { pushFeed } = await import('../lib/engagement.mjs');
    state.users.min.account.available = 0;
    await store.mutate(s => pushFeed(s, { type: 'JACKPOT', actorId: 'min', game: 'Slots', amount: 300_000_000, createdAt: new Date(kst(14) + 1000).toISOString() }));
    await handleApi({ ...req, body: async () => ({ kind: 'welfare' }) }, new URL('http://x/api/support/claim'), store, { pushFetch });
    assert.equal(seen.length, 1);
    assert.ok(u.push.sent.newsAt);
    clock = kst(15);
    await store.mutate(s => pushFeed(s, { type: 'JACKPOT', actorId: 'min', game: 'Slots', amount: 300_000_000, createdAt: new Date(kst(15) - 1000).toISOString() }));
    await handleApi({ ...req, header: n => ({ 'x-player-id': 'zero' })[n] }, new URL('http://x/api/daily/claim'), store, { pushFetch });
    assert.equal(seen.length, 1);
  } finally { Date.now = realNow; }
});

test("Chrome's padded keys are accepted and the test push still decrypts", async () => {
  const store = memoryStore();
  const { ecdh, auth, sub } = browserKeys();
  // Chrome on Android sends base64url with '=' padding.
  const padded = { endpoint: sub.endpoint, keys: { p256dh: Buffer.from(ecdh.getPublicKey()).toString('base64url') + '=', auth: Buffer.from(auth).toString('base64') } };
  assert.match(padded.keys.auth, /=$/);
  const seen = [];
  const pushFetch = async (url, init) => { seen.push(JSON.parse(await decrypt(Buffer.from(init.body), ecdh, auth))); return new Response(null, { status: 201 }); };
  const req = (method, body) => ({ method, header: n => ({ 'x-player-id': 'hanseo' })[n], body: async () => body });
  await handleApi(req('GET'), new URL('http://x/api/push/key'), store);
  const out = await handleApi(req('POST', { subscription: padded }), new URL('http://x/api/push/subscribe'), store);
  assert.equal(out.status, 200);
  assert.equal(store.state.users.hanseo.push.subs[0].keys.p256dh.includes('='), false);
  const test = await handleApi(req('POST', {}), new URL('http://x/api/push/test'), store, { pushFetch });
  assert.deepEqual(test.data, { sent: 1, devices: 1, statuses: [201] });
  assert.equal(seen[0].title, '알림이 켜졌어요');
});
