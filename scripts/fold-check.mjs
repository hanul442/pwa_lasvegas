// Galaxy Fold screen check: opens every table on the folded cover screen and the unfolded inner
// screen, saves a screenshot of each, and lists what is clipped or covered.
//
//   node scripts/fold-check.mjs                    all games, all sizes, own local server
//   node scripts/fold-check.mjs --games=blackjack,seotda --sizes=inner
//   node scripts/fold-check.mjs --base=http://localhost:3000 --out=shots/fold
//
// It starts `server.mjs` in a temporary folder (fresh data/state.json), plays as a guest and
// takes two shots per table: the empty table, and a few seconds after the main button.
// Problems it reports, per shot:
//   clipped  a card, chip or label that sticks out of the felt or the screen
//   covered  a button whose middle is under something else, so a tap would miss
//   cut      text cut off with "…" or hidden overflow
//   scroll   the page or the felt scrolls sideways
// Exit code 1 when anything is found, so it can run before a merge.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

export const SIZES = {
  cover: { width: 412, height: 860 },   // folded, outer screen
  narrow: { width: 360, height: 780 },  // folded, larger font / display zoom
  inner: { width: 760, height: 840 },   // unfolded, upright
  innerL: { width: 840, height: 760 },  // unfolded, on its side
};
export const GAMES = ['blackjack', 'baccarat', 'roulette', 'dice', 'slots', 'poker', 'sevenpoker', 'seotda', 'matgo', 'gostop', 'horses'];

const games = arg('games', GAMES.join(',')).split(',').filter(Boolean);
const sizes = arg('sizes', Object.keys(SIZES).join(',')).split(',').filter(s => SIZES[s]);
const out = path.resolve(arg('out', path.join(os.tmpdir(), 'vegas-fold-check')));
const tier = arg('tier', 'gold-room');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vegas-fold-'));
  const port = 3400 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return { base, stop: () => child.kill() }; } catch {}
    await wait(100);
  }
  child.kill();
  throw new Error('server did not start');
}

// Runs in the page: what is clipped, covered or cut on the table right now.
function inspect() {
  const found = [];
  const vis = n => { const s = getComputedStyle(n); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05; };
  const shown = n => { for (let p = n; p && p !== document.body; p = p.parentElement) if (!vis(p)) return false; return true; };
  const name = n => {
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (n.getAttribute('aria-label') || n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const W = innerWidth, H = innerHeight;
  if (document.documentElement.scrollWidth > W + 1) found.push({ kind: 'scroll', what: 'page', by: document.documentElement.scrollWidth - W });
  const screen = document.querySelector('.table-screen');
  if (!screen) return [{ kind: 'missing', what: 'table-screen' }];
  const felt = screen.querySelector('[data-felt]');
  const fr = felt.getBoundingClientRect();
  if (/auto|scroll/.test(getComputedStyle(felt).overflowX) && felt.scrollWidth > felt.clientWidth + 2) found.push({ kind: 'scroll', what: 'felt', by: felt.scrollWidth - felt.clientWidth });
  // Things that should sit fully on the felt: cards, chips, name plates, readouts.
  const parts = felt.querySelectorAll('.card, .hw, .chip, [class*="seat"] > strong, [class*="plate"], [class*="badge"], [class*="label"], [class*="total"], [class*="score"], [class*="amount"], [class*="hand-name"]');
  for (const n of parts) {
    if (!shown(n) || n.closest('[aria-hidden="true"], .dealer-rack, .toast, .banner, .mg-pile')) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const over = Math.max(fr.left - r.left, r.right - fr.right, fr.top - r.top, r.bottom - fr.bottom);
    if (over > 3) found.push({ kind: 'clipped', what: name(n), by: Math.round(over) });
  }
  // Every button: on screen, and its middle answers a tap.
  for (const b of screen.querySelectorAll('button, [role="button"]')) {
    if (!shown(b) || b.disabled && b.closest('[hidden]')) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1) { found.push({ kind: 'clipped', what: name(b), by: 'off screen' }); continue; }
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (hit && !b.contains(hit) && !hit.contains(b) && !hit.closest('.toast, .app-toast, .banner, .news-banner, .tip-line, .jk-moment, .bigwin, .wheel, [role="dialog"], [aria-modal="true"]')) found.push({ kind: 'covered', what: name(b), by: name(hit) });
  }
  // Text cut short.
  for (const n of screen.querySelectorAll('small, span, strong, p, b, button, [data-hint]')) {
    if (!shown(n) || !n.textContent.trim() || n.children.length > 2 || n.closest('.hr-tag')) continue; // horse blurbs are cut on purpose
    const s = getComputedStyle(n);
    if (s.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) found.push({ kind: 'cut', what: name(n) });
  }
  return found;
}

async function closeOverlays(page) {
  // News, first-time tips, sheets: anything with a close button over the table.
  for (let i = 0; i < 4; i++) {
    const closed = await page.evaluate(() => {
      document.querySelectorAll('.news-banner, .lounge-scrim').forEach(n => n.remove());
      const btn = [...document.querySelectorAll('[data-close], .sheet-close, .tip-close, [data-tip-ok], [data-dismiss]')].find(b => b.offsetParent);
      btn?.click();
      return Boolean(btn);
    });
    if (!closed) break;
    await wait(250);
  }
}

// Puts a bet on the biggest spot (if the table has spots), then presses the main button.
async function primary(page) {
  return page.evaluate(async () => {
    const zones = [...document.querySelectorAll('.table-screen [data-zone]')].filter(z => z.offsetParent && z.getAttribute('aria-hidden') !== 'true' && !z.disabled);
    const area = z => { const r = z.getBoundingClientRect(); return r.width * r.height; };
    zones.sort((a, b) => area(b) - area(a))[0]?.click();
    await new Promise(r => setTimeout(r, 700));
    const buttons = [...(document.querySelector('.table-screen [data-actions]')?.querySelectorAll('button') || [])].filter(b => !b.disabled && b.offsetParent);
    const b = buttons.find(b => /solid|primary/.test(b.className)) || buttons.at(-1);
    b?.click();
    return b?.textContent.trim() || '';
  });
}

// Playwright is not a dependency of the app: use a local install, else the global one.
async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const { execSync } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const globalRoot = execSync('npm root -g').toString().trim();
  return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
}

