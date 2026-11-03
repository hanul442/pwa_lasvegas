// The Durable Object's store (worker/index.mjs): it writes only the state chunks that changed,
// reads back exactly what it wrote, and wakes friends' room polls after each change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// worker/index.mjs imports `cloudflare:workers`; outside the Worker a bare base class stands in.
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
  return next(s, c);
}`)}`);
const { VegasFloor } = await import('../worker/index.mjs');

function fakeStorage() {
  const data = new Map(), puts = [];
  return {
    data, puts,
    async get(key) { return Array.isArray(key) ? new Map(key.map(k => [k, data.get(k)])) : data.get(key); },
    async put(entries) { puts.push(Object.keys(entries)); for (const [k, v] of Object.entries(entries)) data.set(k, v); },
    async delete(keys) { for (const k of [].concat(keys)) data.delete(k); }
  };
}
const floorOn = storage => new VegasFloor({ storage }, {});
const stateKeys = s => s.puts.flat().filter(k => k.startsWith('state:'));

test('a change writes only the chunks that differ, and a fresh object reads the same state back', async () => {
  const storage = fakeStorage();
  const floor = floorOn(storage);
  await floor.load();
  // Grow the state past one chunk, with the growing part at the end.
  await floor.mutate(s => { s.meta.padding = 'x'.repeat(600_000); });
  storage.puts.length = 0;
  await floor.mutate(s => { s.meta.padding += 'y'; });
  const n = storage.data.get('state:n');
  assert.ok(n >= 3, `${n} chunks`);
  assert.ok(stateKeys(storage).length < n, `wrote ${stateKeys(storage).join(',')} of ${n}`);
  const again = floorOn(storage);
  const back = await again.load();
  assert.equal(back.meta.padding.length, 600_001);
  assert.deepEqual(back, await floor.load());
});

test('a shrinking state drops its extra chunks', async () => {
  const storage = fakeStorage();
  const floor = floorOn(storage);
  await floor.mutate(s => { s.meta.padding = 'x'.repeat(900_000); });
  const big = storage.data.get('state:n');
  await floor.mutate(s => { delete s.meta.padding; });
  const small = storage.data.get('state:n');
  assert.ok(small < big);
  assert.equal(storage.data.has(`state:${small}`), false);
  assert.equal((await floorOn(storage).load()).meta.padding, undefined);
});

test('a failed change is not kept, and the next one reads storage again and lands', async () => {
  const storage = fakeStorage();
  const floor = floorOn(storage);
  await floor.mutate(s => { s.meta.note = 'a'; });
  await assert.rejects(floor.mutate(s => { s.meta.note = 'b'; throw new Error('NOPE'); }), /NOPE/);
  assert.equal((await floor.load()).meta.note, 'a');
  await floor.mutate(s => { s.meta.note = 'c'; });
  assert.equal((await floorOn(storage).load()).meta.note, 'c');
});

test('a change wakes a waiting room poll', async () => {
  const floor = floorOn(fakeStorage());
  await floor.load();
  const t = Date.now();
  const waiting = floor.store.changed(5000);
  await floor.store.mutate(s => { s.meta.note = 'moved'; });
  await waiting;
  assert.ok(Date.now() - t < 1000);
});
