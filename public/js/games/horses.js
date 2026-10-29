// 경마: six horses, a race card with win (단승) and place (연승) odds, and a 1200m sprint seen from
// the rail. The server draws the finishing order and every horse's split times; this screen only
// plays them back: who leads at each pole, who closes late and how close the photo is.
import { api, errorMessage } from '../api.js';
import { sound, haptic, wait, ms, reducedMotion, el, formatCH } from '../fx.js';
import { Table } from '../table.js';

const DISTANCE = 1200;
const SEG = 150;
// Race time plays 2.5× faster than the real clock: a 1:10 race takes about 28 seconds.
const SPEED = 2.5;
const FAST = 4;
const PULL_UP = 0.0168; // m per ms, about a winning sprinter's pace
const STYLE_KO = { FRONT: '선행', STALK: '선입', CLOSE: '추입' };
const COATS = ['#2a1b13', '#4e2f1c', '#171514', '#6b4528', '#3a2a20', '#7d7a74'];
// 단승·연승 on the card's two columns, or a pair of horses for 복승 / 쌍승 (remembered per device).
const KINDS = { single: '단승·연승', QUINELLA: '복승', EXACTA: '쌍승' };
const BET_KO = { WIN: '단승', PLACE: '연승', QUINELLA: '복승', EXACTA: '쌍승' };
const KIND_KEY = 'vegas:horses:kind';
const readKind = () => { try { const k = localStorage.getItem(KIND_KEY); return k in KINDS ? k : 'single'; } catch { return 'single'; } };
const saveKind = k => { try { localStorage.setItem(KIND_KEY, k); } catch {} };
const odds = x => (x / 100).toFixed(x % 10 ? 2 : 1);
const raceTime = msec => `${Math.floor(msec / 60000)}:${(msec % 60000 / 1000).toFixed(1).padStart(4, '0')}`;
// Korean particles after a name: 은하수가 / 한라산이.
const josa = (word, withFinal, without) => { const c = word.charCodeAt(word.length - 1) - 0xac00; return word + (c >= 0 && c < 11172 && c % 28 ? withFinal : without); };
const ink = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150 ? '#0a0b0d' : '#f4f5f7'; };
function marginText(msec) {
  if (msec < 40) return '코 차이';
  if (msec < 80) return '머리 차이';
  if (msec < 120) return '목 차이';
  return `${Math.max(1, Math.round(msec / 140 * 2) / 2)}마신 차`;
}

// ---------- the horse, drawn in a 64×40 box facing right, hooves on y=38 ----------
const P = typeof Path2D === 'function' ? s => new Path2D(s) : () => null;
const BODY = P('M14 17C16 12 24 11 32 12C37 12 41 11 44 13L49 7C50 5 52 4 54 5L60 9C61.4 10 61 12.4 59 12.6L55 12.2C53 13.4 51 15.4 49.6 18.4C48.4 21 46 23.2 43 24C38 25.8 26 26 20 25C16 24.2 13.2 21 14 17Z');
const EAR = P('M52 5.2L53.2 1.6L55 4.8Z');
const TAIL = P('M15 15C10 13.6 6 16.6 3.6 23.4C7 21 10 20.4 14.4 19.6Z');
const MANE = P('M44 13L49 7C50 5.6 51.4 4.8 52.6 5L47.4 11.4L45 14.4Z');
const LEGS = [
  P('M44 23L50 29.5L55.5 32.5M41.5 24L45 31L47.5 37M19 23L13 29.5L7.5 32.5M22 24L19 31L18 37'),
  P('M44 23L46 30L46.5 37M41.5 24L42 31L40.5 37M19 23L18 30L16.5 37M22 24L22.5 31L21.5 37'),
  P('M44 23L42 30L45 36.5M41.5 24L40 31L36.5 35M19 23L22.5 30L25.5 36.5M22 24L25 30L22 35')
];
const STAND = LEGS[1];
const TORSO = P('M31.5 10.6C32.6 6.4 37.6 3.8 42 5.8L43.2 8C40 9.2 36 10.2 33 11.4Z');
const ARM = P('M40.5 7L47.5 9.6');
const BOOT = P('M35 10.4L38.4 14.6L41.6 14.2');