async function main() {
  const { chromium } = await loadPlaywright();
  const server = arg('base') ? { base: arg('base'), stop() {} } : await startServer();
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const size of sizes) {
      const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.goto(server.base);
      const terms = page.locator('[data-terms-check]');
      if (await terms.isVisible().catch(() => false)) { await terms.check(); await page.click('[data-terms-agree]'); }
      await page.locator('[data-guest]').first().click();
      await page.waitForFunction(() => document.body.classList.contains('signed-in') || localStorage.getItem('vegas:session'), null, { timeout: 15000 });
      await wait(800);
      for (const game of games) {
        await closeOverlays(page);
        await page.evaluate(([g, t]) => dispatchEvent(new CustomEvent('vegas:open-table', { detail: { game: g, tier: t } })), [game, tier]);
        await page.waitForSelector(`.table-screen--${game}, .table-screen`, { timeout: 15000 }).catch(() => {});
        await wait(1800);
        // The cashier (js/cashier.js): leaving the last table cashed the chips in, so buy a stack
        // here from the seat, as a player would with the table's +.
        if (await page.evaluate(() => document.querySelector('.table-screen [data-balance]')?.textContent.trim() === '0')) {
          await page.evaluate(() => document.dispatchEvent(new CustomEvent('vegas:buyin')));
          await wait(700);
          await page.evaluate(() => document.querySelector('.buyin-sheet .pill-button--solid')?.click());
          await wait(1200);
        }
        await closeOverlays(page);
        let first = '';
        for (const step of ['idle', 'play', 'end']) {
          if (step === 'play') { first = await primary(page); await wait(3200); await closeOverlays(page); if (!first) continue; }
          // keep pressing the main button (stand, call…) until the round is over: the showdown shot
          if (step === 'end') {
            if (!first) continue;
            for (let i = 0; i < 14; i++) {
              // a card waiting to be peeked (섯다): tap it open
              const peek = await page.evaluate(() => { const r = document.querySelector('.table-screen .is-peekable')?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2]; });
              if (peek) { await page.touchscreen.tap(...peek); await wait(1200); }
              const label = await page.evaluate(() => [...document.querySelectorAll('.table-screen [data-actions] button')].filter(b => !b.disabled && b.offsetParent).map(b => b.textContent.trim()).join('|'));
              if (label.includes(first.split('↵')[0])) break;
              if (label) await page.evaluate(() => { const bs = [...document.querySelectorAll('.table-screen [data-actions] button')].filter(b => !b.disabled && b.offsetParent); (bs.find(b => /스탠드|콜|체크|stand|call/i.test(b.textContent)) || bs.find(b => b.classList.contains('action--primary')) || bs.at(-1))?.click(); });
              // the win/lose banner means the cards are all open: that is the shot
              const over = await page.waitForSelector('.table-screen .banner.is-shown:is(.banner--win,.banner--lose,.banner--push,.banner--big)', { timeout: 1800 }).then(() => true, () => false);
              if (over) { await wait(400); break; }
              await closeOverlays(page);
            }
          }
          const file = path.join(out, `${size}-${game}-${step}.png`);
          await page.screenshot({ path: file });
          const found = await page.evaluate(inspect);
          report.push({ size, game, step, file, found });
          const line = found.length ? found.map(f => `  ${f.kind.padEnd(7)} ${f.what}${f.by !== undefined ? `  (${f.by})` : ''}`).join('\n') : '  ok';
          console.log(`${size} ${game} ${step}\n${line}`);
        }
        await page.evaluate(() => document.querySelector('.table-back')?.click());
        await wait(600);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const bad = report.filter(r => r.found.length).length;
  console.log(`\n${report.length} shots, ${bad} with problems → ${out}`);
  process.exitCode = bad ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(2); });
