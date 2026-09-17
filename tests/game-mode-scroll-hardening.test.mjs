import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/usability.css', import.meta.url), 'utf8');

test('game-mode hardening stylesheet is loaded after base styles', () => {
  const base = html.indexOf('href="/styles.css"');
  const hardening = html.indexOf('href="/usability.css"');
  assert.ok(base >= 0 && hardening > base);
});

test('game mode preserves vertical scrolling and safe bottom reachability', () => {
  assert.match(css, /\.game-mode\{[^}]*overflow-y:auto/s);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.game-mode \.table-stage\{[^}]*touch-action:pan-y/s);
});

test('short landscape reduces table floor instead of forcing a 220px trap', () => {
  assert.match(css, /orientation:landscape/);
  assert.match(css, /max-height:520px/);
  assert.match(css, /min-height:clamp\(180px,54dvh,220px\)/);
});
