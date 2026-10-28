import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const read = f => readFile(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('home loads no game code up front; each game is imported when its table opens', async () => {
  const app = await read('app.js');
  const statics = [...app.matchAll(/^import .* from '(.+)';$/gm)].map(m => m[1]);
  for (const f of statics) assert.doesNotMatch(f, /games\/|guide\.js|daily\.js/, `${f} is imported up front`);
  for (const g of ['blackjack', 'baccarat', 'roulette', 'dice', 'matgo', 'gostop', 'seotda', 'holdem', 'sevenpoker', 'slots', 'horses']) {
    assert.match(app, new RegExp(`${g}: \\(\\) => import\\('\\./js/games/${g}\\.js'\\)`), g);
  }
  // A table only mounts if the player is still waiting for it once the code arrives.
  assert.match(app, /if \(seq !== tableSeq \|\| !document\.body\.classList\.contains\('game-mode'\)\) return;/);
});

test('a new build waits for the player and is offered as 새로고침, never mid-hand', async () => {
  const [app, sw] = await Promise.all([read('app.js'), read('sw.js')]);
  assert.match(sw, /if \(!self\.registration\.active\) self\.skipWaiting\(\)/);
  assert.match(sw, /event\.data === 'skip-waiting'/);
  assert.match(app, /postMessage\('skip-waiting'\)/);
  assert.match(app, /if \(!waitingWorker \|\| updating \|\| !inMenus\(\)/);
});

test('the deploy build minifies into dist/, preloads home modules and versions the offline cache', { timeout: 60_000 }, async () => {
  await promisify(execFile)(process.execPath, ['scripts/build.mjs'], { cwd: new URL('..', import.meta.url) });
  const dist = f => readFile(new URL(`../dist/${f}`, import.meta.url), 'utf8');
  const [html, sw, app, src] = await Promise.all([dist('index.html'), dist('sw.js'), dist('app.js'), read('app.js')]);
  assert.match(html, /<link rel="modulepreload" href="js\/api\.js">/);
  assert.doesNotMatch(html, /modulepreload" href="js\/games\//);
  assert.match(sw, /vegas-shell-v\d+-[0-9a-f]{10}/);
  // CI runs without `npm ci`, so esbuild may be missing there; then the build copies files as they are.
  const esbuild = await import('esbuild').then(() => true, () => false);
  if (esbuild) assert.ok(app.length < src.length * 0.8, 'app.js is minified');
  else assert.equal(app, src);
  await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
});
