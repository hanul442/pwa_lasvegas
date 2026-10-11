import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
const html = await read('index.html');
const app = await read('app.js');
const styles = await read('styles.css');
const table = await read('table.css');
const sw = await read('sw.js');
const manifest = JSON.parse(await read('manifest.webmanifest'));
const games = Object.fromEntries(await Promise.all(['blackjack', 'baccarat', 'roulette', 'dice'].map(async g => [g, await read(`js/games/${g}.js`)])));

globalThis.window = { matchMedia: () => ({ matches: false }) };
const { formatCH } = await import('../public/js/fx.js');
const { breakdown, TIERS } = await import('../public/js/chips.js');

test('shell keeps full-screen surfaces, virtual-only copy and no dialog popups', () => {
  for (const surface of ['lobby', 'games', 'ranking', 'profile', 'tiers', 'table']) assert.match(html, new RegExp(`data-surface="${surface}"`));
  assert.doesNotMatch(html, /role="dialog"|<dialog/i);
  assert.match(html, /현실 화폐 가치가 없습니다/);
  assert.match(html, /구매·환전·출금할 수 없으며/);
});

test('navigation is reversible with browser back, Escape and focus restore', () => {
  assert.match(app, /history\.pushState\(\{ vegasSurface: 'tiers' \}/);
  assert.match(app, /history\.pushState\(\{ vegasSurface: 'table' \}/);
  assert.match(app, /history\.back\(\)/);
  assert.match(app, /popstate/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(app, /lastLobbyTrigger\?\.focus/);
});

test('every live table plays through the server-authoritative API', () => {
  assert.match(games.blackjack, /api\.blackjackStart\(/);
  assert.match(games.blackjack, /api\.blackjackAction\(/);
  assert.match(games.blackjack, /api\.blackjackOpen\(\)/, 'unfinished rounds must be resumable');
  assert.match(games.baccarat, /api\.baccarat\(/);
  assert.match(games.roulette, /api\.roulette\(/);
  assert.match(games.dice, /api\.sicbo\(/);
  for (const src of Object.values(games)) assert.doesNotMatch(src, /Math\.random\(\)\s*[*<>]\s*\d+\s*\)\s*;?\s*\/\/\s*outcome/);
});

test('motion honours reduced-motion and never blocks input', () => {
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(table, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(table, /\.dealer-rack\{[^}]*pointer-events:none/);
  assert.match(table, /\.burst\{[^}]*pointer-events:none/);
  assert.match(table, /\.chip-ghost\{[^}]*pointer-events:none/);
});

test('layouts protect safe areas, landscape phones and horizontal overflow', () => {
  assert.match(styles, /overflow-x:hidden/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(table, /safe-area-inset-bottom/);
  assert.match(table, /@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(styles, /@media \(min-width:980px\)/);
  assert.match(table, /touch-action:pan-y/);
});

test('installable PWA never caches game or chip API responses', () => {
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  assert.match(sw, /startsWith\('\/api\/'\)\) return/);
});

test('chip tiers match server floor limits', () => {
  assert.deepEqual([TIERS.low.min, TIERS.mid.min, TIERS.high.min, TIERS.vip.min], [100_000, 1_000_000, 10_000_000, 50_000_000]);
  assert.equal(TIERS.low.floor, 'downtown');
  assert.equal(TIERS.mid.floor, 'strip');
  assert.deepEqual(breakdown(850_000, TIERS.low.chips), [500_000, 250_000, 100_000]);
});

test('chip amounts format compactly without "1000K" style overflow', () => {
  assert.equal(formatCH(999_999), '1M');
  assert.equal(formatCH(2_500_000), '2.5M');
  assert.equal(formatCH(-350_000), '-350K');
  assert.equal(formatCH(100_000_000), '100M');
});
