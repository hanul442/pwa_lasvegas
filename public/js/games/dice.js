// Sic Bo: three dice shaken under the dome, tumbling to the server's roll.
import { api, errorMessage } from '../api.js';
import { animate, sound, haptic, formatCH, wait, reducedMotion } from '../fx.js';
import { Table } from '../table.js';

const FACE_ROT = { 1: '', 2: 'rotateX(90deg)', 3: 'rotateY(-90deg)', 4: 'rotateY(90deg)', 5: 'rotateX(-90deg)', 6: 'rotateY(180deg)' };
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACES = [['front', 1], ['back', 6], ['right', 3], ['left', 4], ['top', 5], ['bottom', 2]];
const TOTAL_PAY = { 4: 50, 5: 18, 6: 14, 7: 12, 8: 8, 9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12, 15: 14, 16: 18, 17: 50 };

function cube() {
  return `<div class="die"><div class="die-cube">${FACES.map(([side, n]) => `<span class="die-face die-face--${side}">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i + 1) ? ' class="on"' : ''}></i>`).join('')}</span>`).join('')}</div></div>`;
}
const pose = n => `rotateX(-22deg) rotateY(28deg) ${FACE_ROT[n]}`;

export async function mountDice(ctx) {
  const t = new Table({ ...ctx, game: 'dice', title: 'Sic Bo', feltClass: 'felt--red' });
  const totals = Object.entries(TOTAL_PAY).map(([n, p]) => `<button type="button" class="zone zone--total" data-zone="T${n}"><strong>${n}</strong><small>${p}:1</small></button>`).join('');
  t.body.innerHTML = `
    <div class="sb">
      <div class="dome" data-dome><div class="dome-floor">${cube()}${cube()}${cube()}</div><div class="dome-glass" aria-hidden="true"></div><div class="dome-total" data-total aria-live="polite"></div></div>
      <div class="sb-main">
        <button type="button" class="zone zone--big-small" data-zone="SMALL"><strong>Small</strong><small>4–10 · 1:1</small></button>
        <button type="button" class="zone" data-zone="ODD"><strong>Odd</strong><small>1:1</small></button>
        <button type="button" class="zone zone--triple" data-zone="ANY_TRIPLE"><strong>Any triple</strong><small>24:1</small></button>
        <button type="button" class="zone" data-zone="EVEN"><strong>Even</strong><small>1:1</small></button>
        <button type="button" class="zone zone--big-small" data-zone="BIG"><strong>Big</strong><small>11–17 · 1:1</small></button>
      </div>
      <div class="sb-totals">${totals}</div>
    </div>`;
  t.body.querySelectorAll('[data-zone]').forEach(z => t.addZone(z));
  const dome = t.body.querySelector('[data-dome]');
  const dice = [...t.body.querySelectorAll('.die')];
  const totalEl = t.body.querySelector('[data-total]');
  const last = [1, 3, 5];
  dice.forEach((d, i) => { d.querySelector('.die-cube').style.transform = pose(last[i]); });

  async function roll(values) {
    totalEl.classList.remove('is-shown');
    await animate(dome, [
      { transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(-14px) rotate(-6deg)' }, { transform: 'translateY(-10px) rotate(7deg)' },
      { transform: 'translateY(-16px) rotate(-5deg)' }, { transform: 'translateY(-8px) rotate(4deg)' }, { transform: 'translateY(0) rotate(0)' }
    ], { duration: 640, easing: 'ease-in-out', fill: 'none' });
    sound.dice(); haptic([12, 30, 12, 30, 20]);
    const spins = reducedMotion() ? 0 : 1;
    await Promise.all(dice.map((d, i) => {
      const cubeEl = d.querySelector('.die-cube');
      const xs = 360 * (2 + i) * spins, ys = 360 * (3 - i) * spins;
      const end = pose(values[i]);
      const hop = (i - 1) * 18;
      return Promise.all([
        animate(cubeEl, [
          { transform: `rotateX(${xs}deg) rotateY(${ys}deg) ${pose(last[i])}` },
          { transform: end }
        ], { duration: 1100 + i * 140, easing: 'cubic-bezier(.2,.75,.25,1)' }),
        animate(d, [
          { transform: `translate(${-hop}px,-46px) scale(1.15)` },
          { transform: `translate(${hop}px,0) scale(1)`, offset: 0.35 },
          { transform: `translate(${hop / 2}px,-16px) scale(1.05)`, offset: 0.55 },
          { transform: 'translate(0,0) scale(1)', offset: 0.75 },
          { transform: 'translate(0,-4px)', offset: 0.85 },
          { transform: 'translate(0,0)' }
        ], { duration: 1100 + i * 140, easing: 'ease-out' })
      ]);
    }));
    values.forEach((v, i) => { last[i] = v; });
    sound.chip();
    const total = values.reduce((a, b) => a + b, 0);
    totalEl.textContent = values[0] === values[1] && values[1] === values[2] ? `Triple ${values[0]}` : `${total}, ${total <= 10 ? 'Small' : 'Big'}`;
    totalEl.classList.add('is-shown');
    const hits = [`T${total}`];
    const triple = values[0] === values[1] && values[1] === values[2];
    if (triple) hits.push('ANY_TRIPLE');
    else hits.push(total <= 10 ? 'SMALL' : 'BIG', total % 2 ? 'ODD' : 'EVEN');
    hits.forEach(z => { const n = t.body.querySelector(`[data-zone="${z}"]`); n?.classList.add('is-hit'); setTimeout(() => n?.classList.remove('is-hit'), 2600); });
  }

  function refreshActions() {
    t.setActions(t.idleActions('굴리기', go));
  }
  t.refreshActions = refreshActions;
  t.onBetChange = refreshActions;

  async function go() {
    if (!t.betReady) return;
    const zone = t.bet.zone;
    const betType = zone.startsWith('T') ? 'TOTAL' : zone;
    const target = zone.startsWith('T') ? Number(zone.slice(1)) : undefined;
    t.lock();
    let res;
    try { res = await api.sicbo(t.total, t.tier.floor, betType, target); }
    catch (e) { t.locked = false; t.root.classList.remove('is-playing'); t.toast(errorMessage(e)); return; }
    t.setServerState(res.state);
    await roll(res.round.dice);
    await wait(200);
    const net = res.round.netPnl;
    await t.settle(net, { label: `${res.round.dice.join(' · ')}${net ? ` ${net > 0 ? '+' : '−'}${formatCH(Math.abs(net))}` : ''}` });
    await t.syncBalance();
  }

  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  refreshActions();
  return t;
}
