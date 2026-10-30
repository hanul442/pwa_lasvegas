// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
// 처음 온 사람의 첫날 (public/js/first-day.js): the starting chips are no floor news, a hand counts
// in stats so the first-day home steps aside, and home keeps quiet for the first hands.
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
const call = (store, method, path, body, { token, device } = {}) => handleApi({
  method,
  header: h => ({ authorization: token ? `Bearer ${token}` : undefined, 'x-device': device, 'x-idempotency-key': `k-first-${++n}` })[h],
  body: async () => body ?? {}
}, new URL(`http://x${path}`), store, { NODE_ENV: 'production', AUTH_REQUIRED: true });

// The same rules as public/js/first-day.js (that file imports the DOM helpers).
const handsPlayed = st => Object.values(st?.user?.stats || {}).reduce((sum, s) => sum + (Number(s?.rounds) || 0), 0);
const isNewcomer = st => Boolean(st?.user) && !st.user.account?.totalWagered && handsPlayed(st) === 0;

test('a new guest starts as a newcomer with no floor news, and one hand ends that', async () => {
  const store = memoryStore();
  const device = 'dev-first-day-01';
  const res = await call(store, 'POST', '/api/auth/guest', { terms: true }, { device });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const { token, state } = res.data;
  assert.ok(isNewcomer(state));
  const me = state.user.id;
  assert.equal(store.peek().feed.filter(f => f.type === 'FLOOR_UNLOCK' && f.actorId === me).length, 0, 'starting chips are no news');
  const play = await call(store, 'POST', '/api/baccarat/play', { stake: 1_000_000, floor: 'gold-room', betType: 'BANKER' }, { token, device });
  assert.equal(play.status, 200, JSON.stringify(play.data));
  assert.equal(handsPlayed(play.data.state), 1);
  assert.ok(!isNewcomer(play.data.state));
});

test('the client rules match first-day.js and the lobby popups wait for them', async () => {
  const src = await readFile(new URL('../public/js/first-day.js', import.meta.url), 'utf8');
  assert.match(src, /export const QUIET_HANDS = 3;/);
  assert.match(src, /!st\.user\.account\?\.totalWagered && handsPlayed\(st\) === 0/);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /isActive\('lobby'\) && !isSettlingIn\(state\)\) \{ if \(!seasonMoment/);
  assert.match(app, /name === 'lobby' && state && !isSettlingIn\(state\)\) \{ celebrateFloors/);
  const news = await readFile(new URL('../public/js/news.js', import.meta.url), 'utf8');
  assert.match(news, /is-settling/);
  const guest = await readFile(new URL('../public/js/guest.js', import.meta.url), 'utf8');
  assert.match(guest, /game-mode/, 'the name nudge waits until off the table');
});
