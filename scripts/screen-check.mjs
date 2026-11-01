// Screen check for everything that is not a table: home, game list, events, ranking (all four
// views), wallet, shop, profile, settings, the table list of one game, and the sheets that open
// over them (buy-in, shop item, table switcher). Phones and PC.
//
//   node scripts/screen-check.mjs                       all pages, phone + PC sizes
//   node scripts/screen-check.mjs --sizes=pc1280,cover --pages=lobby,ranking-tier
//
// Shots are full-page. Problems it reports, per shot:
//   scroll   the page scrolls sideways
//   off      something sticks out past the right/left edge of the screen
//   cut      text cut off with "…"
//   covered  a button whose middle is under something else
//   narrow   (PC) the content uses less than half of the screen width
// Exit code 1 when anything is found.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZES, context, startServer, loadPlaywright, closeOverlays, signInGuest } from './fold-check.mjs';

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const wait = ms => new Promise(r => setTimeout(r, ms));

const nav = name => async page => page.evaluate(n => document.querySelector(`.bottom-nav [data-nav="${n}"], [data-nav="${n}"]`)?.click(), name);
const rankView = label => async page => {
  await nav('ranking')(page);
  await wait(400);
  await page.evaluate(l => [...document.querySelectorAll('[data-rank-view] button')].find(b => b.textContent.trim() === l)?.click(), label);
};
const shopTab = label => async page => {
  await nav('shop')(page);
  await wait(400);
  await page.evaluate(l => [...document.querySelectorAll('[data-shop] .shop-tab')].find(b => b.textContent.trim() === l)?.click(), label);
};
export const PAGES = {
  lobby: nav('lobby'),
  games: nav('games'),
  events: nav('events'),
  'ranking-tier': rankView('티어'),
  'ranking-board': rankView('순위'),
  'ranking-league': rankView('리그'),
  'ranking-friends': rankView('친구'),
  bank: nav('bank'),
  shop: nav('shop'),
  'shop-slots': shopTab('종류별'),
  'shop-season': shopTab('시즌 한정'),
  'shop-free': shopTab('무료·업적'),
  'shop-sheet': async page => { await shopTab('층별')(page); await wait(400); await page.evaluate(() => document.querySelector('[data-shop] .skin-price:not([disabled])')?.click()); },
  profile: nav('profile'),
  settings: nav('settings'),
  tiers: async page => page.evaluate(() => dispatchEvent(new CustomEvent('vegas:choose-game', { detail: { game: 'blackjack' } }))),
  'buyin-sheet': async page => {
    await page.evaluate(() => dispatchEvent(new CustomEvent('vegas:open-table', { detail: { game: 'blackjack', tier: 'gold-room' } })));
    await page.waitForSelector('.table-screen', { timeout: 15000 }).catch(() => {});
    await wait(1500);
    if (!await page.evaluate(() => Boolean(document.querySelector('.buyin-sheet')))) {
      await closeOverlays(page);
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('vegas:buyin')));
    }
  },
  'table-switcher': async page => {
    await page.evaluate(() => document.querySelector('.buyin-sheet .pill-button--solid')?.click());
    await wait(1000);
    await closeOverlays(page);
    await page.evaluate(() => document.querySelector('.table-screen [data-switch], .table-screen .table-title, .table-screen [data-table-nav]')?.click());
  },
};
const SHEET_PAGES = new Set(['shop-sheet', 'buyin-sheet', 'table-switcher']);

// Runs in the page.
function inspect(pc) {
  const found = [];
  const vis = n => { const s = getComputedStyle(n); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05; };
  const shown = n => { for (let p = n; p && p !== document.body; p = p.parentElement) if (!vis(p)) return false; return true; };
  const name = n => {
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (n.getAttribute('aria-label') || n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const W = innerWidth;
  if (document.documentElement.scrollWidth > W + 1) found.push({ kind: 'scroll', what: 'page', by: document.documentElement.scrollWidth - W });
  const root = document.querySelector('.lounge-sheet') || document.querySelector('.surface.is-active') || document.body;
  // inside a sideways scroller (a row you swipe) is fine
  const inScroller = n => { for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (/auto|scroll|hidden|clip/.test(o)) return true; } return false; };
  const offs = [];
  for (const n of root.querySelectorAll('*')) {
    if (!shown(n) || n.closest('[aria-hidden="true"]')) continue;
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const over = Math.max(r.right - W, -r.left);
    if (over > 2 && !inScroller(n)) offs.push({ kind: 'off', what: name(n), by: Math.round(over) });
  }
  // keep only the outermost offenders
  found.push(...offs.slice(0, 6));
  for (const n of root.querySelectorAll('small, span, strong, p, b, button, a, h1, h2, h3, em')) {
    if (!shown(n) || !n.textContent.trim() || n.children.length > 2) continue;
    const s = getComputedStyle(n);
    if (s.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) found.push({ kind: 'cut', what: name(n) });
  }
  for (const b of root.querySelectorAll('button, a[href], [role="button"]')) {
    if (!shown(b) || b.closest('[aria-hidden="true"]')) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || x > W) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && !b.contains(hit) && !hit.contains(b) && !hit.closest('.bottom-nav, .topbar, .app-toast, .news-banner, [role="dialog"]') && !b.closest('.bottom-nav, .topbar')) found.push({ kind: 'covered', what: name(b), by: name(hit) });
  }
  if (pc && root.classList.contains('surface')) {
    const kids = [...root.children].filter(shown).map(n => n.getBoundingClientRect()).filter(r => r.height > 20);
    const width = kids.length ? Math.max(...kids.map(r => r.right)) - Math.min(...kids.map(r => r.left)) : 0;
    if (width < W * 0.5) found.push({ kind: 'narrow', what: 'content', by: `${Math.round(width)}/${W}` });
  }
  return found;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const sizeArg = arg('sizes', 'cover,narrow,inner,innerL,phone,land,pc1280,pc1440,pc1920');
  const sizes = (sizeArg === 'all' ? Object.keys(SIZES).join(',') : sizeArg).split(',').filter(s => SIZES[s]);
  const pages = arg('pages', Object.keys(PAGES).join(',')).split(',').filter(p => PAGES[p]);
  const out = path.resolve(arg('out', path.join(os.tmpdir(), 'vegas-screen-check')));
  const server = arg('base') ? { base: arg('base'), stop() {} } : await startServer();
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const size of sizes) {
      const ctx = await browser.newContext(context(size));
      const page = await ctx.newPage();
      await signInGuest(page, server.base);
      for (const name of pages) {
        if (!SHEET_PAGES.has(name)) {
          await page.evaluate(() => { document.querySelectorAll('.lounge-sheet [data-close], .lounge-sheet .sheet-close').forEach(b => b.click()); document.querySelector('.table-back')?.click(); });
          await wait(300);
        }
        await closeOverlays(page);
        await PAGES[name](page);
        await wait(1200);
        if (!SHEET_PAGES.has(name)) await closeOverlays(page);
        // walk down once so lazy pictures load, then back to the top for the full-page shot
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); });
        await wait(300);
        const file = path.join(out, `${size}-${name}.png`);
        await page.screenshot({ path: file, fullPage: !SHEET_PAGES.has(name) });
        const found = await page.evaluate(inspect, Boolean(SIZES[size].pc));
        report.push({ size, page: name, file, found });
        const line = found.length ? found.map(f => `  ${f.kind.padEnd(7)} ${f.what}${f.by !== undefined ? `  (${f.by})` : ''}`).join('\n') : '  ok';
        console.log(`${size} ${name}\n${line}`);
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
