// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { startMatgo, runMatgoAi, matgoNet, nextDouble } from '../lib/matgo.mjs';
import { startGostop, runGostopAi, gostopNet } from '../lib/gostop.mjs';

// A seeded integer rng so the same hand can be replayed with and without 묻고 더블.
function seeded(seed) {
  let a = seed >>> 0;
  return max => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max); };
}
const aiSeats = n => Array.from({ length: n }, (_, i) => ({ kind: 'ai', name: `AI${i}` }));
const playMatgo = (seed, double) => { const r = startMatgo({ stake: 100, seats: aiSeats(2), rng: seeded(seed), first: 0, double }); runMatgoAi(r, [], seeded(seed + 1)); return r; };
const playGostop = (seed, double) => { const r = startGostop({ stake: 100, seats: aiSeats(3), rng: seeded(seed), first: 0, double }); runGostopAi(r, [], seeded(seed + 1)); return r; };

test('묻고 더블 pays a 맞고 hand that many times over', () => {
  for (let seed = 1; seed < 40; seed++) {
    const plain = playMatgo(seed, 1), doubled = playMatgo(seed, 4);
    assert.equal(doubled.result.winner, plain.result.winner);
    assert.equal(doubled.result.points, plain.result.points * 4);
    assert.ok(doubled.result.multipliers.some(m => m.label === '묻고 더블' && m.times === 4));
    assert.equal(matgoNet(doubled, plain.result.winner), matgoNet(plain, plain.result.winner) * 4);
  }
});

test('묻고 더블 doubles every 고스톱 share, and a 나가리 offers the next step up to ×8', () => {
  let nagari = 0;
  for (let seed = 1; seed < 40; seed++) {
    const plain = playGostop(seed, 1), doubled = playGostop(seed, 2);
    if (plain.result.winner === null) {
      nagari++;
      assert.equal(plain.result.nextDouble, 2);
      assert.equal(doubled.result.nextDouble, 4);
      assert.equal(playGostop(seed, 8).result.nextDouble, 8);
      continue;
    }
    doubled.result.shares.forEach((s, i) => assert.equal(s.points, plain.result.shares[i].points * 2));
    for (let seat = 0; seat < 3; seat++) assert.equal(gostopNet(doubled, seat), gostopNet(plain, seat) * 2);
  }
  assert.ok(nagari > 0);
  assert.equal(nextDouble({ double: 8 }), 8);
  assert.throws(() => startGostop({ stake: 100, double: 3 }), /INVALID_DOUBLE/);
});

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
const call = (store, method, path, body) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? `k-room-${++n}` : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('a solo 나가리 waits on the account until the next hand takes it or turns it down', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  const user = () => Object.values(store.peek().users)[0];
  await store.mutate(s => { Object.values(s.users)[0].nagari = { Matgo: 4 }; });
  assert.equal((await call(store, 'GET', '/api/matgo/open')).data.double, 4);
  const res = await call(store, 'POST', '/api/matgo/start', { stake: 10_000_000, floor: 'high-limit', double: true });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.round.double, 4);
  assert.equal(user().nagari.Matgo, undefined);

  await store.mutate(s => { Object.values(s.users)[0].nagari = { Gostop: 2 }; });
  const fresh = await call(store, 'POST', '/api/gostop/start', { stake: 10_000_000, floor: 'high-limit', double: false });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.data));
  assert.equal(fresh.data.round.double, 1, 'turning it down plays a plain hand');
  assert.equal(user().nagari.Gostop, undefined);
});

test('더블 오어 낫띵 stakes a fresh baccarat win on one card and can be pressed three times', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  let win = null;
  for (let i = 0; i < 40 && !win; i++) {
    const res = await call(store, 'POST', '/api/baccarat/play', { stake: 10_000_000, floor: 'high-limit', betType: 'PLAYER' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    if (res.data.round.netPnl > 0) win = res.data.round;
  }
  assert.ok(win, 'a baccarat win within 40 hands');
  const before = (await call(store, 'GET', '/api/state')).data.user.account.available;
  let res = await call(store, 'POST', '/api/double', { roundId: win.id, pick: 'RED' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  let d = res.data.double;
  assert.equal(d.stake, win.netPnl);
  assert.equal(d.won, d.color === 'RED');
  assert.equal(res.data.state.user.account.available, before + d.netPnl);
  // The same win cannot be gambled twice.
  assert.equal((await call(store, 'POST', '/api/double', { roundId: win.id, pick: 'BLACK' })).status, 409);
  let steps = 1;
  while (d.won && d.next) {
    assert.equal(d.next, d.stake * 2);
    res = await call(store, 'POST', '/api/double', { roundId: d.id, pick: 'BLACK' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    d = res.data.double; steps++;
  }
  assert.ok(steps <= 3);
  if (d.won) assert.equal(d.next, null, 'stops after the third press');
  // A loss gives nothing more to press.
  if (!d.won) assert.equal((await call(store, 'POST', '/api/double', { roundId: d.id, pick: 'RED' })).status, 409);
  assert.equal((await call(store, 'POST', '/api/double', { roundId: win.id, pick: 'GREEN' })).status, 400);
});
