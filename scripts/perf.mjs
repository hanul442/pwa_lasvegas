// How fast the app opens and how fast a table is ready, on a Galaxy Z Fold-sized phone over a slow mobile network.
//
//   npm run build && node scripts/perf.mjs            # dist/, 3 cold runs per screen
//   node scripts/perf.mjs --dir public --runs 5       # the raw files instead
//   node scripts/perf.mjs --json out.json             # also save the numbers
//
// Needs Playwright (preinstalled in the cloud sandbox; locally `npx playwright install chromium`).
// The page is served the way Cloudflare serves it (brotli for text) with the real API in memory, so nothing
// on disk changes. Each run is a fresh browser profile: no cache, no service worker, a new guest.
// Two networks: Korean LTE as a phone usually sees it (40 ms, 20 Mbit/s) and a bad spot (Lighthouse's "slow 4G":
// 150 ms, 1.6 Mbit/s). CPU slowed 4× either way. The guest waits a second on the sign-in screen, as a person would.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const dir = resolve(root, arg('dir', 'dist'));
const runs = Number(arg('runs', 3));
if (!existsSync(dir)) { console.error(`${dir} is missing: run npm run build first`); process.exit(1); }

let playwright;
try { playwright = createRequire(import.meta.url)('playwright'); } catch { console.error('Playwright is not installed'); process.exit(1); }

// ---------- the site, served like production ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2' };
const TEXT = /\.(html|js|css|svg|json|webmanifest)$/;
const packed = new Map();
function memoryStore() {
  let state = defaultState(), queue = Promise.resolve();
  return {
    load: async () => structuredClone(state),
    mutate(fn) { const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; }); queue = task.catch(() => {}); return task; }
  };
}
const store = memoryStore();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    const { status, data } = await handleApi({ method: req.method, header: n => req.headers[n], body: async () => (raw ? JSON.parse(raw) : {}) }, url, store, { AUTH_REQUIRED: true });
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(data));
  }
  const rel = normalize(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)).replace(/^(\.\.[/\\])+/, '');
  try {
    let body = packed.get(rel);
    if (!body) {
      body = await readFile(join(dir, rel));
      if (TEXT.test(rel)) body = brotliCompressSync(body);
      packed.set(rel, body);
    }
    res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream', ...(TEXT.test(rel) ? { 'content-encoding': 'br' } : {}) });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- one cold visit ----------
const SCREENS = [
  { name: '폴드 커버 (접힘)', viewport: { width: 412, height: 915 }, scale: 2.6 },
  { name: '폴드 안쪽 (펼침)', viewport: { width: 760, height: 840 }, scale: 2.4 }
];
const NETWORKS = [
  { name: 'LTE', latency: 40, down: 20, up: 5 },
  { name: '느린 4G', latency: 150, down: 1.6, up: 0.75 }
];
async function visit(browser, screen, net) {
  const context = await browser.newContext({ viewport: screen.viewport, deviceScaleFactor: screen.scale, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'ko-KR' });
  const page = await context.newPage();
  // The moment the app's own Korean font first replaces the phone's font.
  await page.addInitScript(() => document.fonts.addEventListener('loadingdone', e => {
    if (!window.__fontsAt && e.fontfaces.some(f => f.family.replace(/"/g, '') === 'Noto Sans KR')) window.__fontsAt = performance.now();
  }));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down * 1024 * 1024 / 8, uploadThroughput: net.up * 1024 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0, requests = 0;
  cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; requests++; });
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'commit' });
  await page.locator('[data-guest]').first().waitFor({ state: 'visible', timeout: 60_000 });
  const firstScreen = Date.now() - t0;
  const paint = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0);
  const bytesFirst = bytes, requestsFirst = requests;
  await page.waitForTimeout(1000);
  const t1 = Date.now();
  await page.locator('[data-guest]').first().click();
  // Home is ready when the sign-in screen is gone and the wallet shows the guest's chips.
  await page.waitForFunction(() => !document.querySelector('.auth-gate') && /\d/.test(document.querySelector('[data-wallet]')?.textContent || ''), null, { timeout: 60_000 });
  const home = Date.now() - t1;
  const t2 = Date.now();
  await page.evaluate(() => dispatchEvent(new CustomEvent('vegas:open-table', { detail: { game: 'blackjack' } })));
  await page.locator('button', { hasText: /^딜/ }).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(async e => { await page.screenshot({ path: process.env.PERF_SHOT || 'perf-fail.png' }); throw e; });
  const table = Date.now() - t2;
  const fonts = Math.round(await page.waitForFunction(() => window.__fontsAt, null, { timeout: 60_000 }).then(h => h.jsonValue()));
  await context.close();
  return { paint: Math.round(paint), firstScreen, fonts, home, table, kb: Math.round(bytesFirst / 1024), requests: requestsFirst, totalKb: Math.round(bytes / 1024) };
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const browser = await playwright.chromium.launch();
const report = {};
try {
  for (const net of NETWORKS) for (const screen of SCREENS) {
    const all = [];
    for (let i = 0; i < runs; i++) all.push(await visit(browser, screen, net));
    const row = Object.fromEntries(Object.keys(all[0]).map(k => [k, median(all.map(r => r[k]))]));
    report[`${net.name} · ${screen.name}`] = row;
    console.log(`${net.name} · ${screen.name}: 첫 글자 ${row.paint}ms · 첫 화면 ${row.firstScreen}ms (${row.requests}개 ${row.kb}KB) · 홈 ${row.home}ms · 블랙잭 입장 ${row.table}ms · 폰트 적용 ${row.fonts}ms · 총 ${row.totalKb}KB`);
  }
} finally {
  await browser.close();
  server.close();
}
const out = arg('json');
if (out) await writeFile(out, JSON.stringify(report, null, 2));
