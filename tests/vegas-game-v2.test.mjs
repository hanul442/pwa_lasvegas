import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('VEGAS game V2 layer loads after shell asset bindings', () => {
  const index = read('public/index.html');
  const shell = index.indexOf('/vegas-ui-v2.css');
  const assets = index.indexOf('/vegas-ui-v2-assets.css');
  const games = index.indexOf('/vegas-game-v2.css');
  assert.ok(shell >= 0 && assets > shell && games > assets);
});

test('VEGAS game V2 covers all live game room identities and landscape controls', () => {
  const css = read('public/vegas-game-v2.css');
  for (const game of ['baccarat','roulette','sicbo']) assert.ok(css.includes(`data-v2-game="${game}"`), game);
  assert.match(css, /orientation:landscape/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('future Korean rooms remain presentation-only coming-soon surfaces', () => {
  const css = read('public/vegas-game-v2.css');
  for (const game of ['matgo','seotda','holdem']) assert.ok(css.includes(`data-v2-game="${game}"`), game);
  const lower = css.toLowerCase();
  for (const forbidden of ['fetch(', '/api/', 'settlement', 'ledger write', 'cash-out', 'real-money']) {
    assert.equal(lower.includes(forbidden), false, `game presentation CSS must not introduce ${forbidden}`);
  }
});

test('service worker precaches the game V2 layer', () => {
  assert.ok(read('public/sw.js').includes("'/vegas-game-v2.css'"));
});
