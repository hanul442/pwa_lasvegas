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
const games = Object.fromEntries(await Promise.all(['blackjack', 'baccarat', 'roulette', 'dice', 'holdem'].map(async g => [g, await read(`js/games/${g}.js`)])));

globalThis.window = { matchMedia: () => ({ matches: false }) };
const { formatCH } = await import('../public/js/fx.js');
const { breakdown, TIERS } = await import('../public/js/chips.js');
const { FLOORS, stakeTierFor } = await import('../lib/constants.mjs');

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
  assert.match(games.roulette, /api\.rouletteSpin\(/);
  assert.match(games.dice, /api\.sicbo\(/);
  assert.match(games.holdem, /api\.holdemSit\(/);
  assert.match(games.holdem, /api\.holdemAction\(/);
  assert.match(games.holdem, /api\.holdemOpen\(\)/, 'an open seat must be resumable');
  for (const src of Object.values(games)) assert.doesNotMatch(src, /Math\.random\(\)\s*[*<>]\s*\d+\s*\)\s*;?\s*\/\/\s*outcome/);
});

test('motion honours reduced-motion and never blocks input', () => {
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(table, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(table, /\.dealer-rack\{[^}]*pointer-events:none/);
  assert.match(table, /\.felt-print\{[^}]*pointer-events:none/);
  assert.match(table, /\.bet-stack\{[^}]*pointer-events:none/);
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
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.doesNotMatch(html, /(href|src)="\//, "asset paths stay relative so the app also works under /pwa_lasvegas/ on GitHub Pages");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  assert.match(sw, /startsWith\('\/api\/'\)\) return/);
});

test('chip tiers match server floor limits', () => {
  assert.equal(Object.keys(TIERS).length, FLOORS.length, 'one table per floor');
  assert.equal(TIERS['gold-room'].min, 1_000_000, 'the smallest bet is 100만');
  assert.equal(TIERS.vault.max, 1_000_000_000_000, 'The Vault goes up to 1조');
  // Every table's whole range must be accepted by its floor on the server.
  for (const tier of Object.values(TIERS)) {
    const floor = FLOORS.find(f => f.slug === tier.floor);
    assert.ok(floor, tier.slug);
    assert.ok(tier.min >= floor.minBet && tier.max <= floor.maxBet, tier.slug);
    for (const stake of [tier.min, tier.max]) assert.ok(floor.stakeTiers.includes(stakeTierFor(stake)?.slug), `${tier.slug} ${stake}`);
  }
  assert.deepEqual(breakdown(90_000_000, TIERS['high-limit'].chips), [50_000_000, 20_000_000, 20_000_000]);
  // Round chips only: 1, 2, 5 and 10 times the table minimum.
  assert.deepEqual(TIERS['salon-prive'].chips, [100_000_000, 200_000_000, 500_000_000, 1_000_000_000]);
});

test('chip amounts read as Korean money and never overflow a unit', () => {
  assert.equal(formatCH(5_000), '5,000');
  assert.equal(formatCH(25_000), '2.5만');
  assert.equal(formatCH(999_999), '100만');
  assert.equal(formatCH(2_500_000), '250만');
  assert.equal(formatCH(-350_000), '-35만');
  assert.equal(formatCH(50_000_000), '5천만');
  assert.equal(formatCH(99_999_999), '1억');
  assert.equal(formatCH(100_000_000), '1억');
  assert.equal(formatCH(382_000_000), '3억 8200만');
  assert.equal(formatCH(1_240_000_000), '12억 4천만');
  assert.equal(formatCH(25_000_000_000), '250억');
  assert.equal(formatCH(2_500_000_000_000), '2.5조');
});

test('every table offers four round chip denominations that fit under its limit', () => {
  for (const tier of Object.values(TIERS)) {
    assert.deepEqual(tier.chips, [1, 2, 5, 10].map(k => k * tier.min));
    assert.ok(tier.chips.every(c => c <= tier.max));
    assert.ok(tier.chips[0] <= tier.min, `${tier.slug} smallest chip builds bets in steps`);
  }
});

test('맞고 and 섯다 tables are in the lobby and play through the server API', async () => {
  const matgo = await read('js/games/matgo.js');
  const seotda = await read('js/games/seotda.js');
  assert.match(app, /id: 'matgo'/);
  assert.match(app, /id: 'seotda'/);
  assert.match(matgo, /api\.matgoStart\(/);
  assert.match(matgo, /api\.matgoAction\(/);
  assert.match(matgo, /api\.matgoOpen\(\)/, 'unfinished 맞고 games must be resumable');
  assert.match(seotda, /api\.seotdaStart\(/);
  assert.match(seotda, /api\.seotdaAction\(/);
  assert.match(seotda, /api\.seotdaOpen\(\)/);
  assert.match(html, /hwatu\.css/);
  for (const file of ['hwatu.css', 'js/hwatu.js', 'js/guide.js', 'js/guides.js', 'js/games/matgo.js', 'js/games/seotda.js']) assert.match(sw, new RegExp(file.replace('.', '\\.')), file);
});

test('every lobby game has an interactive guide and a rules sheet', async () => {
  const guides = await read('js/guides.js');
  assert.match(app, /attachGuide\(activeTable, selectedGame\.guide \|\| selectedGame\.id\)/);
  for (const id of ['blackjack', 'baccarat', 'roulette', 'dice', 'matgo', 'seotda']) {
    assert.match(guides, new RegExp(`\\n  ${id}: \\{\\n    id: '${id}'`), id);
  }
  const guide = await read('js/guide.js');
  assert.match(guide, /until/, 'hands-on steps wait for the player');
  assert.match(guide, /stopImmediatePropagation/, 'Escape closes the guide before leaving the table');
});
