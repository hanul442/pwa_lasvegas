import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const fx = readFileSync(new URL('../public/js/fx.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const list = src => JSON.parse(`[${src}]`.replace(/'/g, '"').replace(/,\s*]/, ']'));
const files = list(fx.match(/export const SFX_FILES = \[([^\]]+)\]/)[1]);

test('every recorded table sound exists and is small', () => {
  assert.ok(files.length >= 30);
  let total = 0;
  for (const name of files) {
    const path = new URL(`../public/sfx/${name}.m4a`, import.meta.url);
    assert.ok(existsSync(path), `${name}.m4a missing`);
    total += statSync(path).size;
  }
  assert.ok(total < 300_000, `sounds are ${total} bytes`);
});

test('every sound set only uses listed files', () => {
  const sets = fx.match(/export const SFX_SETS = \{([\s\S]+?)\n\};/)[1];
  for (const name of sets.match(/'[a-z0-9-]+'/g).map(s => s.slice(1, -1))) assert.ok(files.includes(name), name);
});

test('the service worker caches exactly the same sounds', () => {
  const cached = sw.match(/\.\.\.'(card-deal-1[^']+)'\.split/)[1].split(' ');
  assert.deepEqual([...cached].sort(), [...files].sort());
});
