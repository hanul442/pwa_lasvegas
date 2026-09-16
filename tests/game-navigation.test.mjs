import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('game navigation layer loads after the core app and is cached for PWA use', () => {
  const index = read('public/index.html');
  const sw = read('public/sw.js');
  assert.ok(index.indexOf('/game-navigation.js') > index.indexOf('/app.js'));
  assert.match(sw, /social-vegas-shell-v21/);
  assert.match(sw, /'\/game-navigation\.js'/);
});

test('game entry creates a reversible browser-history boundary', () => {
  const js = read('public/game-navigation.js');
  assert.match(js, /closest\?\.\('\[data-game\]'\)/);
  assert.match(js, /history\.pushState\(/);
  assert.match(js, /svGameModal/);
  assert.match(js, /addEventListener\('popstate'/);
});

test('game overlays support Escape and restore focus without touching economy state', () => {
  const js = read('public/game-navigation.js');
  assert.match(js, /event\.key !== 'Escape'/);
  assert.match(js, /\[data-close\]/);
  assert.match(js, /focus\(\{ preventScroll: true \}\)/);
  for (const forbidden of ['/api/', 'stake', 'bankroll', 'deposit', 'withdraw', 'cashout', 'cash-out', 'redeemable']) {
    assert.equal(js.toLowerCase().includes(forbidden), false, `navigation layer must not alter economy via ${forbidden}`);
  }
});
