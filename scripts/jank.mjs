// How smooth the app feels while playing, on a Galaxy Z Fold-sized phone with the CPU slowed 4×.
//
//   node scripts/jank.mjs                          all games, cover + inner
//   node scripts/jank.mjs --games=blackjack,seotda --sizes=cover --json=out.json
//
// Per screen it records, from the page itself:
//   frames    frames drawn, and how many took over 50ms (a stutter you can see)
//   worst     the slowest frame
//   busy      main-thread time spent in tasks over 50ms (what blocks taps)
//   tap       the slowest tap: from the finger to the next frame on screen (Chrome's INP)
//   ⚠         an endless animation of something other than transform/opacity (repaints every frame);
//             any of these makes the exit code 1
// Lobby: idle for 3s, then a scroll down and up. Tables: open, buy in, play one round.
import fs from 'node:fs/promises';
import { GAMES, SIZES, context, startServer, signInGuest, closeOverlays, loadPlaywright } from './fold-check.mjs';

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const games = arg('games', GAMES.join(',')).split(',').filter(Boolean);
const sizes = arg('sizes', 'cover,inner').split(',').filter(s => SIZES[s]);
const cpu = Number(arg('cpu', 4));
const wait = ms => new Promise(r => setTimeout(r, ms));

// Installed before the app runs: a frame clock, long tasks and tap timings, reset per screen.
function probe() {
  const m = window.__jank = { frames: [], long: [], taps: [], reset() { this.frames = []; this.long = []; this.taps = []; this.last = 0; } };
  m.reset();
  const tick = t => { if (m.last) m.frames.push(t - m.last); m.last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver(l => l.getEntries().forEach(e => m.long.push(e.duration))).observe({ type: 'longtask', buffered: false }); } catch {}
  try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (/pointer|click|key|touch/.test(e.name)) m.taps.push({ name: e.name, d: e.duration, wait: e.processingStart - e.startTime, run: e.processingEnd - e.processingStart, target: e.target?.className?.toString().slice(0, 40) || e.target?.tagName }); })).observe({ type: 'event', durationThreshold: 16 }); } catch {}
}
const summary = () => {
  // Endless animations of anything but transform/opacity repaint the screen every frame (PR #139):
  // listed by the element they run on.
  const loops = document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity && a.playState === 'running' && a.effect.target?.checkVisibility?.()).flatMap(a => {
    const props = new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(p => !['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity', 'translate', 'scale', 'rotate'].includes(p)));
    const t = a.effect.target, cls = (t.className?.baseVal ?? t.className ?? '').toString().split(' ')[0];
    return props.size ? [`${a.animationName || 'animate'} on .${cls}${a.effect.pseudoElement || ''} (${[...props]})`] : [];
  });
  const m = window.__jank, f = m.frames.filter(d => d < 1000); // a hidden-tab pause is not a frame
  const taps = m.taps.slice().sort((a, b) => b.d - a.d);
  return { frames: f.length, slow: f.filter(d => d > 50).length, worst: Math.round(Math.max(0, ...f)), busy: Math.round(m.long.reduce((s, d) => s + d, 0)), longest: Math.round(Math.max(0, ...m.long)), tap: Math.round(taps[0]?.d || 0), tapAt: taps[0] ? `${taps[0].name} ${taps[0].target} wait${Math.round(taps[0].wait)} run${Math.round(taps[0].run)}` : '', loops };
};

async function tapMain(page) {
  // a real touch on the biggest bet spot, then on the main button
  const box = await page.evaluate(() => {
    const zones = [...document.querySelectorAll('.table-screen [data-zone]')].filter(z => z.offsetParent && z.getAttribute('aria-hidden') !== 'true' && !z.disabled);
    const area = z => { const r = z.getBoundingClientRect(); return r.width * r.height; };
    const r = zones.sort((a, b) => area(b) - area(a))[0]?.getBoundingClientRect();
    return r && [r.left + r.width / 2, r.top + r.height / 2];
  });
  if (box) { await page.touchscreen.tap(...box); await wait(700); }
  const btn = await page.evaluate(() => {
    const bs = [...(document.querySelector('.table-screen [data-actions]')?.querySelectorAll('button') || [])].filter(b => !b.disabled && b.offsetParent);
    const b = bs.find(b => /solid|primary/.test(b.className)) || bs.at(-1);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { at: [r.left + r.width / 2, r.top + r.height / 2], label: b.textContent.trim() };
  });
  if (btn) await page.touchscreen.tap(...btn.at);
  return btn?.label || '';
}

