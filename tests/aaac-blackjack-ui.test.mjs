import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('AAAC blackjack presentation layers load in deterministic order', () => {
  const index = read('public/index.html');
  const base = index.indexOf('/blackjack-v2.css');
  const luxury = index.indexOf('/aaac-luxury-shell.css');
  const immersive = index.indexOf('/aaac-blackjack-immersive.css');
  const cinematic = index.indexOf('/aaac-blackjack-cinematic.css');

  assert.ok(base >= 0, 'base blackjack stylesheet must be present');
  assert.ok(luxury > base, 'AAAC luxury shell must load after base blackjack styles');
  assert.ok(immersive > luxury, 'immersive blackjack layer must load after luxury shell');
  assert.ok(cinematic > immersive, 'cinematic moment layer must load last');
});

test('AAAC immersive blackjack keeps mobile vertical scrolling available', () => {
  const css = read('public/aaac-blackjack-immersive.css');

  assert.match(css, /\.bjv2-overlay\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.bjv2-overlay\{[^}]*overflow-y:auto/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
});

test('cinematic layer reacts only to existing visual blackjack states', () => {
  const css = read('public/aaac-blackjack-cinematic.css');

  assert.match(css, /\.bjv2-round-result\.win/);
  assert.match(css, /\.bjv2-round-result\.loss/);
  assert.match(css, /\.bjv2-hand\.active/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /url\s*\(/i, 'cinematic CSS must not add remote assets');
});

test('PWA shell caches all AAAC presentation layers', () => {
  const sw = read('public/sw.js');

  assert.match(sw, /social-vegas-shell-v20/);
  assert.match(sw, /'\/aaac-luxury-shell\.css'/);
  assert.match(sw, /'\/aaac-blackjack-immersive\.css'/);
  assert.match(sw, /'\/aaac-blackjack-cinematic\.css'/);
});

test('AAAC presentation layers stay economy-neutral', () => {
  const css = `${read('public/aaac-blackjack-immersive.css')}\n${read('public/aaac-blackjack-cinematic.css')}`.toLowerCase();
  for (const forbidden of ['deposit', 'withdraw', 'cash-out', 'cashout', 'real-money', 'redeemable']) {
    assert.equal(css.includes(forbidden), false, `presentation CSS must not introduce ${forbidden}`);
  }
});