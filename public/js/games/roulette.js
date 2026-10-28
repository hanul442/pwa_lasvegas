// European roulette: the rotor and ball are animated to land on the server's number.
import { api } from '../api.js';
import { gameName } from '../names.js';
import { sound, haptic, reducedMotion, wait, el, animate } from '../fx.js';
import { buzz } from '../haptics.js';
import { Table } from '../table.js';
import { seatCrowd } from '../npc.js';
import { voice, rouletteLine } from '../voice.js';
import { eventInfo, createStreakMeter } from '../event-table.js';

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = n => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const STEP = 360 / 37;

// 일반 or 라이트닝, remembered per device. The server strikes the numbers; this only asks for them.
const MODE_KEY = 'vegas:roulette:mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'lightning' ? 'lightning' : 'normal'; } catch { return 'normal'; } };
const saveMode = mode => { try { localStorage.setItem(MODE_KEY, mode); } catch {} };
const PAYOUTS = {
  normal: '여러 곳에 함께 · 숫자 35:1 · 12개/열 2:1 · 나머지 1:1',
  lightning: '번개 맞은 숫자 50–500배 · 다른 숫자 29:1 · 나머지 그대로'
};
const BOLT = '<svg class="rl-bolt" viewBox="0 0 24 64" aria-hidden="true"><path d="M15 0 4 34h8L7 64 21 24h-8L18 0z"/></svg>';

function wheelSvg() {
  const pockets = ORDER.map((n, i) => {
    const a0 = ((i - 0.5) * STEP - 90) * Math.PI / 180, a1 = ((i + 0.5) * STEP - 90) * Math.PI / 180;
    const R = 86, r = 60;
    const p = (rad, ang) => `${(rad * Math.cos(ang)).toFixed(2)},${(rad * Math.sin(ang)).toFixed(2)}`;
    const fill = { green: '#2e5e45', red: '#8a2626', black: '#1a1714' }[colorOf(n)];
    const label = `<text transform="rotate(${i * STEP}) translate(0,-76)" text-anchor="middle" dominant-baseline="middle">${n}</text>`;
    return `<path data-n="${n}" d="M${p(R, a0)} A${R},${R} 0 0 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 0 0 ${p(r, a0)} Z" fill="${fill}"/>${label}`;
  }).join('');
  const frets = ORDER.map((_, i) => `<line x1="0" y1="-60" x2="0" y2="-86" transform="rotate(${(i + 0.5) * STEP})"/>`).join('');
  // The turning is done on a plain box around the drawing: a box's rotation runs on the GPU,
  // while rotating the <svg> itself makes the browser lay out and repaint every number each frame.
  return `<div class="wheel-rotor" aria-hidden="true"><svg viewBox="-100 -100 200 200">
    <defs>
      <radialGradient id="cone" cx="40%" cy="35%"><stop offset="0" stop-color="#6b5038"/><stop offset=".55" stop-color="#3a2a1e"/><stop offset="1" stop-color="#1a120c"/></radialGradient>
      <radialGradient id="hub" cx="40%" cy="35%"><stop offset="0" stop-color="#efe2c4"/><stop offset="1" stop-color="#8c7448"/></radialGradient>
    </defs>
    <circle r="88" fill="#120c08"/>
    <g class="pockets">${pockets}</g>
    <g class="frets">${frets}</g>
    <circle r="60" fill="url(#cone)"/>
    <circle r="56" fill="none" stroke="#bfa476" stroke-opacity=".4" stroke-width=".8"/>
    <g class="turret">${[0, 90, 180, 270].map(a => `<rect x="-2.5" y="-40" width="5" height="34" rx="2.5" transform="rotate(${a})" fill="url(#hub)"/>`).join('')}<circle r="10" fill="url(#hub)"/></g>
  </svg></div>`;
}

