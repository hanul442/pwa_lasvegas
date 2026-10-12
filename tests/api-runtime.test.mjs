import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { forceHotTable } from '../lib/hot-table.mjs';

// These tests count exact payouts: keep 핫 딜러 타임 (lib/hot-table.mjs) out of them whatever the hour.
forceHotTable('off');

// The same handler runs in the Node server and the Cloudflare Worker, so it must work
// against any store that offers load() and mutate().
function memoryStore() {
  let state = defaultState();
  // Mid-way through High Limit (1억–10억 net worth), so a few wins don't graduate the floor.
  state.users.hanseo.account.available = 300_000_000;
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
  const res = await call(store, 'POST', '/api/sicbo/play', { stake: 10_000_000, floor: 'high-limit', betType: 'BIG' }, { 'x-idempotency-key': 'k-test-1' });
  assert.equal(res.status, 200);
  assert.equal(res.data.state.user.account.available, start + res.data.round.netPnl);
  const replay = await call(store, 'POST', '/api/sicbo/play', { stake: 10_000_000, floor: 'high-limit', betType: 'BIG' }, { 'x-idempotency-key': 'k-test-1' });
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.state.user.account.available, res.data.state.user.account.available);
});

test('failed bets leave the stored state untouched', async () => {
  const store = memoryStore();
  const before = (await call(store, 'GET', '/api/state')).data.user.account.available;
  const res = await call(store, 'POST', '/api/roulette/play', { stake: 1, floor: 'high-limit', betType: 'RED' });
  assert.equal(res.status, 400);
  assert.equal((await call(store, 'GET', '/api/state')).data.user.account.available, before);
});

test('dev reset is closed in production and unknown routes 404', async () => {
  const store = memoryStore();
  assert.equal((await call(store, 'POST', '/api/dev/reset')).status, 404);
  assert.equal((await call(store, 'GET', '/api/nope')).status, 404);
});

test('worker-bound modules never touch node:fs', async () => {
  for (const file of ['lib/api.mjs', 'lib/state.mjs', 'lib/games.mjs', 'lib/economy.mjs', 'lib/blackjack-v2.mjs', 'lib/holdem.mjs', 'lib/holdem-bot.mjs', 'lib/holdem-session.mjs', 'worker/index.mjs']) {
    assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /node:fs|node:path/, file);
  }
});

test('blackjack start takes one stake per box and settles insurance through the action route', async () => {
  const store = memoryStore();
  const bad = await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [10_000_000, 10_000_000, 10_000_000, 10_000_000], floor: 'high-limit' }, { 'x-idempotency-key': 'bj-key-bad-0001' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'INVALID_SPOTS');
  const tiny = await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [10_000_000, 1], floor: 'high-limit' }, { 'x-idempotency-key': 'bj-key-tiny-0001' });
  assert.equal(tiny.status, 400);

  const before = (await call(store, 'GET', '/api/state')).data.user.account.available;
  const res = await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [10_000_000, 20_000_000, 30_000_000], floor: 'high-limit' }, { 'x-idempotency-key': 'bj-key-three-0001' });
  assert.equal(res.status, 200);
  let round = res.data.round;
  assert.deepEqual(round.hands.map(h => h.stake), [10_000_000, 20_000_000, 30_000_000]);
  let n = 0;
  while (round.status !== 'SETTLED') {
    const action = round.status === 'INSURANCE' ? 'INSURANCE' : 'STAND';
    const step = await call(store, 'POST', '/api/blackjack/v2/action', { roundId: round.id, action, handIndex: round.activeHand }, { 'x-idempotency-key': `bj-key-step-${String(n++).padStart(4, '0')}` });
    assert.equal(step.status, 200, JSON.stringify(step.data));
    round = step.data.round;
  }
  const after = (await call(store, 'GET', '/api/state')).data.user.account;
  assert.equal(after.locked, 0);
  assert.equal(after.available, before + round.netPnl);
});