export async function mountHorses(ctx) {
  const t = new Table({ ...ctx, game: 'horses', title: '경마', feltClass: 'felt--turf' });
  t.body.innerHTML = `
    <div class="hr" data-phase="card">
      <div class="hr-track" data-track>
        <canvas class="hr-canvas" aria-hidden="true"></canvas>
        <div class="hr-flash" aria-hidden="true"></div>
        <div class="hr-photo" aria-hidden="true">사진 판독</div>
      </div>
      <div class="hr-bar">
        <p class="hr-call" data-call aria-live="polite"></p>
        <div class="hr-tools">
          <button type="button" class="hr-tool" data-fast aria-pressed="false" aria-label="4배 빠르게" title="4배 빠르게"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l8 6-8 6zM12 6l8 6-8 6z"/></svg></button>
          <button type="button" class="hr-tool" data-skip aria-label="결승선 앞으로 건너뛰기" title="결승선 앞으로 건너뛰기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l9 6-9 6zM16 6h3v12h-3z"/></svg></button>
        </div>
      </div>
      <ol class="hr-result" data-result aria-live="polite"></ol>
      <div class="hr-ticket" data-ticket></div>
      <section class="hr-card" aria-label="출전표">
        <header class="hr-head"><span class="hr-head-left"><span class="sr-only" data-race-title>출전표</span><span class="hr-kinds" role="group" aria-label="베팅 종류">${Object.entries(KINDS).map(([k, label]) => `<button type="button" data-kind="${k}">${label}</button>`).join('')}</span></span><span class="hr-col">단승</span><span class="hr-col">연승</span><span class="hr-col hr-col--pair" data-pair-head></span></header>
        <ul class="hr-runners" data-runners></ul>
        <div class="hr-slip" data-slip>
          <span class="hr-slip-picks" data-slip-picks></span>
          <span class="hr-slip-text" data-slip-text></span>
          <button type="button" class="zone hr-odds hr-pair-zone" data-zone="PAIR"><strong data-pair-odds>—</strong></button>
        </div>
      </section>
    </div>`;
  const root = t.body.querySelector('.hr');
  const track = root.querySelector('[data-track]');
  const canvas = root.querySelector('canvas');
  const g = canvas.getContext('2d');
  const callEl = root.querySelector('[data-call]');
  const resultEl = root.querySelector('[data-result]');
  const ticketEl = root.querySelector('[data-ticket]');
  const runnersEl = root.querySelector('[data-runners]');
  const titleEl = root.querySelector('[data-race-title]');
  const fastBtn = root.querySelector('[data-fast]');
  const skipBtn = root.querySelector('[data-skip]');
  const kindButtons = [...root.querySelectorAll('[data-kind]')];
  const pairHead = root.querySelector('[data-pair-head]');
  const pairZone = root.querySelector('[data-zone="PAIR"]');
  const pairOdds = root.querySelector('[data-pair-odds]');
  const slipPicks = root.querySelector('[data-slip-picks]');
  const slipText = root.querySelector('[data-slip-text]');
  t.addZone(pairZone);
  let kind = readKind();
  // The two horses of a 복승 / 쌍승 ticket, in the order tapped (first, second for 쌍승).
  let picks = [];

  let card = null;
  // What the canvas shows: each runner's distance, stride phase and the camera.
  const view = { horses: [], camX: -6, span: 34, mine: 0, gray: 0, finish: false, goal: null, running: false };
  let raf = 0, alive = true;

  // ---------- race card ----------
  function renderCard(next) {
    card = next;
    titleEl.textContent = '출전표';
    const fav = Math.min(...card.runners.map(r => r.win));
    runnersEl.replaceChildren(...card.runners.map(r => {
      const li = el('li', 'hr-runner');
      li.dataset.gate = r.gate;
      li.innerHTML = `
        <span class="hr-gate" style="--silk:${r.silk};--silk-ink:${ink(r.silk)}">${r.gate}</span>
        <span class="hr-info">
          <span class="hr-name"><b>${r.name}</b><span class="hr-form" aria-label="최근 성적 ${r.form.join(', ')}착">${r.form.map(n => `<span class="${n === 1 ? 'is-win' : n <= 3 ? 'is-place' : ''}">${n}</span>`).join('')}</span></span>
          <span class="hr-tag"><i>${STYLE_KO[r.style] || ''}</i>${r.tag}</span>
        </span>
        <button type="button" class="zone hr-odds" data-zone="W${r.gate}" aria-label="${r.gate}번 ${r.name} 단승 ${odds(r.win)}배${r.win === fav ? ', 인기 1위' : ''}"><strong>${odds(r.win)}</strong>${r.win === fav ? '<small>인기 1위</small>' : ''}</button>
        <button type="button" class="zone hr-odds" data-zone="P${r.gate}" aria-label="${r.gate}번 ${r.name} 연승 ${odds(r.place)}배"><strong>${odds(r.place)}</strong></button>
        <button type="button" class="hr-pick" data-pick="${r.gate}" aria-pressed="false" aria-label="${r.gate}번 ${r.name} 고르기"><span></span></button>`;
      li.querySelectorAll('[data-zone]').forEach(z => t.addZone(z));
      li.querySelector('[data-pick]').addEventListener('click', () => togglePick(r.gate));
      return li;
    }));
    picks = [];
    showPicks();
    view.horses = card.runners.map((r, i) => ({ ...r, d: 0, phase: i * 0.37, coat: COATS[[...r.id].reduce((a, c) => a + c.charCodeAt(0), 0) % COATS.length] }));
    view.camX = -6; view.span = 34; view.gray = 0; view.finish = false; view.mine = 0; view.goal = null; view.running = false;
    draw();
  }

  async function loadCard() {
    try { renderCard((await api.horsesCard()).card); }
    catch (e) { t.toast(errorMessage(e)); }
  }

  const betOf = () => {
    const z = t.bet.zone;
    if (!z) return null;
    if (z === 'PAIR') return { betType: kind, pick: [...picks], pair: true };
    return { betType: z[0] === 'W' ? 'WIN' : 'PLACE', pick: Number(z.slice(1)) };
  };
  const runner = gate => card.runners.find(r => r.gate === gate);
  // The board price for a pair: 복승 lists the lower gate first, 쌍승 keeps the order.
  const pairPrice = (k, two) => {
    if (!card || two.length !== 2) return null;
    const [a, b] = k === 'QUINELLA' ? [...two].sort((x, y) => x - y) : two;
    return (k === 'QUINELLA' ? card.quinella : card.exacta)?.[`${a}-${b}`] ?? null;
  };

  // ---------- 복승 · 쌍승 ----------
  function showPicks() {
    const pair = kind !== 'single';
    root.classList.toggle('hr--pair', pair);
    kindButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    pairHead.textContent = kind === 'EXACTA' ? '1착 → 2착' : '두 마리';
    runnersEl.querySelectorAll('[data-pick]').forEach(b => {
      const k = picks.indexOf(Number(b.dataset.pick));
      b.setAttribute('aria-pressed', String(k >= 0));
      b.firstElementChild.textContent = k < 0 ? '' : kind === 'EXACTA' ? `${k + 1}착` : '✓';
      b.closest('.hr-runner').classList.toggle('is-picked', pair && k >= 0);
    });
    const price = pairPrice(kind, picks);
    pairOdds.textContent = price ? odds(price) : '—';
    pairZone.setAttribute('aria-label', price ? `${picks.join('번, ')}번 ${KINDS[kind]} ${odds(price)}배에 걸기` : `${KINDS[kind]}: 말 두 마리를 고르세요`);
    slipPicks.replaceChildren(...picks.map(g => { const r = card && runner(g); const n = el('span', 'hr-gate'); n.textContent = g; if (r) n.style.cssText = `--silk:${r.silk};--silk-ink:${ink(r.silk)}`; return n; }));
    slipText.textContent = picks.length === 2
      ? (kind === 'EXACTA' ? `${runner(picks[0]).name} 1착, ${runner(picks[1]).name} 2착` : `${runner(picks[0]).name} · ${runner(picks[1]).name} 1·2착`)
      : kind === 'EXACTA' ? (picks.length ? '2착 할 말을 고르세요' : '1착 할 말부터 고르세요') : (picks.length ? '한 마리 더 고르세요' : '1·2착 할 두 마리를 고르세요');
    view.mine = pair ? picks[0] || 0 : view.mine;
    draw();
  }
  function togglePick(gate) {
    if (t.locked || t.busy || kind === 'single') return;
    const k = picks.indexOf(gate);
    if (k >= 0) picks.splice(k, 1);
    else if (picks.length < 2) picks.push(gate);
    else picks = [picks[0], gate];
    sound.chip(); haptic(6);
    showPicks();
    refreshActions();
  }
  kindButtons.forEach(b => b.addEventListener('click', async () => {
    const next = b.dataset.kind;
    if (t.locked || t.busy || next === kind) return;
    const held = t.bet.zone;
    const was = kind;
    kind = next; saveKind(kind);
    // Chips follow the ticket: a 단승 / 연승 horse becomes the first pick, a pair's first pick its 단승.
    if (was === 'single' && held) { picks = [Number(held.slice(1))]; await t.moveBet(held, 'PAIR'); }
    else if (next === 'single' && held === 'PAIR') { if (picks[0]) await t.moveBet('PAIR', `W${picks[0]}`); else await t.clearBet(); picks = []; }
    showPicks();
    t.onBetChange();
  }));

  // ---------- canvas ----------
  let W = 0, H = 0;
  function fit() {
    const r = track.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  ro?.observe(track);

  function draw() {
    if (!W || !card) return;
    const MAP = 18, RAIL = 12;
    const top = MAP + RAIL, bottom = H - RAIL;
    const laneH = (bottom - top - 8) / 6;
    const ppm = W / view.span;
    const X = d => (d - view.camX) * ppm;
    g.clearRect(0, 0, W, H);
    // turf, mown in stripes that slide past as the camera runs
    g.fillStyle = '#1d5b3c'; g.fillRect(0, 0, W, H);
    const stripe = 6;
    g.fillStyle = '#226844';
    for (let d = Math.floor(view.camX / stripe) * stripe; X(d) < W; d += stripe) if (Math.round(d / stripe) % 2 === 0) g.fillRect(X(d), MAP, stripe * ppm + 0.5, H - MAP);
    // the map strip along the top: the whole 1200m and a dot per horse
    g.fillStyle = '#0a0b0dcc'; g.fillRect(0, 0, W, MAP);
    const mx = d => 14 + (W - 28) * Math.min(1, Math.max(0, d / DISTANCE));
    g.strokeStyle = '#f4f5f744'; g.lineWidth = 2; g.beginPath(); g.moveTo(mx(0), MAP / 2); g.lineTo(mx(DISTANCE), MAP / 2); g.stroke();
    g.fillStyle = '#f4f5f7'; g.fillRect(mx(DISTANCE) - 1, 3, 2, MAP - 6);
    [...view.horses].sort((a, b) => a.d - b.d).forEach(h => { g.beginPath(); g.arc(mx(h.d), MAP / 2, h.gate === view.mine ? 4.5 : 3.5, 0, 7); g.fillStyle = h.silk; g.fill(); g.lineWidth = h.gate === view.mine ? 2 : 1; g.strokeStyle = h.gate === view.mine ? '#f4f5f7' : '#0a0b0d'; g.stroke(); });
    // rails, with a post every 10m and a marked pole every 200m (the distance still to run)
    g.fillStyle = '#0d2a1c'; g.fillRect(0, MAP, W, RAIL); g.fillRect(0, bottom, W, RAIL);
    g.fillStyle = '#f4f5f7'; g.fillRect(0, MAP + RAIL - 3, W, 2); g.fillRect(0, bottom + 1, W, 2);
    for (let d = Math.floor(view.camX / 10) * 10; X(d) < W + 20; d += 10) {
      if (d < 0 || d > DISTANCE + 200) continue;
      g.fillStyle = '#f4f5f7aa'; g.fillRect(X(d) - 0.5, MAP + RAIL - 6, 1, 5); g.fillRect(X(d) - 0.5, bottom + 1, 1, 5);
    }
    g.font = '700 10px Archivo, "Noto Sans KR", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    for (let d = Math.floor(view.camX / 200) * 200; X(d) < W + 40; d += 200) {
      if (d < 0 || d >= DISTANCE) continue;
      const x = X(d);
      g.fillStyle = '#f4f5f7'; g.fillRect(x - 1, MAP, 2, RAIL);
      g.fillStyle = '#0a0b0d'; g.fillRect(x - 15, MAP + 1, 30, RAIL - 3);
      g.fillStyle = '#f4f5f7'; g.fillText(d === 0 ? '출발' : String(DISTANCE - d), x, MAP + RAIL / 2);
    }
    // the finish: a white line across the turf, checkered at the rails
    const fx = X(DISTANCE);
    if (fx > -10 && fx < W + 10) {
      g.fillStyle = '#f4f5f7'; g.fillRect(fx - 1.5, top, 3, bottom - top);
      for (let y = MAP, k = 0; y < H; y += 4, k++) { if (y > top && y < bottom) continue; g.fillStyle = k % 2 ? '#0a0b0d' : '#f4f5f7'; g.fillRect(fx - 4, y, 4, 4); g.fillStyle = k % 2 ? '#f4f5f7' : '#0a0b0d'; g.fillRect(fx, y, 4, 4); }
      g.fillStyle = '#f4f5f7'; g.fillRect(fx - 17, H - RAIL + 1, 34, RAIL - 2);
      g.fillStyle = '#0a0b0d'; g.fillText('결승', fx, H - RAIL / 2 + 0.5);
    }
    // the starting stalls, while the field is still behind them
    const sx = X(0);
    if (sx > -40 && view.horses.every(h => h.d < 30)) {
      for (let i = 0; i < 6; i++) {
        const y = top + 4 + laneH * i;
        g.fillStyle = '#0a0b0de6'; g.fillRect(sx + 1, y, 6, laneH - 2);
        g.fillStyle = '#f4f5f7'; g.fillRect(sx + 1, y, 6, 2);
      }
    }
    // before the off: the race's title in the empty stretch, like a broadcast caption
    if (!view.running && card) {
      g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      g.fillStyle = '#f4f5f7e6'; g.font = '700 22px Archivo, "Noto Sans KR", sans-serif';
      g.fillText(`제${card.raceNo}경주`, W - 16, top + (bottom - top) / 2 + 4);
      g.fillStyle = '#f4f5f799'; g.font = '600 12px Archivo, "Noto Sans KR", sans-serif';
      g.fillText(`${card.distance}m 단거리 · 잔디`, W - 16, top + (bottom - top) / 2 + 22);
    }
    if (view.gray) { g.fillStyle = `rgba(244,245,247,${0.42 * view.gray})`; g.fillRect(0, MAP, W, H - MAP); }
    // horses, far lane first
    const s = Math.min(1.25, Math.max(0.5, laneH * 1.5 / 40));
    view.horses.forEach((h, i) => drawHorse(h, X(h.d), top + 4 + laneH * (i + 1) - 2, s, laneH >= 24));
    // A runner the camera has left behind (or that has run off the right) gets a tag at that edge
    // of its lane: its number in its silks and how far it is off the lead.
    const lead = Math.max(...view.horses.map(h => h.d));
    view.horses.forEach((h, i) => {
      const nose = X(h.d);
      const behind = nose < 18, ahead = nose - 56 * s > W;
      if (!behind && !ahead) return;
      const mine = h.gate === view.mine;
      const ph = Math.max(14, Math.min(20, laneH - 4)), cy = top + 4 + laneH * i + laneH / 2;
      const gap = Math.round(lead - h.d);
      const text = behind && gap > 0 ? `-${gap}m` : '';
      g.font = `700 ${ph >= 18 ? 11 : 10}px Archivo, "Noto Sans KR", sans-serif`;
      const tw = text ? g.measureText(text).width + 8 : 0;
      const w = ph + 10 + tw, x0 = behind ? 4 : W - 4 - w;
      // the pill, pointing off the edge the horse is beyond
      g.fillStyle = '#0a0b0de6';
      g.beginPath();
      if (behind) { g.moveTo(x0, cy); g.lineTo(x0 + 7, cy - ph / 2); g.lineTo(x0 + w - ph / 2, cy - ph / 2); g.arc(x0 + w - ph / 2, cy, ph / 2, -Math.PI / 2, Math.PI / 2); g.lineTo(x0 + 7, cy + ph / 2); }
      else { g.moveTo(x0 + w, cy); g.lineTo(x0 + w - 7, cy - ph / 2); g.lineTo(x0 + ph / 2, cy - ph / 2); g.arc(x0 + ph / 2, cy, ph / 2, -Math.PI / 2, Math.PI / 2, true); g.lineTo(x0 + w - 7, cy + ph / 2); }
      g.closePath(); g.fill();
      g.lineWidth = mine ? 2 : 1; g.strokeStyle = mine ? '#f4f5f7' : '#f4f5f744'; g.stroke();
      // the gate number on its silk
      const dot = behind ? x0 + 6 + (ph - 4) / 2 : x0 + ph / 2 + 1;
      g.beginPath(); g.arc(dot, cy, (ph - 6) / 2, 0, 7); g.fillStyle = h.silk; g.fill();
      g.fillStyle = ink(h.silk); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(h.gate), dot, cy + 0.5);
      if (text) { g.fillStyle = '#f4f5f7'; g.textAlign = 'left'; g.fillText(text, x0 + 6 + ph - 2, cy + 0.5); }
    });
  }

  function drawHorse(h, noseX, groundY, s, tags) {
    if (!BODY) return;
    g.save();
    const moving = h.v > 0.002;
    const bob = moving ? Math.abs(Math.sin(h.phase * Math.PI)) * 2.2 * s : 0;
    g.translate(noseX - 60.5 * s, groundY - 38 * s - bob);
    g.scale(s, s);
    g.fillStyle = '#00000055'; g.beginPath(); g.ellipse(32, 38 + bob / s, 22, 2.6, 0, 0, 7); g.fill();
    if (h.gate === view.mine && tags) { g.strokeStyle = '#f4f5f7'; g.lineWidth = 1.4 / s; g.beginPath(); g.ellipse(32, 38 + bob / s, 25, 3.4, 0, 0, 7); g.stroke(); }
    g.fillStyle = h.coat; g.fill(TAIL);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const legs = moving ? LEGS[Math.floor(h.phase * 3) % 3] : STAND;
    g.strokeStyle = h.coat; g.lineWidth = 2.6; g.stroke(legs);
    g.fill(BODY); g.fill(EAR);
    g.fillStyle = '#0a0b0d88'; g.fill(MANE);
    // saddle cloth with the gate number
    g.fillStyle = '#f4f5f7'; g.beginPath(); pill(25.5, 12.5, 10, 9, 1.5); g.fill();
    g.fillStyle = '#0a0b0d'; g.font = '800 7.5px Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(h.gate), 30.5, 17.4);
    // jockey in the owner's silks
    g.strokeStyle = '#f4f5f7'; g.lineWidth = 2.2; g.stroke(BOOT);
    g.fillStyle = h.silk; g.fill(TORSO);
    g.strokeStyle = h.silk; g.lineWidth = 2; g.stroke(ARM);
    g.beginPath(); g.arc(43.6, 4.4, 2.5, 0, 7); g.fill();
    g.strokeStyle = '#0a0b0d66'; g.lineWidth = 0.6; g.stroke(TORSO);
    g.restore();
    if (!tags) return;
    if (h.gate === view.mine) tagBehind(noseX - 60 * s, groundY - 20 * s - bob, '내 말');
  }

  const pill = (x, y, w, h, r) => (g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h));

  function tagBehind(tailX, y, text) {
    g.font = '700 11px Archivo, "Noto Sans KR", sans-serif';
    const w = g.measureText(text).width + 12;
    g.fillStyle = '#f4f5f7';
    g.beginPath(); pill(tailX - w - 4, y - 8, w, 16, 8); g.fill();
    g.fillStyle = '#0a0b0d'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, tailX - w / 2 - 4, y + 0.5);
  }

  // ---------- pace: monotone cubic through the server's split times ----------
  function curveOf(splits) {
    const n = splits.length;
    const dk = [];
    for (let k = 0; k < n - 1; k++) dk.push(SEG / (splits[k + 1] - splits[k]));
    const m = [0];
    for (let k = 1; k < n - 1; k++) m.push((dk[k - 1] + dk[k]) / 2);
    m.push(dk[n - 2]);
    for (let k = 0; k < n - 1; k++) {
      const a = m[k] / dk[k], b = m[k + 1] / dk[k], r = a * a + b * b;
      if (r > 9) { const tau = 3 / Math.sqrt(r); m[k] = tau * a * dk[k]; m[k + 1] = tau * b * dk[k]; }
    }
    // Past the post every horse pulls up the same way, so nobody overtakes after the line.
    const T = splits[n - 1], vEnd = PULL_UP;
    return time => {
      if (time <= 0) return { d: 0, v: 0 };
      if (time >= T) { const dt = Math.min(time - T, 4000); return { d: DISTANCE + vEnd * dt * (1 - dt / 8000), v: vEnd * (1 - dt / 4000) }; }
      let k = 0; while (k < n - 2 && time > splits[k + 1]) k++;
      const h = splits[k + 1] - splits[k], u = (time - splits[k]) / h;
      const u2 = u * u, u3 = u2 * u;
      const d = (2 * u3 - 3 * u2 + 1) * SEG * k + (u3 - 2 * u2 + u) * h * m[k] + (-2 * u3 + 3 * u2) * SEG * (k + 1) + (u3 - u2) * h * m[k + 1];
      const v = ((6 * u2 - 6 * u) * SEG * k + (3 * u2 - 4 * u + 1) * h * m[k] + (-6 * u2 + 6 * u) * SEG * (k + 1) + (3 * u2 - 2 * u) * h * m[k + 1]) / h;
      return { d, v };
    };
  }

  // ---------- commentary ----------
  const call = text => { callEl.textContent = text; callEl.classList.remove('is-new'); void callEl.offsetWidth; callEl.classList.add('is-new'); };

  // ---------- play a race back ----------
  function play(round) {
    const curves = round.splits.map(curveOf);
    view.running = true;
    const names = Object.fromEntries(round.card.runners.map(r => [r.gate, r.name]));
    const T1 = round.times[round.order[0] - 1], Tlast = Math.max(...round.times);
    let clock = 0, last = performance.now(), fast = false, skip = reducedMotion();
    let leader = 0, lastCall = -Infinity, said = new Set(), photoDone = false, hold = 0;
    fastBtn.setAttribute('aria-pressed', 'false');
    fastBtn.onclick = () => { fast = !fast; fastBtn.setAttribute('aria-pressed', String(fast)); };
    skipBtn.onclick = () => { skip = true; };
    const say = (text, force = false) => { if (force || clock - lastCall > 2600) { call(text); lastCall = clock; return true; } return false; };
    call('출발합니다! 여섯 마리가 일제히 게이트를 나섭니다');
    lastCall = 0;
    return new Promise(resolve => {
      const frame = now => {
        if (!alive) return resolve();
        const dt = Math.min(64, now - last); last = now;
        if (skip && clock < T1 - 1800) { clock = T1 - 1800; leader = 0; }
        if (hold > 0) hold -= dt;
        else clock += dt * SPEED * (fast ? FAST : 1);
        if (!photoDone && clock >= T1) { clock = T1; photoDone = true; finishMoment(); }
        const pos = curves.map(c => c(clock));
        view.horses.forEach((h, i) => { const p = pos[i]; h.phase += Math.max(0, p.d - h.d) / 6.5; h.d = p.d; h.v = p.v; });
        // commentary: lead changes, then calls at the poles
        const ranked = view.horses.map(h => h.gate).sort((a, b) => pos[b - 1].d - pos[a - 1].d);
        const front = ranked[0], second = ranked[1];
        const lead = pos[front - 1].d;
        if (clock < T1 && clock > 2500) {
          if (front !== leader && pos[front - 1].d - pos[second - 1].d > 0.4) {
            const prev = leader;
            const pick = [
              () => `${josa(names[front], '이', '가')} 선두로 나섭니다!`,
              () => `${josa(names[front], '이', '가')} ${josa(names[prev], '을', '를')} 제치고 선두!`,
              () => `${names[front]}, 바깥에서 치고 나와 선두 탈환!`
            ];
            if (say(prev ? pick[(said.size + front) % 3]() : pick[0](), !prev)) { leader = front; said.add(`lead${front}${Math.floor(lead)}`); }
          }
          const marks = [
            [350, () => `선두 ${names[front]}, 2위 ${names[second]}. 페이스가 빠릅니다`],
            [650, () => `3코너 돌아 4코너로! 선두는 여전히 ${names[front]}`],
            [850, () => `직선주로 진입! ${names[ranked[2]]}도 힘을 냅니다`],
            [1000, () => (lead - pos[second - 1].d < 2.5 ? `결승선까지 200m! ${josa(names[front], '과', '와')} ${names[second]}, 치열한 접전!` : `결승선까지 200m! ${names[front]}, 독주 체제!`)],
            [1120, () => `${names[front]}! ${names[second]}! 마지막 한 걸음!`]
          ];
          for (const [at, line] of marks) if (lead >= at && !said.has(at) && say(line())) { said.add(at); break; }
        }
        // the camera keeps the leader near the right edge and widens to fit the field
        const lastD = Math.min(...pos.map(p => p.d));
        if (view.goal) {
          view.span += (view.goal.span - view.span) * Math.min(1, dt / 350);
          view.camX += (view.goal.camX - view.camX) * Math.min(1, dt / 350);
        } else if (!view.finish) {
          const span = Math.min(90, Math.max(28, lead - lastD + 14));
          view.span += (span - view.span) * Math.min(1, dt / 400);
          const cam = Math.min(lead, DISTANCE) - view.span * 0.78;
          view.camX = clock < 300 ? cam : view.camX + (cam - view.camX) * Math.min(1, dt / 120);
        }
        draw();
        if (photoDone && hold <= 0 && clock >= Tlast + 600) return resolve();
        raf = requestAnimationFrame(frame);
      };
      // The nose of the winner on the line: a flash, and for a close one a frozen, zoomed photo.
      function finishMoment() {
        view.finish = true;
        sound.shutter(); haptic([10, 30, 10]);
        track.classList.remove('is-flash'); void track.offsetWidth; track.classList.add('is-flash');
        const w = round.order[0], r = round.order[1];
        if (round.photo && !reducedMotion()) {
          hold = ms(1900);
          view.span = 9; view.camX = DISTANCE - 4.5;
          view.gray = 1;
          track.classList.add('is-photo');
          call(`${names[w]}, ${names[r]} 나란히 골인! 사진 판독입니다`);
          setTimeout(() => {
            if (!alive) return;
            view.gray = 0; track.classList.remove('is-photo');
            view.goal = { span: 54, camX: DISTANCE - 54 * 0.2 };
            call(`판독 결과 ${josa(names[w], '이', '가')} ${marginText(round.margin)}로 우승!`);
          }, ms(1700));
        } else {
          view.goal = { span: 54, camX: DISTANCE - 54 * 0.2 };
          call(`${names[w]}, 1착으로 골인! ${marginText(round.margin)} 승리`);
        }
      }
      raf = requestAnimationFrame(frame);
    });
  }

  function showResult(round) {
    const names = Object.fromEntries(round.card.runners.map(r => [r.gate, r]));
    resultEl.replaceChildren(...round.order.slice(0, 3).map((gate, k) => {
      const r = names[gate];
      const mine = Array.isArray(round.pick) ? round.pick.includes(gate) : gate === round.pick;
      const li = el('li', `hr-place${mine ? ' is-mine' : ''}`);
      li.innerHTML = `<span class="hr-place-n">${k + 1}착</span><span class="hr-gate" style="--silk:${r.silk};--silk-ink:${ink(r.silk)}">${gate}</span><b>${r.name}</b><span class="hr-time">${raceTime(round.times[gate - 1])}</span>`;
      return li;
    }));
    resultEl.classList.add('is-shown');
  }

  // ---------- a round ----------
  function refreshActions() { t.setActions(t.idleActions('출발', go)); }
  t.refreshActions = refreshActions;
  t.onBetChange = () => {
    const b = betOf();
    if (kind === 'single') {
      runnersEl.querySelectorAll('.hr-runner').forEach(li => li.classList.toggle('is-picked', Number(li.dataset.gate) === b?.pick));
      view.mine = b?.pick || 0; draw();
    } else showPicks();
    refreshActions();
  };

  async function go() {
    const bet = betOf();
    if (!t.betReady || !bet || !card) return;
    if (bet.pair && bet.pick.length !== 2) { t.toast(kind === 'EXACTA' ? '1착과 2착 할 말을 차례로 골라 주세요' : '1·2착 할 말 두 마리를 골라 주세요'); return; }
    const horses = bet.pair ? bet.pick.map(runner) : [runner(bet.pick)];
    const r = horses[0];
    const price = bet.pair ? pairPrice(bet.betType, bet.pick) : bet.betType === 'WIN' ? r.win : r.place;
    t.lock();
    view.mine = r.gate;
    const gates = horses.map(h => `<span class="hr-gate" style="--silk:${h.silk};--silk-ink:${ink(h.silk)}">${h.gate}</span>`).join('');
    ticketEl.innerHTML = `${gates}<span class="hr-ticket-text"><b>${horses.map(h => h.name).join(bet.betType === 'EXACTA' ? ' → ' : ' · ')}</b><span>${BET_KO[bet.betType]} ${odds(price)}배 · ${formatCH(t.total)}</span></span>`;
    // The chips ride on the ticket: the odds button that holds them moves there for the race.
    const zoneNode = t.zones.get(t.bet.zone);
    const home = zoneNode.parentElement, before = zoneNode.nextSibling;
    ticketEl.append(zoneNode);
    root.dataset.phase = 'race';
    resultEl.classList.remove('is-shown');
    call('출주 준비. 게이트에 들어갑니다');
    sound.bugle();
    let res;
    try {
      [res] = await Promise.all([api.horsesRace(t.total, t.tier.floor, card.id, bet.betType, bet.pick), wait(1300)]);
    } catch (e) {
      home.insertBefore(zoneNode, before);
      t.locked = false; t.root.classList.remove('is-playing'); root.dataset.phase = 'card'; call('');
      t.toast(errorMessage(e));
      if (e.code === 'RACE_CARD_STALE') { await t.clearBet({ animateBack: false }); await loadCard(); }
      refreshActions();
      return;
    }
    t.setServerState(res.state);
    const round = res.round;
    await play(round);
    if (!alive) return;
    showResult(round);
    root.dataset.phase = 'result';
    await wait(900);
    const winner = round.card.runners.find(x => x.gate === round.order[0]);
    const who = bet.pair ? `${bet.pick.join(bet.betType === 'EXACTA' ? '→' : '·')}번` : `${round.pick}번 ${r.name}`;
    const label = round.won ? `${who} ${BET_KO[round.betType]} 적중 · ${odds(round.odds)}배` : `${winner.gate}번 ${winner.name} 우승`;
    const big = round.won && round.odds >= 1000 ? { title: `${odds(round.odds)}배 적중`, subtitle: `${bet.pair ? horses.map(h => h.name).join(' · ') : r.name} ${BET_KO[round.betType]}` } : undefined;
    await t.settle(round.netPnl, { label, big, kind: round.won && round.netPnl === 0 ? 'push' : undefined });
    await t.syncBalance();
    if (!alive) return;
    resultEl.classList.remove('is-shown');
    // The ticket's bet spot goes back where it came from (the 복승·쌍승 slip keeps its one spot).
    home.insertBefore(zoneNode, before);
    ticketEl.replaceChildren();
    call('');
    root.dataset.phase = 'card';
    renderCard(res.next);
    t.onBetChange();
  }

  const destroy = t.destroy.bind(t);
  t.destroy = () => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); destroy(); };
  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  refreshActions();
  showPicks();
  await loadCard();
  fit();
  t.onBetChange();
  return t;
}
