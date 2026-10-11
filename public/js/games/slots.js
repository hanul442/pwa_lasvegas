// Slot machine: three reels behind glass, a pull handle and the floor's progressive jackpot.
// The reels spin to the stops the server drew; the VEGAS star is wild and three take the pot.
import { api, errorMessage } from '../api.js';
import { animate, sound, haptic, formatCH, formatFull, rollNumber, wait, ms, reducedMotion, el } from '../fx.js';
import { Table } from '../table.js';

// Same weights and strip order as lib/slots.mjs, so a stop index lands on the same symbol.
const WEIGHTS = { STAR: 2, SEVEN: 3, BAR3: 5, BAR2: 7, BAR1: 9, S: 9, H: 9, D: 10, C: 10 };
// Symbols spread along the reel (smooth weighted round-robin) so neighbours rarely repeat.
function reelStrip(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const current = Object.fromEntries(Object.keys(weights).map(k => [k, 0]));
  const out = [];
  for (let i = 0; i < total; i++) {
    for (const k in weights) current[k] += weights[k];
    const pick = Object.keys(weights).reduce((a, b) => (current[b] > current[a] ? b : a));
    current[pick] -= total;
    out.push(pick);
  }
  return out;
}
const STRIP = reelStrip(WEIGHTS);
const LINE_LABEL = { JACKPOT: 'JACKPOT', SEVEN: '777', BAR3: 'Triple Bar', BAR2: 'Double Bar', BAR1: 'Bar', S: '♠ ♠ ♠', H: '♥ ♥ ♥', D: '♦ ♦ ♦', C: '♣ ♣ ♣', ANY_BAR: 'Any Bar', ALL_RED: 'All Red', ALL_BLACK: 'All Black', TWO_STARS: 'Two Stars', ONE_STAR: 'Star' };
const PAYS = [['★ ★ ★', '잭팟 + 500'], ['7 7 7', '80'], ['≡ ≡ ≡', '40'], ['= = =', '20'], ['— — —', '10'], ['같은 무늬 3개', '6'], ['바 아무거나 3개', '4'], ['빨강 또는 검정 3개', '2'], ['★ 와일드', '한 개 ×2 · 두 개 ×3']];

function symbol(s) {
  const node = el('span', `slot-sym slot-sym--${s.toLowerCase()}`);
  if (s === 'STAR') node.innerHTML = '<i></i>';
  else if (s === 'SEVEN') node.textContent = '7';
  else if (s.startsWith('BAR')) node.innerHTML = Array.from({ length: Number(s.slice(3)) }, () => '<b>BAR</b>').join('');
  else node.textContent = { S: '♠', H: '♥', D: '♦', C: '♣' }[s];
  return node;
}

const randomSymbol = () => STRIP[Math.floor(Math.random() * STRIP.length)];