test('baccarat takes optional pair side bets in the same round and ledger entry', async () => {
  const store = memoryStore();
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  const body = { stake: 10_000_000, floor: 'high-limit', betType: 'PLAYER', sideBets: { PLAYER_PAIR: 3_000_000, BANKER_PAIR: 5_000_000 } };
  const res = await call(store, 'POST', '/api/baccarat/play', body, { 'x-idempotency-key': 'bac-side-0001' });
  assert.equal(res.status, 200);
  const r = res.data.round;
  assert.equal(r.stake, 18_000_000);
  assert.equal(r.sideBets.length, 2);
  for (const b of r.sideBets) assert.equal(b.netPnl, r.pairs[b.betType] ? b.stake * 11 : -b.stake);
  assert.equal(r.netPnl, r.mainPnl + r.sideBets.reduce((a, b) => a + b.netPnl, 0));
  assert.equal(res.data.state.user.account.available, start + r.netPnl);
  const tx = res.data.state.ledger.find(x => x.referenceId === r.id);
  assert.equal(tx.metadata.stake, 18_000_000);
  assert.equal(tx.amount, r.netPnl);
  // A replay matches only the same side bets.
  const replay = await call(store, 'POST', '/api/baccarat/play', body, { 'x-idempotency-key': 'bac-side-0001' });
  assert.equal(replay.data.replayed, true);
  const changed = await call(store, 'POST', '/api/baccarat/play', { ...body, sideBets: { PLAYER_PAIR: 3_000_000 } }, { 'x-idempotency-key': 'bac-side-0001' });
  assert.equal(changed.status, 409);
  // The old single-bet request still works; bad side stakes are refused.
  assert.equal((await call(store, 'POST', '/api/baccarat/play', { stake: 10_000_000, floor: 'high-limit', betType: 'BANKER' })).status, 200);
  assert.equal((await call(store, 'POST', '/api/baccarat/play', { ...body, sideBets: { PLAYER_PAIR: -5 } })).status, 400);
  assert.equal((await call(store, 'POST', '/api/baccarat/play', { ...body, sideBets: { PLAYER_PAIR: 2_500_000 } })).data.error, 'BET_NOT_IN_UNITS');
  assert.equal((await call(store, 'POST', '/api/baccarat/play', { ...body, sideBets: { PLAYER_PAIR: 200_000_000 } })).status, 400);
  const before = (await call(store, 'GET', '/api/state')).data.user.account.available;
  assert.equal((await call(store, 'POST', '/api/baccarat/play', { ...body, stake: 100_000_000, sideBets: { PLAYER_PAIR: 100_000_000, BANKER_PAIR: 100_000_000 } }, {})).status, before < 300_000_000 ? 409 : 200);
});

test('lightning roulette spin: the server strikes the numbers and a retry replays them', async () => {
  const store = memoryStore();
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  const body = { floor: 'high-limit', lightning: true, bets: [{ betType: 'NUMBER', target: 17, stake: 10_000_000 }, { betType: 'RED', stake: 10_000_000 }] };
  const res = await call(store, 'POST', '/api/roulette/spin', body, { 'x-idempotency-key': 'k-lightning-1' });
  assert.equal(res.status, 200);
  const r = res.data.round;
  assert.ok(r.lightning.length >= 1 && r.lightning.length <= 5);
  const hit = r.lightning.find(s => s.number === 17);
  assert.equal(r.bets[0].netPnl, r.number !== 17 ? -10_000_000 : hit ? 10_000_000 * hit.multiplier - 10_000_000 : 290_000_000);
  assert.equal(res.data.state.user.account.available, start + r.netPnl);
  const replay = await call(store, 'POST', '/api/roulette/spin', body, { 'x-idempotency-key': 'k-lightning-1' });
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.round.lightning, r.lightning);
  assert.equal(replay.data.state.user.account.available, res.data.state.user.account.available);
  // The same key with the mode switched off is a different request.
  const flipped = await call(store, 'POST', '/api/roulette/spin', { ...body, lightning: false }, { 'x-idempotency-key': 'k-lightning-1' });
  assert.equal(flipped.status, 409);
  // Without the flag the table is the plain one.
  const plain = await call(store, 'POST', '/api/roulette/spin', { ...body, lightning: undefined }, { 'x-idempotency-key': 'k-lightning-2' });
  assert.equal(plain.data.round.lightning, undefined);
});
