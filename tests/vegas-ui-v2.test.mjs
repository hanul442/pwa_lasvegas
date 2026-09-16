import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('VEGAS V2 visual layer loads after legacy luxury layers', () => {
  const index = read('public/index.html');
  const legacy = index.indexOf('/aaac-blackjack-cinematic.css');
  const v2 = index.indexOf('/vegas-ui-v2.css');
  const assets = index.indexOf('/vegas-ui-v2-assets.css');
  const games = index.indexOf('/vegas-game-v2.css');
  const motion = index.indexOf('/vegas-motion-v2.css');
  assert.ok(legacy >= 0 && v2 > legacy && assets > v2 && games > assets && motion > games);
  assert.ok(index.indexOf('/vegas-ui-v2.js') > index.indexOf('/blackjack-v2.js'));
});

test('VEGAS V2 binds the canonical approved wordmark', () => {
  const adapter = read('public/vegas-ui-v2.js');
  assert.match(adapter, /const V2_LOGO='\/assets\/vegas-logo\.svg'/);
  assert.ok(existsSync(resolve(root, 'public/assets/vegas-logo.svg')));
});

test('VEGAS V2 ships mobile-landscape first-class layout rules', () => {
  const css = `${read('public/vegas-ui-v2.css')}\n${read('public/vegas-motion-v2.css')}`;
  assert.match(css, /orientation:landscape/);
  assert.match(css, /max-height:620px/);
  assert.match(css, /scroll-snap-type:x proximity/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /position:sticky/);
});

test('VEGAS V2 motion layer has accessibility fallback and game-result states', () => {
  const css = read('public/vegas-motion-v2.css');
  const adapter = read('public/vegas-ui-v2.js');
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /v2RouletteSpin/);
  assert.match(css, /v2DiceThrow/);
  assert.match(css, /v2CardDeal/);
  assert.match(css, /\.v2-win/);
  assert.match(css, /\.v2-loss/);
  assert.match(adapter, /classList\.toggle\('v2-win'/);
  assert.match(adapter, /classList\.toggle\('v2-loss'/);
});

test('VEGAS V2 ships vector artwork for current and expansion game families', () => {
  for (const game of ['blackjack','roulette','baccarat','sicbo','holdem','matgo','seotda']) {
    assert.ok(existsSync(resolve(root, `public/assets/ui-v2/game-${game}.svg`)), game);
  }
  const bindings = read('public/vegas-ui-v2-assets.css');
  for (const game of ['blackjack','roulette','baccarat','sicbo','holdem','matgo','seotda']) {
    assert.match(bindings, new RegExp(`game-${game}\\.svg`));
  }
});

test('service worker precaches VEGAS V2 shell and motion assets', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /social-vegas-shell-v21/);
  for (const asset of ['/game-navigation.js','/vegas-ui-v2.css','/vegas-ui-v2-assets.css','/vegas-game-v2.css','/vegas-motion-v2.css','/vegas-ui-v2.js','/assets/vegas-logo.svg']) {
    assert.ok(sw.includes(asset), asset);
  }
});