// Slot machine: three reels behind glass, a pull handle and the floor's progressive jackpot.
// The reels spin to the stops the server drew; the VEGAS star is wild and three take the pot.
// A FREE coin in view on all three reels plays 10 free spins at double pay: the server settles
// them in the same round and this plays them back one by one.
import { api } from '../api.js';
import { animate, sound, haptic, formatCH, rollNumber, wait, ms, reducedMotion, el } from '../fx.js';
import { Table } from '../table.js';
import { isBigWin } from '../bigwin.js';
import { gameName } from '../names.js';

const AUTO_COUNTS = [10, 25, 50];
// Spins a set of coins awards, as FREE_SPINS in lib/slots.mjs.
const FREE_SPINS = 10;

// Same weights and strip order as lib/slots.mjs, so a stop index lands on the same symbol.
const WEIGHTS = { STAR: 2, SEVEN: 3, BAR3: 5, BAR2: 7, BAR1: 9, S: 9, H: 8, D: 9, C: 9, FREE: 3 };
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
// Plain and 라이트닝 pays, as in lib/slots.mjs LINE and LIGHTNING_LINE.
const PAYS = {
  normal: [['★ ★ ★', '잭팟 + 500'], ['7 7 7', '100'], ['≡ ≡ ≡', '50'], ['= = =', '25'], ['— — —', '10'], ['같은 무늬 3개', '6'], ['바 아무거나 3개', '4'], ['빨강 또는 검정 3개', '2'], ['★ 와일드', '한 개 ×2 · 두 개 ×3'], ['FREE 코인 3릴 어디든', '프리 스핀 10번 · 당첨 ×2']],
  lightning: [['★ ★ ★', '잭팟 + 500 · 번개 제외'], ['7 7 7', '30'], ['≡ ≡ ≡', '14'], ['= = =', '6'], ['— — —', '3'], ['같은 무늬 3개', '2'], ['바 아무거나 3개', '1'], ['빨강 또는 검정 3개', '1'], ['★ 두 개', '3'], ['★ 한 개', '없음'], ['★ 와일드', '한 개 ×2 · 두 개 ×3'], ['가운데 줄 번개', '배수를 더해서 곱하기'], ['FREE 코인 3릴 어디든', '프리 스핀 10번 · 당첨 ×2']]
};
const PAY_NOTE = {
  normal: '잭팟은 테이블 최대 베팅일 때 전부, 그보다 적으면 베팅 비율만큼 받아요. FREE 코인은 세 릴 모두 창 안 어디에 보이기만 하면 프리 스핀이 터지고, 프리 스핀 중에 또 나오면 10번이 더 붙어요.',
  lightning: '릴이 멈추기 전에 번개가 칸 1~3개에 2~50배를 붙여요. 가운데 줄 번개만 세고, 여러 개면 더해요(5배 + 2배 = 7배). 기본 배당이 낮은 대신 맞으면 그 배수만큼 곱해져요. 잭팟은 번개로 곱하지 않아요. FREE 코인 프리 스핀에서도 매 스핀 번개가 쳐요.'
};
// 일반 or 라이트닝, remembered per device. The server strikes the cells; this only asks for them.
const MODE_KEY = 'vegas:slots:mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'lightning' ? 'lightning' : 'normal'; } catch { return 'normal'; } };
const saveMode = mode => { try { localStorage.setItem(MODE_KEY, mode); } catch {} };
const BOLT = '<svg class="slot-bolt" viewBox="0 0 24 64" aria-hidden="true"><path d="M15 0 4 34h8L7 64 21 24h-8L18 0z"/></svg>';
const payRows = mode => PAYS[mode].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');

function symbol(s) {
  const node = el('span', `slot-sym slot-sym--${s.toLowerCase()}`);
  if (s === 'STAR') node.innerHTML = '<i></i>';
  else if (s === 'SEVEN') node.textContent = '7';
  else if (s === 'FREE') node.innerHTML = '<i>FREE</i>';
  else if (s.startsWith('BAR')) node.innerHTML = Array.from({ length: Number(s.slice(3)) }, () => '<b>BAR</b>').join('');
  else node.textContent = { S: '♠', H: '♥', D: '♦', C: '♣' }[s];
  return node;
}

const randomSymbol = () => STRIP[Math.floor(Math.random() * STRIP.length)];