async function playRound(page, first) {
  for (let i = 0; i < 14; i++) {
    const over = await page.waitForSelector('.table-screen .banner.is-shown:is(.banner--win,.banner--lose,.banner--push,.banner--big)', { timeout: 1800 }).then(() => true, () => false);
    if (over) { await wait(1500); return; }
    const peek = await page.evaluate(() => { const r = document.querySelector('.table-screen .is-peekable')?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2]; });
    if (peek) { await page.touchscreen.tap(...peek); await wait(900); }
    const next = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('.table-screen [data-actions] button')].filter(b => !b.disabled && b.offsetParent);
      const b = bs.find(b => /스탠드|콜|체크|stand|call/i.test(b.textContent)) || bs.find(b => b.classList.contains('action--primary')) || bs.at(-1);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { at: [r.left + r.width / 2, r.top + r.height / 2], label: b.textContent.trim() };
    });
    if (next && first && next.label.includes(first.split('↵')[0]) && i > 0) return;
    if (next) await page.touchscreen.tap(...next.at);
    await closeOverlays(page);
  }
}

const fmt = (name, s) => `${name.padEnd(22)} 프레임 ${String(s.frames).padStart(4)} · 끊김 ${String(s.slow).padStart(3)} · 최악 ${String(s.worst).padStart(4)}ms · 막힘 ${String(s.busy).padStart(5)}ms (최장 ${s.longest}) · 탭 ${String(s.tap).padStart(4)}ms ${s.tapAt}${s.loops.length ? `\n  ⚠ 쉬지 않고 다시 그리는 애니메이션: ${s.loops.join(', ')}` : ''}`;

async function main() {
  const { chromium } = await loadPlaywright();
  const server = arg('base') ? { base: arg('base'), stop() {} } : await startServer();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const size of sizes) {
      const ctx = await browser.newContext(context(size));
      await ctx.addInitScript(probe);
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await signInGuest(page, server.base);
      await closeOverlays(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      console.log(`\n${size} (CPU ${cpu}×)`);
      // lobby
      await wait(1000);
      await page.evaluate(() => window.__jank.reset());
      await wait(3000);
      let s = await page.evaluate(summary); results.push({ size, what: 'lobby-idle', ...s }); console.log(fmt('홈 가만히 3초', s));
      await page.evaluate(() => window.__jank.reset());
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 400); await wait(250); }
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -400); await wait(250); }
      await wait(500);
      s = await page.evaluate(summary); results.push({ size, what: 'lobby-scroll', ...s }); console.log(fmt('홈 스크롤', s));
      for (const game of games) {
        await closeOverlays(page);
        await page.evaluate(() => window.__jank.reset());
        await page.evaluate(g => dispatchEvent(new CustomEvent('vegas:open-table', { detail: { game: g, tier: 'gold-room' } })), game);
        await page.waitForSelector('.table-screen', { timeout: 15000 }).catch(() => {});
        await wait(2500);
        s = await page.evaluate(summary); results.push({ size, game, what: 'open', ...s }); console.log(fmt(`${game} 입장`, s));
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('vegas:buyin')));
        await wait(900);
        await page.evaluate(() => document.querySelector('.buyin-sheet .pill-button--solid')?.click());
        await wait(1500);
        await closeOverlays(page);
        await page.evaluate(() => window.__jank.reset());
        const first = await tapMain(page);
        await playRound(page, first);
        s = await page.evaluate(summary); results.push({ size, game, what: 'round', ...s }); console.log(fmt(`${game} 한 판`, s));
        await page.evaluate(() => document.querySelector('.table-back')?.click());
        await wait(800);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
  const out = arg('json');
  if (out) await fs.writeFile(out, JSON.stringify(results, null, 2));
  const loops = results.filter(r => r.loops.length);
  if (loops.length) { console.log(`\n${loops.length} screens repaint every frame`); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exit(2); });