function boardMarkup() {
  const cells = [];
  for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
    const n = col * 3 + (3 - row);
    cells.push(`<button type="button" class="num num--${colorOf(n)}" data-zone="N${n}" style="grid-column:${col + 2};grid-row:${row + 1}" aria-label="${n}번">${n}</button>`);
  }
  // "2 to 1" at the end of each row covers that column: top row is column 3.
  for (let row = 0; row < 3; row++) cells.push(`<button type="button" class="num num--col" data-zone="C${3 - row}" style="grid-column:14;grid-row:${row + 1}" aria-label="${3 - row}열, 2배">2:1</button>`);
  return `<div class="rl-board">
    <button type="button" class="num num--green num--zero" data-zone="N0" aria-label="0번">0</button>
    ${cells.join('')}
  </div>
  <div class="rl-dozens">
    <button type="button" class="zone" data-zone="D1"><strong>1st 12</strong></button>
    <button type="button" class="zone" data-zone="D2"><strong>2nd 12</strong></button>
    <button type="button" class="zone" data-zone="D3"><strong>3rd 12</strong></button>
  </div>
  <div class="rl-outside">
    <button type="button" class="zone" data-zone="LOW"><strong>1–18</strong></button>
    <button type="button" class="zone" data-zone="EVEN"><strong>Even</strong></button>
    <button type="button" class="zone zone--red" data-zone="RED"><strong>Red</strong></button>
    <button type="button" class="zone zone--black" data-zone="BLACK"><strong>Black</strong></button>
    <button type="button" class="zone" data-zone="ODD"><strong>Odd</strong></button>
    <button type="button" class="zone" data-zone="HIGH"><strong>19–36</strong></button>
  </div>`;
}

function zoneBet(zone) {
  if (zone.startsWith('N')) return { betType: 'NUMBER', target: Number(zone.slice(1)) };
  if (/^D\d$/.test(zone)) return { betType: 'DOZEN', target: Number(zone.slice(1)) };
  if (/^C\d$/.test(zone)) return { betType: 'COLUMN', target: Number(zone.slice(1)) };
  return { betType: zone };
}

// A spot's net for `number`, by the same payouts as the server: straight 35, dozen/column 2, even
// chances 1. On a 라이트닝 spin a straight pays its multiplier in total if struck, 29:1 if not.
function spotNet(zone, stake, number, strikes = null) {
  const { betType, target } = zoneBet(zone);
  const color = colorOf(number).toUpperCase();
  let won = false, mult = 1;
  if (betType === 'NUMBER') { won = number === target; const hit = strikes?.find(s => s.number === target); mult = !strikes ? 35 : hit ? hit.multiplier - 1 : 29; }
  else if (number === 0) won = false;
  else if (betType === 'DOZEN') { won = Math.ceil(number / 12) === target; mult = 2; }
  else if (betType === 'COLUMN') { won = ((number - 1) % 3) + 1 === target; mult = 2; }
  else if (betType === 'RED' || betType === 'BLACK') won = color === betType;
  else if (betType === 'ODD') won = number % 2 === 1;
  else if (betType === 'EVEN') won = number % 2 === 0;
  else if (betType === 'LOW') won = number <= 18;
  else if (betType === 'HIGH') won = number >= 19;
  return won ? stake * mult : -stake;
}

// The AI regulars spread a few chips: a lucky number or two, a colour, sometimes a dozen.
function crowdPlan(npc, t) {
  const unit = t.tier.chips[0];
  const chip = () => unit * (1 + Math.floor(Math.random() * (npc.bold > 0.5 ? 4 : 2)));
  npc.lucky ??= 1 + Math.floor(Math.random() * 36);
  const bets = [];
  const add = (zone, amount, line) => { if (!bets.some(b => b.zone === zone)) bets.push({ zone, amount, line }); };
  const n = Math.random() < 0.6 ? npc.lucky : Math.floor(Math.random() * 37);
  if (Math.random() < 0.75) add(`N${n}`, chip(), Math.random() < 0.45 ? `이번엔 ${n}!` : null);
  if (npc.bold > 0.5 && Math.random() < 0.5) add(`N${Math.floor(Math.random() * 37)}`, chip());
  const outside = ['RED', 'BLACK', 'ODD', 'EVEN', 'LOW', 'HIGH', 'D1', 'D2', 'D3', 'C1', 'C2', 'C3'];
  const o = outside[Math.floor(Math.random() * outside.length)];
  const lines = { RED: '레드 갑니다', BLACK: '블랙이 올 차례', D2: '가운데 12개', LOW: '낮은 쪽으로' };
  add(o, Math.max(t.tier.min, chip() * 2), Math.random() < 0.4 ? lines[o] : null);
  if (Math.random() < 0.3) add(outside[Math.floor(Math.random() * outside.length)], chip());
  return bets;
}