export async function mountSlots(ctx) {
  const t = new Table({ ...ctx, game: 'slots', title: gameName('slots'), feltClass: 'felt--slots', skin: false });
  t.body.innerHTML = `
    <div class="slot">
      <div class="slot-jackpot"><span>PROGRESSIVE JACKPOT</span><strong data-pool>—</strong></div>
      <div class="slot-cabinet">
        <div class="slot-window" data-window>
          ${[0, 1, 2].map(i => `<div class="slot-reel" data-reel="${i}"><div class="slot-strip"></div></div>`).join('')}
          <i class="slot-payline" aria-hidden="true"></i>
          <div class="slot-strikes" aria-hidden="true">${Array.from({ length: 9 }, (_, c) => `<span data-cell="${c}"></span>`).join('')}</div>
          <b class="slot-boost" data-boost aria-hidden="true"></b>
          <div class="slot-free" data-free aria-live="polite" hidden><span data-free-count></span><strong data-free-win></strong></div>
        </div>
        <button type="button" class="slot-lever" data-lever aria-label="레버 당겨서 돌리기"><span class="slot-lever-arm"><i></i></span></button>
      </div>
      <div class="slot-controls">
        <div class="slot-mode" role="group" aria-label="슬롯 모드"><button type="button" data-mode="normal">일반</button><button type="button" data-mode="lightning">라이트닝</button></div>
        <div class="slot-auto" role="group" aria-label="자동 스핀"><span>자동</span>${AUTO_COUNTS.map(n => `<button type="button" data-auto="${n}" aria-label="자동 ${n}번 스핀">${n}</button>`).join('')}</div>
      </div>
      <div class="slot-result" data-result aria-live="polite"></div>
      <button type="button" class="zone slot-coin" data-zone="LINE"><strong>베팅</strong><small>칩을 놓고 레버를 당기세요</small></button>
      <details class="slot-pays"><summary data-pays-title>배당표</summary><table data-pays></table><p data-pays-note></p></details>
    </div>`;
  t.addZone(t.body.querySelector('[data-zone="LINE"]'));
  const reels = [...t.body.querySelectorAll('[data-reel]')];
  const poolEl = t.body.querySelector('[data-pool]');
  const resultEl = t.body.querySelector('[data-result]');
  const lever = t.body.querySelector('[data-lever]');
  const slot = t.body.querySelector('.slot');
  const windowEl = t.body.querySelector('[data-window]');
  const cells = [...t.body.querySelectorAll('[data-cell]')];
  const boostEl = t.body.querySelector('[data-boost]');
  const modeButtons = [...t.body.querySelectorAll('[data-mode]')];
  const freeEl = t.body.querySelector('[data-free]');
  const freeCount = t.body.querySelector('[data-free-count]');
  const freeWin = t.body.querySelector('[data-free-win]');
  let mode = readMode();
  function showMode() {
    slot.classList.toggle('slot--lightning', mode === 'lightning');
    modeButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    t.body.querySelector('[data-pays]').innerHTML = payRows(mode);
    t.body.querySelector('[data-pays-title]').textContent = mode === 'lightning' ? '배당표 · 라이트닝' : '배당표';
    t.body.querySelector('[data-pays-note]').textContent = PAY_NOTE[mode];
  }
  // The mode cannot change mid-spin, during an auto run, or while a failed spin waits for 다시 시도.
  modeButtons.forEach(b => b.addEventListener('click', () => {
    if (auto || t.locked || t.busy || t.pendingRound || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    saveMode(mode);
    clearStrikes();
    showMode();
    sound.chip(); haptic(8);
    t.toast(mode === 'lightning' ? '라이트닝: 가운데 줄에 번개가 치면 2–50배, 기본 배당은 낮아요' : '일반 슬롯: 기본 배당표로 돌아왔어요');
  }));
  showMode();

  // Lightning: bolts land on the struck cells while the reels are still running; each keeps a
  // white multiplier tag over the window until the next spin. Cells are numbered row × 3 + reel.
  function clearStrikes() {
    cells.forEach(c => { c.replaceChildren(); c.className = ''; });
    boostEl.textContent = '';
    windowEl.classList.remove('is-boosted');
  }
  async function strike(strikes) {
    const calm = reducedMotion();
    if (!calm) await wait(220);
    for (const s of strikes) {
      const cell = cells[s.row * 3 + s.reel];
      if (!calm) {
        cell.insertAdjacentHTML('beforeend', BOLT);
        const bolt = cell.lastElementChild;
        bolt.addEventListener('animationend', () => bolt.remove(), { once: true });
        t.felt.classList.remove('is-flash'); void t.felt.offsetWidth; t.felt.classList.add('is-flash');
        sound.strike(); haptic(12);
        await wait(150);
      }
      cell.classList.add('is-struck');
      if (s.row === 1) cell.classList.add('is-on-line');
      const tag = el('span', 'slot-mult');
      tag.textContent = `${s.multiplier}×`;
      cell.append(tag);
      if (!calm) await wait(230);
    }
    // Under reduced motion there are no bolts: the tags appear at once with a single crack.
    if (calm) { sound.strike(); haptic(12); }
  }
  let pool = ctx.state?.jackpot?.pool ?? 0;
  poolEl.textContent = formatCH(pool);

  // Each reel shows three symbols: above, on and below the payline.
  const shown = reels.map(() => [randomSymbol(), randomSymbol(), randomSymbol()]);
  reels.forEach((r, i) => r.firstElementChild.replaceChildren(...shown[i].map(symbol)));

  function setPool(next) {
    if (next === pool) return;
    rollNumber(poolEl, pool, next, { duration: 900, format: formatCH });
    pool = next;
  }

  // The pot creeps up while you watch: other spins across the floor are feeding it.
  const drift = setInterval(() => {
    if (document.hidden || t.locked) return;
    api.state().then(s => { if (s?.jackpot) setPool(s.jackpot.pool); }).catch(() => {});
  }, 15000);
  const destroy = t.destroy.bind(t);
  t.destroy = () => { stopAuto(); clearInterval(drift); destroy(); };

  async function spinReel(i, stop, { tease = false, fast = false } = {}) {
    const reel = reels[i], strip = reel.firstElementChild;
    const target = [STRIP[(stop + STRIP.length - 1) % STRIP.length], STRIP[stop], STRIP[(stop + 1) % STRIP.length]];
    const filler = Array.from({ length: (fast ? 8 + i * 3 : 18 + i * 6) + (tease ? 10 : 0) }, randomSymbol);
    // Strip runs top to bottom: the new symbols, then what is showing now; it scrolls down.
    strip.replaceChildren(...[...target, ...filler, ...shown[i]].map(symbol));
    const h = reel.getBoundingClientRect().height / 3;
    const travel = (strip.children.length - 3) * h;
    reel.classList.add('is-spinning');
    await animate(strip, [
      { transform: `translateY(${-travel}px)` },
      { transform: `translateY(${h * 0.18}px)`, offset: 0.93 },
      { transform: 'translateY(0)' }
    ], { duration: (reducedMotion() ? 200 : fast ? 620 + i * 200 : 1300 + i * 420 + (tease ? 1200 : 0)), easing: 'cubic-bezier(.25,.1,.25,1)' });
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

  const autoButtons = [...t.body.querySelectorAll('[data-auto]')];
  function refreshActions() {
    if (auto) {
      t.setActions([{ label: `자동 ${auto.done}/${auto.total} · 멈추기`, primary: true, onClick: () => stopAuto('자동 스핀을 멈췄어요') }]);
      // The stop button stays live while a spin runs.
      t.actions.querySelectorAll('button').forEach(b => { b.disabled = false; });
    } else t.setActions(t.idleActions('스핀', go));
    lever.disabled = Boolean(auto) || t.locked || !(t.betReady || (!t.total && t.lastBet));
    modeButtons.forEach(b => { b.disabled = Boolean(auto) || t.locked || t.busy || Boolean(t.pendingRound); });
    const canAuto = !auto && !t.locked && !t.busy && (t.betReady || (!t.total && t.lastBet));
    autoButtons.forEach(b => { b.disabled = !canAuto; b.setAttribute('aria-pressed', String(Boolean(auto && auto.total === Number(b.dataset.auto)))); });
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  // ---------- auto-spin ----------
  // 10, 25 or 50 spins of the same bet, one after another, each its own round through the API
  // with its own idempotency key. It stops on a big win or jackpot, when the chips no longer
  // cover the bet, on any tap, on a lost connection, or when the player leaves or hides the app.
  let auto = null;
  function stopAuto(message = '') {
    if (!auto) return;
    const was = auto;
    auto = null;
    removeEventListener('pointerdown', was.onTap, true);
    document.removeEventListener('visibilitychange', was.onHide);
    if (message && t.root.isConnected) t.toast(message);
    if (t.root.isConnected) refreshActions();
  }
  async function startAuto(total) {
    if (auto || t.locked || t.busy) return;
    if (!t.total && t.lastBet) await t.rebet();
    if (!t.betReady) { t.toast('먼저 칩을 놓아 주세요'); return; }
    const stake = t.total;
    // The run keeps the mode it started with; the switch stays locked until it ends.
    const run = { total, done: 0, onTap: null, onHide: null, mode };
    // Any tap stops it, the stop button included; armed after this tap has finished.
    run.onTap = () => stopAuto('자동 스핀을 멈췄어요');
    run.onHide = () => { if (document.hidden) stopAuto(); };
    auto = run;
    setTimeout(() => { if (auto === run) addEventListener('pointerdown', run.onTap, true); }, 0);
    document.addEventListener('visibilitychange', run.onHide);
    sound.tick();
    while (auto === run && run.done < run.total) {
      if (!t.total) await t.rebet();
      if (auto !== run) break;
      if (t.available < stake || !t.betReady) { stopAuto('칩이 베팅보다 적어서 자동 스핀을 멈췄어요'); break; }
      run.done += 1;
      refreshActions();
      const out = await go(run.mode);
      if (auto !== run) break;
      if (!out) { stopAuto(); break; }
      if (out.big) { stopAuto(out.jackpot ? '잭팟! 자동 스핀을 멈췄어요' : '큰 승리! 자동 스핀을 멈췄어요'); break; }
      await wait(250);
    }
    if (auto === run) stopAuto(`자동 ${run.total}번을 모두 돌렸어요`);
  }
  autoButtons.forEach(b => b.addEventListener('click', () => startAuto(Number(b.dataset.auto))));

  // Runs one spin's reels (and bolts) to a stop and lights its line. Returns the line's label.
  // `fast` is a free spin: shorter reels, and its pay already carries the free-spin multiplier.
  async function play(spin, { fast = false, freeMult = 1 } = {}) {
    const { stops, reels: faces, line, lightning: strikes, boost } = spin;
    const ticker = setInterval(() => sound.tick(), ms(110));
    // Two stars on the first reels: the last one takes its time.
    const tease = !fast && faces[0] === 'STAR' && faces[1] === 'STAR';
    // The bolts land while the reels are still running (the first reel stops after 1.3 s).
    await Promise.all([...stops.map((s, i) => spinReel(i, s, { tease: i === 2 && tease, fast })), strikes ? strike(strikes) : null]);
    clearInterval(ticker);
    const label = line ? `${LINE_LABEL[line] || line}${boost ? ` · ${boost}×` : ''}${freeMult > 1 ? ` · ×${freeMult}` : ''}` : '';
    if (line) {
      resultEl.textContent = label;
      resultEl.classList.add('is-shown');
      reels.forEach(r => r.classList.add('is-hit'));
      setTimeout(() => reels.forEach(r => r.classList.remove('is-hit')), ms(fast ? 900 : 2400));
    } else resultEl.classList.remove('is-shown');
    // A line through struck cells carries its total multiplier on the payline.
    if (boost) {
      boostEl.textContent = `${boost}×`;
      windowEl.classList.add('is-boosted');
      cells.filter(c => c.classList.contains('is-on-line')).forEach(c => c.classList.add('is-lit-hit'));
      sound.strike();
    }
    return label;
  }

  // The coins that set off the free spins: one in each reel's window, any row.
  function markCoins() {
    shown.forEach((faces, reel) => faces.forEach((f, row) => { if (f === 'FREE') cells[row * 3 + reel].classList.add('is-coin'); }));
  }
  // Plays the free spins the server already settled, one after another, with a running total
  // on the badge over the window. A tap on the window or the lever skips to the end.
  async function playFree(free, stake) {
    markCoins();
    slot.classList.add('slot--free');
    freeEl.hidden = false;
    freeCount.textContent = `FREE SPINS ${free.awarded}`;
    freeWin.textContent = '×' + free.multiplier;
    sound.win(); haptic([20, 40, 20]);
    t.toast(`프리 스핀 ${free.awarded}번! 이번 당첨은 전부 ${free.multiplier}배`);
    let skip = false;
    const onSkip = () => { skip = true; };
    windowEl.addEventListener('pointerdown', onSkip);
    lever.addEventListener('pointerdown', onSkip);
    await wait(reducedMotion() ? 300 : 1400);
    let total = 0, awarded = FREE_SPINS;
    try {
      for (let k = 0; k < free.spins.length; k++) {
        if (!t.root.isConnected) return;
        const spin = free.spins[k];
        freeCount.textContent = `FREE SPINS ${k + 1} / ${awarded}`;
        clearStrikes();
        if (skip) {
          // Straight to the stops: no reels, no bolts.
          spin.stops.forEach((stop, i) => { shown[i] = [STRIP[(stop + STRIP.length - 1) % STRIP.length], STRIP[stop], STRIP[(stop + 1) % STRIP.length]]; reels[i].firstElementChild.replaceChildren(...shown[i].map(symbol)); });
        } else {
          await play(spin, { fast: true, freeMult: free.multiplier });
        }
        const win = stake * spin.mult + spin.jackpot;
        if (win > 0) {
          total += win;
          freeWin.textContent = `+${formatCH(total)}`;
          if (!skip) { sound.chips(3); haptic(10); }
        }
        if (spin.retrigger) {
          awarded = Math.min(free.awarded, awarded + FREE_SPINS);
          freeCount.textContent = `FREE SPINS ${k + 1} / ${awarded}`;
          if (!skip) { markCoins(); sound.win(); t.toast(`프리 스핀 ${FREE_SPINS}번 추가!`); await wait(900); }
        }
        if (!skip) await wait(win > 0 ? 650 : 260);
      }
    } finally {
      windowEl.removeEventListener('pointerdown', onSkip);
      lever.removeEventListener('pointerdown', onSkip);
    }
    freeCount.textContent = `FREE SPINS ${free.awarded} · 끝`;
    freeWin.textContent = `+${formatCH(free.win)}`;
    resultEl.textContent = `프리 스핀 +${formatCH(free.win)}`;
    resultEl.classList.add('is-shown');
  }

  // One spin. Resolves to { big, jackpot } once settled, or null if the request failed.
  // `spinMode` pins the mode for an auto run and for 다시 시도, which resends the same key.
  async function go(spinMode = mode) {
    if (!t.betReady) return null;
    const lightning = spinMode === 'lightning';
    const key = t.roundKey(lightning ? 'lightning' : '');
    const stake = t.total;
    t.lock();
    refreshActions();
    resultEl.classList.remove('is-shown');
    clearStrikes();
    freeEl.hidden = true;
    slot.classList.remove('slot--free');
    pull();
    let res;
    try { res = await api.slots(stake, t.tier.floor, lightning, key); }
    catch (e) { t.roundFailed(e, () => go(spinMode)); refreshActions(); return null; }
    t.roundDone();
    t.setServerState(res.state);
    const { line, netPnl: net, jackpot, boost, freeSpins } = res.round;
    const label = await play(res.round);
    setPool(res.state.jackpot.pool);
    await wait(200);
    if (freeSpins) await playFree(freeSpins, stake);
    const big = jackpot > 0 ? { title: 'JACKPOT', subtitle: `잭팟 +${formatCH(jackpot)}` }
      : freeSpins && isBigWin(net, stake) ? { title: 'FREE SPINS', subtitle: `프리 스핀 ${freeSpins.awarded}번 +${formatCH(freeSpins.win)}` }
      : boost && isBigWin(net, stake) ? { title: `${boost}×`, subtitle: `라이트닝 ${LINE_LABEL[line] || line}` } : null;
    const hot = res.round.hotTable;
    await t.settle(net + (hot?.bonus || 0), { label: freeSpins ? `프리 스핀 ${freeSpins.awarded}번` : line ? label : net ? '' : '본전', big, hot });
    await t.syncBalance();
    refreshActions();
    return { big: jackpot > 0 || isBigWin(net, stake), jackpot: jackpot > 0 };
  }

  // Drag the handle down (or tap it) to spin.
  let dragY = null;
  lever.addEventListener('pointerdown', e => { if (!lever.disabled) dragY = e.clientY; });
  lever.addEventListener('pointerup', async e => {
    if (dragY === null) return;
    dragY = null;
    if (auto || t.locked || t.busy) return;
    if (!t.total && t.lastBet) { await t.rebet(); }
    if (t.betReady) t.run(go);
  });
  lever.addEventListener('keydown', e => { if (!auto && (e.key === 'Enter' || e.key === ' ') && t.betReady) { e.preventDefault(); t.run(go); } });

  t.onKey(e => {
    if (auto) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stopAuto('자동 스핀을 멈췄어요'); } return; }
    const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction();
    if (a) { e.preventDefault(); t.run(a.onClick); }
  });
  refreshActions();
  return t;
}
