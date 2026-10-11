// European roulette: the rotor and ball are animated to land on the server's number.
import { api, errorMessage } from '../api.js';
import { sound, haptic, formatCH, reducedMotion, wait } from '../fx.js';
import { Table } from '../table.js';

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = n => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const STEP = 360 / 37;

function wheelSvg() {
  const pockets = ORDER.map((n, i) => {
    const a0 = ((i - 0.5) * STEP - 90) * Math.PI / 180, a1 = ((i + 0.5) * STEP - 90) * Math.PI / 180;
    const R = 86, r = 60;
    const p = (rad, ang) => `${(rad * Math.cos(ang)).toFixed(2)},${(rad * Math.sin(ang)).toFixed(2)}`;
    const fill = { green: '#2e5e45', red: '#8a2626', black: '#1a1714' }[colorOf(n)];
    const label = `<text transform="rotate(${i * STEP}) translate(0,-76)" text-anchor="middle" dominant-baseline="middle">${n}</text>`;
    return `<path d="M${p(R, a0)} A${R},${R} 0 0 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 0 0 ${p(r, a0)} Z" fill="${fill}"/>${label}`;
  }).join('');
  const frets = ORDER.map((_, i) => `<line x1="0" y1="-60" x2="0" y2="-86" transform="rotate(${(i + 0.5) * STEP})"/>`).join('');
  return `<svg class="wheel-rotor" viewBox="-100 -100 200 200" aria-hidden="true">
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
  </svg>`;
}

function boardMarkup() {
  const cells = [];
  for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
    const n = col * 3 + (3 - row);
    cells.push(`<button type="button" class="num num--${colorOf(n)}" data-zone="N${n}" style="grid-column:${col + 2};grid-row:${row + 1}" aria-label="${n}번">${n}</button>`);
  }
  return `<div class="rl-board">
    <button type="button" class="num num--green num--zero" data-zone="N0" aria-label="0번">0</button>
    ${cells.join('')}
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

export async function mountRoulette(ctx) {
  const t = new Table({ ...ctx, game: 'roulette', title: 'Roulette', feltClass: 'felt--roulette' });
  t.body.innerHTML = `
    <div class="rl">
      <div class="rl-top">
        <div class="wheel" data-wheel>
          <div class="wheel-bowl" aria-hidden="true"></div>
          ${wheelSvg()}
          <div class="ball-orbit" data-orbit aria-hidden="true"><i class="ball" data-ball></i></div>
          <div class="wheel-result" data-result aria-live="polite"></div>
        </div>
        <ol class="rl-history" data-history aria-label="최근 번호"></ol>
      </div>
      <div class="rl-layout">${boardMarkup()}</div>
      <p class="rl-payouts" aria-hidden="true">숫자 하나 35:1 · 색/홀짝/구간 1:1</p>
    </div>`;
  t.body.querySelectorAll('[data-zone]').forEach(z => t.addZone(z));
  const rotor = t.body.querySelector('.wheel-rotor');
  const wheel = t.body.querySelector('[data-wheel]');
  const orbit = t.body.querySelector('[data-orbit]');
  const ball = t.body.querySelector('[data-ball]');
  const resultEl = t.body.querySelector('[data-result]');
  const history = t.body.querySelector('[data-history]');
  let rotorAngle = 0, ballAngle = 0;

  // Idle drift so the wheel never looks frozen.
  let idle = rotor.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 60000, iterations: Infinity });
  if (reducedMotion()) idle.pause();

  async function spinTo(number) {
    const now = idle.currentTime ? (idle.currentTime / 60000) * 360 : 0;
    idle.cancel();
    rotorAngle = (rotorAngle + now) % 360;
    const idx = ORDER.indexOf(number);
    const size = wheel.getBoundingClientRect().width;
    const track = size * 0.455, pocket = size * 0.36;
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
        { transform: `translateY(${-track}px)` },
        { transform: `translateY(${-track}px)`, offset: 0.6 },
        { transform: `translateY(${-pocket * 1.08}px)`, offset: 0.74 },
        { transform: `translateY(${-pocket * 1.16}px)`, offset: 0.8 },
        { transform: `translateY(${-pocket * 0.98}px)`, offset: 0.87 },
        { transform: `translateY(${-pocket * 1.04}px)`, offset: 0.93 },
        { transform: `translateY(${-pocket}px)` }
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
    ball.getAnimations().forEach(a => { a.commitStyles?.(); a.cancel(); });
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

  function refreshActions() {
    t.setActions(t.idleActions('스핀', spin));
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function spin() {
    if (!t.betReady) return;
    const zone = t.bet.zone;
    const betType = zone.startsWith('N') ? 'NUMBER' : zone;
    const target = zone.startsWith('N') ? Number(zone.slice(1)) : undefined;
    t.lock();
    let res;
    try { res = await api.roulette(t.total, t.tier.floor, betType, target); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    await spinTo(res.round.number);
    await wait(250);
    const net = res.round.netPnl;
    await t.settle(net, { label: `${res.round.number} ${res.round.color === 'RED' ? 'Red' : res.round.color === 'BLACK' ? 'Black' : 'Zero'}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}` });
    await t.syncBalance();
  }

  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  refreshActions();
  return t;
}