export async function mountSlots(ctx) {
  const t = new Table({ ...ctx, game: 'slots', title: 'Slots', feltClass: 'felt--slots' });
  t.body.innerHTML = `
    <div class="slot">
      <div class="slot-jackpot"><span>PROGRESSIVE JACKPOT</span><strong data-pool>—</strong></div>
      <div class="slot-cabinet">
        <div class="slot-window" data-window>
          ${[0, 1, 2].map(i => `<div class="slot-reel" data-reel="${i}"><div class="slot-strip"></div></div>`).join('')}
          <i class="slot-payline" aria-hidden="true"></i>
        </div>
        <button type="button" class="slot-lever" data-lever aria-label="레버 당겨서 돌리기"><span class="slot-lever-arm"><i></i></span></button>
      </div>
      <div class="slot-result" data-result aria-live="polite"></div>
      <button type="button" class="zone slot-coin" data-zone="LINE"><strong>베팅</strong><small>칩을 놓고 레버를 당기세요</small></button>
      <details class="slot-pays"><summary>배당표</summary><table>${PAYS.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table><p>잭팟은 테이블 최대 베팅일 때 전부, 그보다 적으면 베팅 비율만큼 받아요.</p></details>
    </div>`;
  t.addZone(t.body.querySelector('[data-zone="LINE"]'));
  const reels = [...t.body.querySelectorAll('[data-reel]')];
  const poolEl = t.body.querySelector('[data-pool]');
  const resultEl = t.body.querySelector('[data-result]');
  const lever = t.body.querySelector('[data-lever]');
  let pool = ctx.state?.jackpot?.pool ?? 0;
  poolEl.textContent = formatFull(pool);

  // Each reel shows three symbols: above, on and below the payline.
  const shown = reels.map(() => [randomSymbol(), randomSymbol(), randomSymbol()]);
  reels.forEach((r, i) => r.firstElementChild.replaceChildren(...shown[i].map(symbol)));

  function setPool(next) {
    if (next === pool) return;
    rollNumber(poolEl, pool, next, { duration: 900 });
    pool = next;
  }

  // The pot creeps up while you watch: other spins across the floor are feeding it.
  const drift = setInterval(() => {
    if (document.hidden || t.locked) return;
    api.state().then(s => { if (s?.jackpot) setPool(s.jackpot.pool); }).catch(() => {});
  }, 15000);
  const destroy = t.destroy.bind(t);
  t.destroy = () => { clearInterval(drift); destroy(); };

  async function spinReel(i, stop, { tease = false } = {}) {
    const reel = reels[i], strip = reel.firstElementChild;
    const target = [STRIP[(stop + STRIP.length - 1) % STRIP.length], STRIP[stop], STRIP[(stop + 1) % STRIP.length]];
    const filler = Array.from({ length: 18 + i * 6 + (tease ? 10 : 0) }, randomSymbol);
    // Strip runs top to bottom: the new symbols, then what is showing now; it scrolls down.
    strip.replaceChildren(...[...target, ...filler, ...shown[i]].map(symbol));
    const h = reel.getBoundingClientRect().height / 3;
    const travel = (strip.children.length - 3) * h;
    reel.classList.add('is-spinning');
    await animate(strip, [
      { transform: `translateY(${-travel}px)` },
      { transform: `translateY(${h * 0.18}px)`, offset: 0.93 },
      { transform: 'translateY(0)' }
    ], { duration: (reducedMotion() ? 200 : 1300 + i * 420 + (tease ? 1200 : 0)), easing: 'cubic-bezier(.25,.1,.25,1)' });
    reel.classList.remove('is-spinning');
    strip.replaceChildren(...target.map(symbol));
    strip.getAnimations().forEach(a => a.cancel());
    shown[i] = target;
    sound.chip(); haptic(12);
  }

  async function pull() {
    animate(lever.firstElementChild, [{ transform: 'rotate(0)' }, { transform: 'rotateX(160deg)' }, { transform: 'rotate(0)' }], { duration: 520, easing: 'cubic-bezier(.3,.7,.3,1)' });
    sound.tick();
  }

  function refreshActions() {
    t.setActions(t.idleActions('스핀', go));
    lever.disabled = t.locked || !(t.betReady || (!t.total && t.lastBet));
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function go() {
    if (!t.betReady) return;
    t.lock();
    refreshActions();
    resultEl.classList.remove('is-shown');
    pull();
    let res;
    try { res = await api.slots(t.total, t.tier.floor); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); refreshActions(); return; }
    t.setServerState(res.state);
    const { stops, reels: faces, line, netPnl: net, jackpot } = res.round;
    const ticker = setInterval(() => sound.tick(), ms(110));
    // Two stars on the first reels: the last one takes its time.
    const tease = faces[0] === 'STAR' && faces[1] === 'STAR';
    await Promise.all(stops.map((s, i) => spinReel(i, s, { tease: i === 2 && tease })));
    clearInterval(ticker);
    setPool(res.state.jackpot.pool);
    if (line) {
      resultEl.textContent = LINE_LABEL[line] || line;
      resultEl.classList.add('is-shown');
      reels.forEach(r => r.classList.add('is-hit'));
      setTimeout(() => reels.forEach(r => r.classList.remove('is-hit')), ms(2400));
    }
    await wait(200);
    const big = jackpot > 0 ? { title: 'JACKPOT', subtitle: `잭팟 +${formatCH(jackpot)}` } : null;
    await t.settle(net, { label: line ? LINE_LABEL[line] : net ? '' : '본전', big });
    await t.syncBalance();
    refreshActions();
  }

  // Drag the handle down (or tap it) to spin.
  let dragY = null;
  lever.addEventListener('pointerdown', e => { if (!lever.disabled) dragY = e.clientY; });
  lever.addEventListener('pointerup', async e => {
    if (dragY === null) return;
    dragY = null;
    if (t.locked || t.busy) return;
    if (!t.total && t.lastBet) { await t.rebet(); }
    if (t.betReady) t.run(go);
  });
  lever.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && t.betReady) { e.preventDefault(); t.run(go); } });

  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  refreshActions();
  return t;
}