// `event: 'casablanca'` seats Casablanca (lib/events.mjs): Rick's bonus after three winning spins.
export async function mountRoulette(ctx, { event = null } = {}) {
  const ev = event ? eventInfo(ctx.state, event) : null;
  // Chips go on as many spots as you like before the spin, like a real layout.
  const t = new Table({ ...ctx, game: 'roulette', title: ev ? ev.title : gameName('roulette'), feltClass: 'felt--roulette', multi: true, zoneMin: false, zoneWord: '한 곳당', hot: !ev });
  const meter = ev?.streak ? createStreakMeter(t, ev, ctx.state?.eventStreaks?.[ev.id] || 0) : null;
  if (ev) t.root.classList.add('is-event', `is-event--${ev.id}`);
  t.body.innerHTML = `
    <div class="rl">
      <div class="rl-top">
        <div class="wheel" data-wheel>
          <div class="wheel-bowl" aria-hidden="true"></div>
          ${wheelSvg()}
          <div class="ball-orbit" data-orbit aria-hidden="true"><i class="ball" data-ball></i></div>
          <div class="wheel-result" data-result aria-live="polite"></div>
        </div>
        <div class="rl-strip">
          <div class="rl-mode" role="group" aria-label="테이블 모드">
            <button type="button" data-mode="normal">일반</button>
            <button type="button" data-mode="lightning">라이트닝</button>
          </div>
          <ol class="rl-history" data-history aria-label="최근 번호"></ol>
        </div>
      </div>
      <div class="rl-layout">${boardMarkup()}</div>
      <p class="rl-payouts" data-payouts aria-hidden="true"></p>
    </div>`;
  t.body.querySelectorAll('[data-zone]').forEach(z => t.addZone(z));
  const crowd = seatCrowd(t, { plan: crowdPlan });
  const rotor = t.body.querySelector('.wheel-rotor');
  const wheel = t.body.querySelector('[data-wheel]');
  const orbit = t.body.querySelector('[data-orbit]');
  const ball = t.body.querySelector('[data-ball]');
  const resultEl = t.body.querySelector('[data-result]');
  const history = t.body.querySelector('[data-history]');
  const rl = t.body.querySelector('.rl');
  const modeButtons = [...t.body.querySelectorAll('[data-mode]')];
  const payouts = t.body.querySelector('[data-payouts]');
  let rotorAngle = 0, ballAngle = 0;
  let mode = readMode();

  function showMode() {
    rl.classList.toggle('rl--lightning', mode === 'lightning');
    modeButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    payouts.textContent = PAYOUTS[mode];
  }
  function lockMode(locked) { modeButtons.forEach(b => { b.disabled = locked; }); }
  modeButtons.forEach(b => b.addEventListener('click', () => {
    if (t.locked || t.busy || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    saveMode(mode);
    clearStrikes();
    showMode();
    sound.chip(); haptic(8);
    t.toast(mode === 'lightning' ? '라이트닝: 번개 맞은 숫자는 50–500배, 그 외 숫자는 29:1' : '일반 룰렛: 숫자 35:1');
  }));
  showMode();

  // Lightning: before the ball drops, each struck number takes a bolt and keeps its multiplier
  // on the layout (and its pocket lit on the wheel) until the next spin.
  function clearStrikes() {
    t.body.querySelectorAll('.is-struck').forEach(n => n.classList.remove('is-struck', 'is-lit-hit'));
    t.body.querySelectorAll('.rl-mult,.rl-bolt').forEach(n => n.remove());
    t.body.querySelectorAll('.num[data-zone^="N"]').forEach(n => n.setAttribute('aria-label', `${n.dataset.zone.slice(1)}번`));
  }
  async function strike(strikes) {
    const calm = reducedMotion();
    for (const s of strikes) {
      const cell = t.body.querySelector(`[data-zone="N${s.number}"]`);
      rotor.querySelector(`[data-n="${s.number}"]`)?.classList.add('is-struck');
      if (!cell) continue;
      if (!calm) {
        cell.insertAdjacentHTML('beforeend', BOLT);
        const bolt = cell.lastElementChild;
        bolt.addEventListener('animationend', () => bolt.remove(), { once: true });
        t.felt.classList.remove('is-flash'); void t.felt.offsetWidth; t.felt.classList.add('is-flash');
      }
      sound.strike(); haptic(12);
      if (!calm) await wait(170);
      cell.classList.add('is-struck');
      const tag = document.createElement('span');
      tag.className = 'rl-mult';
      tag.setAttribute('aria-hidden', 'true');
      tag.textContent = `${s.multiplier}×`;
      cell.append(tag);
      cell.setAttribute('aria-label', `${s.number}번, 번개 ${s.multiplier}배`);
      if (!calm) await wait(360);
    }
    await wait(calm ? 300 : 500);
  }

  // Idle drift so the wheel never looks frozen.
  let idle = rotor.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 60000, iterations: Infinity });
  if (reducedMotion()) idle.pause();

  async function spinTo(number) {
    const now = idle.currentTime ? (idle.currentTime / 60000) * 360 : 0;
    idle.cancel();
    rotorAngle = (rotorAngle + now) % 360;
    const idx = ORDER.indexOf(number);
    // In ball heights (the ball is 5.5% of the wheel), so the drop holds at any wheel size.
    const track = 0.455 / 0.055 * 100, pocket = 0.36 / 0.055 * 100;
    const landAt = Math.random() * 360;
    let target = landAt - idx * STEP;
    while (target < rotorAngle + 1080) target += 360;
    let ballTarget = landAt;
    while (ballTarget > ballAngle - 1800) ballTarget -= 360;
    const duration = reducedMotion() ? 400 : 5200;
    resultEl.classList.remove('is-shown');
    ball.style.opacity = '1';
    const ticker = setInterval(() => sound.tick(), 140);
    setTimeout(() => clearInterval(ticker), duration * 0.82);
    await Promise.all([
      rotor.animate([{ transform: `rotate(${rotorAngle}deg)` }, { transform: `rotate(${target}deg)` }], { duration, easing: 'cubic-bezier(.12,.62,.18,1)', fill: 'forwards' }).finished,
      orbit.animate([{ transform: `rotate(${ballAngle}deg)` }, { transform: `rotate(${ballTarget}deg)` }], { duration, easing: 'cubic-bezier(.08,.7,.2,1)', fill: 'forwards' }).finished,
      ball.animate([
        { transform: `translateY(${-track}%)` },
        { transform: `translateY(${-track}%)`, offset: 0.6 },
        { transform: `translateY(${-pocket * 1.08}%)`, offset: 0.74 },
        { transform: `translateY(${-pocket * 1.16}%)`, offset: 0.8 },
        { transform: `translateY(${-pocket * 0.98}%)`, offset: 0.87 },
        { transform: `translateY(${-pocket * 1.04}%)`, offset: 0.93 },
        { transform: `translateY(${-pocket}%)` }
      ], { duration, easing: 'linear', fill: 'forwards' }).finished
    ]);
    clearInterval(ticker);
    sound.chip(); haptic(15);
    rotorAngle = target % 360; ballAngle = ballTarget % 360;
    // Keep ball and rotor turning together after the drop, like a real wheel coasting.
    rotor.getAnimations().forEach(a => a.cancel());
    orbit.getAnimations().forEach(a => a.cancel());
    rotor.style.transform = `rotate(${rotorAngle}deg)`;
    orbit.style.transform = `rotate(${ballAngle}deg)`;
    ball.getAnimations().forEach(a => a.cancel());
    ball.style.transform = `translateY(${-pocket}%)`;
    resultEl.textContent = number;
    resultEl.className = `wheel-result wheel-result--${colorOf(number)} is-shown`;
    const li = document.createElement('li');
    li.className = `hist hist--${colorOf(number)}`;
    li.textContent = number;
    history.prepend(li);
    while (history.children.length > 12) history.lastElementChild.remove();
    const cell = t.body.querySelector(`[data-zone="N${number}"]`);
    cell?.classList.add('is-hit');
    setTimeout(() => cell?.classList.remove('is-hit'), 2600);
  }

  // 크게 보기: while the ball runs, the wheel lifts off the table into the middle of the screen
  // over a dimmed felt, then settles back into its place once the number is called. A spot
  // holds its place in the layout. Skipped when the wheel is already big (tablets, landscape)
  // or motion is reduced.
  async function lift() {
    if (reducedMotion() || !t.root.isConnected) return null;
    const from = wheel.getBoundingClientRect();
    const size = Math.min(innerWidth * 0.9, innerHeight * 0.6, 520);
    if (!from.width || size < from.width * 1.2) return null;
    const hold = document.createElement('div');
    hold.className = 'wheel-hold';
    hold.style.width = `${from.width}px`;
    hold.style.height = `${from.height}px`;
    wheel.before(hold);
    const shade = document.createElement('div');
    shade.className = 'wheel-shade';
    // The wheel leaves the felt for the lift: the felt is its own layer (isolation), so a wheel
    // left inside it would sit under the shade and spin dimmed, as if behind dark glass.
    t.root.append(shade, wheel);
    wheel.classList.add('is-lifted');
    Object.assign(wheel.style, { left: `${(innerWidth - size) / 2}px`, top: `${(innerHeight - size) / 2 - innerHeight * 0.04}px`, width: `${size}px` });
    const to = wheel.getBoundingClientRect();
    const back = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`;
    shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, fill: 'both' });
    await wheel.animate([{ transform: back }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.catch(() => {});
    return { hold, shade };
  }
  async function land(lifted) {
    if (!lifted) return;
    const { hold, shade } = lifted;
    const from = wheel.getBoundingClientRect(), to = hold.getBoundingClientRect();
    const there = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})`;
    shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'both' });
    await wheel.animate([{ transform: 'none' }, { transform: there }], { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.catch(() => {});
    wheel.getAnimations().forEach(a => a.cancel());
    wheel.classList.remove('is-lifted');
    wheel.style.left = wheel.style.top = wheel.style.width = '';
    hold.replaceWith(wheel); shade.remove();
  }

  function refreshActions() {
    t.setActions(t.idleActions('스핀', spin));
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  // ---------- the dolly: the acrylic marker the croupier puts on the winning number ----------
  let dolly = null;
  async function placeDolly(n) {
    liftDolly();
    const cell = t.body.querySelector(`[data-zone="N${n}"]`);
    if (!cell) return;
    dolly = el('i', 'rl-dolly');
    dolly.setAttribute('aria-hidden', 'true');
    cell.append(dolly);
    await animate(dolly, [
      { transform: 'translate(-50%,-50%) translateY(-34px) scale(1.5)', opacity: 0 },
      { transform: 'translate(-50%,-50%) translateY(-6px) scale(1.08)', opacity: 1, offset: 0.62 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }
    ], { duration: 380, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'backwards' });
    sound.chip(); buzz('chip');
    await wait(180);
  }
  function liftDolly() {
    const d = dolly; dolly = null;
    if (!d) return;
    animate(d, [{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: 'translate(-50%,-50%) translateY(-24px) scale(1.3)', opacity: 0 }], { duration: 240, fill: 'forwards' }).then(() => d.remove());
  }

  async function spin() {
    if (!t.betReady) return;
    const bets = t.betZones.map(zone => ({ zone, ...zoneBet(zone), stake: t.zoneTotal(zone) }));
    const key = t.roundKey(mode);
    t.lock();
    lockMode(true);
    clearStrikes();
    liftDolly();
    // The spin goes to the server while the AI players drop their last chips, not after.
    const request = api.rouletteSpin(bets.map(({ zone, ...b }) => b), t.tier.floor, mode === 'lightning', ev?.id, key);
    request.catch(() => {});
    await crowd.close();
    let res;
    try { res = await request; }
    catch (e) { lockMode(false); t.roundFailed(e, spin); return; }
    t.roundDone();
    t.setServerState(res.state);
    voice.say('no-more-bets', { cut: true });
    const strikes = res.round.lightning || null;
    if (strikes) await strike(strikes);
    const lifted = await lift();
    await spinTo(res.round.number);
    voice.say(rouletteLine(res.round.number));
    await wait(lifted ? 1300 : 250);
    await land(lifted);
    const hot = res.round.hotTable;
    const net = res.round.netPnl + (hot?.bonus || 0);
    // Each spot is paid or raked on its own.
    const zones = new Map(res.round.bets.map((b, i) => [bets[i].zone, b.netPnl]));
    const n = res.round.number;
    const straight = res.round.bets.find(b => b.won && b.betType === 'NUMBER');
    // A straight-up win on a struck number always stops the table: that is the whole point of the mode.
    const lit = straight?.multiplier ? strikes?.find(s => s.number === n) : null;
    if (strikes?.some(s => s.number === n)) t.body.querySelector(`[data-zone="N${n}"]`)?.classList.add('is-lit-hit');
    const big = lit ? { title: `${lit.multiplier}×`, subtitle: `라이트닝 ${n}` }
      : straight && net >= res.round.stake * 5 ? { title: `${n}`, subtitle: strikes ? '29 대 1' : '35 대 1' } : null;
    const label = `${n} ${res.round.color === 'RED' ? 'Red' : res.round.color === 'BLACK' ? 'Black' : 'Zero'}${lit ? ` · ${lit.multiplier}×` : ''}`;
    // The dealer sets the dolly on the winning number before touching any chips, the way a
    // real croupier marks the spin; it stays until the next spin.
    await placeDolly(n);
    const settled = t.settle(net, { zones, hot, label, big });
    await Promise.all([settled, crowd.settle((zone, stake) => spotNet(zone, stake, n, strikes))]);
    await t.syncBalance();
    if (res.eventStreak) await meter?.update(res.eventStreak);
    lockMode(false);
    crowd.open();
  }

  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  refreshActions();
  crowd.open();
  return t;
}
