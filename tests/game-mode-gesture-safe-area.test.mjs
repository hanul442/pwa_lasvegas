import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/usability.css', import.meta.url), 'utf8');

test('game mode protects landscape notch safe areas without horizontal gesture capture', () => {
  assert.match(css, /overscroll-behavior-x:none/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /\.game-mode \.surface-stack\{[^}]*padding-left:max\(18px,env\(safe-area-inset-left\)\)[^}]*padding-right:max\(18px,env\(safe-area-inset-right\)\)/s);
});

test('primary game-mode controls keep touch targets and native vertical pan', () => {
  assert.match(css, /\.game-mode \.back-button\{[^}]*min-height:44px[^}]*touch-action:manipulation/s);
  assert.match(css, /\.game-mode \.tier-card\{[^}]*touch-action:manipulation/s);
  assert.match(css, /\.game-mode \.table-stage\{[^}]*touch-action:pan-y/s);
});

test('decorative casino layers can never obscure pointer input', () => {
  assert.match(css, /\.game-mode \.table-ambience,\s*\.game-mode \.table-motion\{\s*pointer-events:none/s);
});
