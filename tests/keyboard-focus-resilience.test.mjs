import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/usability.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('primary navigation and game controls expose a strong focus-visible contract', () => {
  assert.match(css, /:where\(\.brand,\.nav-item,\.game-card,\.floor-game,\.tier-card,\.back-button\):focus-visible\{[^}]*outline:3px solid var\(--gold\)[^}]*outline-offset:3px[^}]*box-shadow:/s);
  assert.match(css, /\.game-mode :where\(\.tier-card,\.back-button\):focus-visible\{[^}]*z-index:6/s);
});

test('programmatic surface-heading focus stays semantic rather than decorative', () => {
  assert.match(css, /\.surface>h1\[tabindex="-1"\]:focus\{\s*outline:none/s);
  assert.match(app, /heading\?\.setAttribute\('tabindex','-1'\);heading\?\.focus\(\{preventScroll:true\}\)/);
});

test('escape and browser back retain the existing trigger-restoration path', () => {
  assert.match(app, /function restoreTrigger\(\)\{lastLobbyTrigger\?\.focus\(\{preventScroll:true\}\);\}/);
  assert.match(app, /window\.addEventListener\('popstate'/);
  assert.match(app, /event\.key==='Escape'\)leaveTable\(\)/);
});
