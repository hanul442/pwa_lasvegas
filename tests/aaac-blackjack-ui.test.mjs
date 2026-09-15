import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('AAAC immersive blackjack stylesheet loads after base and luxury layers', () => {
  const index = read('public/index.html');
  const base = index.indexOf('/blackjack-v2.css');
  const luxury = index.indexOf('/aaac-luxury-shell.css');
  const immersive = index.indexOf('/aaac-blackjack-immersive.css');

  assert.ok(base >= 0, 'base blackjack stylesheet must be present');
  assert.ok(luxury > base, 'AAAC luxury shell must load after base blackjack styles');
  assert.ok(immersive > luxury, 'immersive blackjack layer must load last');
});

test('AAAC immersive blackjack keeps mobile vertical scrolling available', () => {
  const css = read('public/aaac-blackjack-immersive.css');

  assert.match(css, /\.bjv2-overlay\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.bjv2-overlay\{[^}]*overflow-y:auto/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
});

test('PWA shell caches both AAAC presentation layers', () => {
  const sw = read('public/sw.js');

  assert.match(sw, /social-vegas-shell-v19/);
  assert.match(sw, /'\/aaac-luxury-shell\.css'/);
  assert.match(sw, /'\/aaac-blackjack-immersive\.css'/);
});

test('AAAC immersive layer stays presentation-only', () => {
  const css = read('public/aaac-blackjack-immersive.css').toLowerCase();
  for (const forbidden of ['deposit', 'withdraw', 'cash-out', 'cashout', 'real-money', 'redeemable']) {
    assert.equal(css.includes(forbidden), false, `presentation CSS must not introduce ${forbidden}`);
  }
});
