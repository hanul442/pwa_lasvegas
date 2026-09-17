import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/poker-motion.css', import.meta.url), 'utf8');

test('poker table owns a five-card decorative spread', () => {
  assert.match(html, /poker-motion\.css/);
  assert.match(html, /class="motion-poker"/);
  assert.equal((html.match(/<div class="motion-poker">([\s\S]*?)<\/div>/)?.[1].match(/<i>/g) || []).length, 5);
  assert.match(css, /\.table-stage\[data-game=poker\] \.motion-poker\{display:flex\}/);
  assert.match(css, /pointer-events:none/);
});

test('poker spread animates only on entry and respects reduced motion', () => {
  assert.match(css, /\.is-entering\[data-game=poker\] \.motion-poker i\{animation:poker-spread/);
  assert.match(css, /@keyframes poker-spread/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /\.is-entering\[data-game=poker\] \.motion-poker i\{animation:none\}/);
});

test('short landscape has compact poker geometry', () => {
  assert.match(css, /@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(css, /\.motion-poker i\{width:50px;height:70px/);
});
