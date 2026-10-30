// Going bust is news too: the screen goes dark, the loss rolls up in red, and the player gets a
// card to brag about it ("동네방네 자랑하기"). Everyone else already hears it through the lounge
// feed, the top banner and a push notification (lib/news.mjs).
import { el, sound, haptic, rollNumber, formatCH, formatMoney, ms, reducedMotion } from './fx.js';
import { playtime, duration } from './playtime.js';
import { playerId } from './api.js';
import { gameName } from './lounge.js';
import { loadLogo, shareImage } from './share.js';
import { dayChart, chartPoints } from './day-chart.js';
import { remember } from './seen.js';

const ROASTS = [
  '카지노는 이겼고, 나는 졌다',
  '전 재산 탕진 인증합니다',
  '딜러가 팁 고맙다고 인사했어요',
  '하우스는 언제나 이겨요. 오늘도요',
  '지갑이 텅 비었어요. 위로는 칩으로 받습니다',
  '오늘의 교훈: 그만둘 때를 알자',
  'VIP 대접은 다음 생에 받을게요',
  '이 정도면 카지노 지분이 있어야 해요'
];
const roastFor = id => ROASTS[[...String(id)].reduce((n, c) => n + c.charCodeAt(0), 0) % ROASTS.length];

// The day up to the bust (lib/loss-tally.mjs), or what an older bust record still knows.
export function bustDay(bust) {
  const d = bust?.today;
  const last = bust?.sessionLoss || 0;
  if (!d || !(d.rounds > 0)) return { last, stake: bust?.stake || 0, peak: last, start: last, lost: last, won: 0, rounds: 0, losses: 0, losingRun: 0, high: 0, busts: 0 };
  return { last, stake: bust.stake || 0, peak: Math.max(d.peak || 0, last), start: d.start || 0, lost: d.lost || 0, won: d.won || 0, rounds: d.rounds, losses: d.losses || 0, losingRun: d.losingRun || 0, high: d.high || 0, busts: d.busts || 0 };
}

// The line that stings most, from what actually happened today; the stock roast otherwise.
export function stingFor(bust) {
  const d = bustDay(bust);
  if (d.high > 0) return `오늘 한때 +${formatMoney(d.high)}까지 벌고 있었어요`;
  if (d.busts >= 2) return `오늘만 ${d.busts}번째 파산이에요`;
  if (d.losingRun >= 3) return `${d.losingRun}연패로 마무리했어요`;
  if (d.stake && d.last >= d.peak) return '올인 한 방에 끝났어요';
  return roastFor(bust.id);
}

// The receipt under the drain: every way of counting what went, worst last.
export function bustLines(bust) {
  const d = bustDay(bust);
  const rows = [['마지막 한 판', `-${formatCH(d.last)}`]];
  if (d.rounds > 1) {
    rows.push([`오늘 잃은 돈 · ${d.losses || d.rounds}판`, `-${formatCH(d.lost)}`]);
    if (d.won > 0) rows.push(['오늘 딴 돈', `+${formatCH(d.won)}`]);
    if (d.peak > d.last) rows.push(['오늘 최고점', `${formatCH(d.peak)}`]);
  }
  const m = bust?.month;
  if (m?.lost > d.lost) rows.push([`이번 달 잃은 돈 · ${m.rounds}판`, `-${formatCH(m.lost)}`]);
  if (bust?.busts > 1) rows.push(['파산', m?.busts > 1 ? `이번 달 ${m.busts}번째 · 통산 ${bust.busts}번째` : `통산 ${bust.busts}번째`]);
  return { rows, total: ['최고점에서 날린 돈', `-${formatCH(d.peak)}`] };
}

const seenKey = () => `vegas:bust-seen:${playerId()}`;
const bailSeenKey = () => `vegas:bailout-seen:${playerId()}`;
const RECENT_MS = 60 * 60_000;

// True once per id: marks it seen so a later state (the lobby after the table) doesn't show it again.
function firstSight(key, item) {
  if (!item?.id || Date.now() - Date.parse(item.createdAt) > RECENT_MS) return false;
  try { if (localStorage.getItem(key) === item.id) return false; } catch {}
  remember(key, item.id);
  return true;
}

function worth(bust) {
  const amount = bustDay(bust).peak;
  const c = bust.comparisons?.find(x => x.price <= amount) || bust.comparisons?.[0];
  return c ? `${c.name} ${Math.max(1, Math.floor(amount / c.price))}개 값` : '';
}

// Shows the moment once per bust, right after the hand that caused it, then the 구제금융 that
// refilled the wallet (한서: money that appears by itself should say so). Tables call this with
// every server state too, so it shows at the table rather than on the way out.
export function maybeBust(state) {
  const bust = state?.latestBust, bail = state?.latestBailout;
  const showBust = firstSight(seenKey(), bust), showBail = firstSight(bailSeenKey(), bail);
  if (!showBust && !showBail) return;
  setTimeout(() => {
    if (showBust) bustMoment(bust, state.user?.nickname || '', showBail ? () => bailoutMoment(bail) : null);
    else bailoutMoment(bail);
  }, ms(1600));
}

// The moment itself: the wallet drains from the day's high to 0, the table shakes, and a receipt
// prints every way the money went (한서 2026-10-27: "파산할 때 좀 더 꼴받게"). Under it, the time
// played today and a way out for the night, so a bust never only says "again".
export function bustMoment(bust, nickname, then = null) {
  const node = el('div', 'bigwin bust');
  node.setAttribute('role', 'dialog');
  const d = bustDay(bust);
  const { rows, total } = bustLines(bust);
  node.setAttribute('aria-label', `파산. 최고점에서 ${formatMoney(d.peak)} 날렸어요`);
  const w = worth(bust);
  const played = playedToday();
  node.innerHTML = `
    <div class="bigwin-inner bust-inner">
      <span class="bust-mark" aria-hidden="true"></span>
      <p class="bigwin-sub">BANKRUPT</p>
      <h2 class="bigwin-title">파산</h2>
      <div class="bust-drain">
        <small>보유 칩</small>
        <strong class="bigwin-amount"><span data-amount>${formatCH(d.peak)}</span><small>원</small></strong>
      </div>
      ${dayChart(bust.today?.curve, { end: '0원', className: 'bust-chart' })}
      <dl class="bust-receipt">
        ${rows.map(([k, v]) => `<div class="bust-row"><dt>${k}</dt><dd class="${v.startsWith('-') ? 'is-down' : v.startsWith('+') ? 'is-up' : ''}">${v}</dd></div>`).join('')}
        <div class="bust-row bust-row--total"><dt>${total[0]}</dt><dd>${total[1]}<small>원</small></dd></div>
      </dl>
      <p class="bust-roast">“${stingFor(bust)}”</p>
      <p class="bust-note">${gameName(bust.game) || '테이블'}에서 바닥났어요.${w ? ` ${w}이에요.` : ''}</p>
      <div class="bust-actions-dock">
        <div class="bigwin-actions">
          <button type="button" class="pill-button pill-button--solid" data-share>동네방네 자랑하기</button>
          <button type="button" class="pill-button" data-close>다시 일어서기</button>
        </div>
        <button type="button" class="bust-quit" data-quit>오늘은 여기까지</button>
        <p class="bust-time">${played ? `오늘 ${played} 플레이 · ` : ''}가상 칩 · 현금 가치 없음</p>
      </div>
    </div>`;
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('is-open'));
  haptic([30, 30, 30, 30, 30]);
  const amount = node.querySelector('[data-amount]');
  const receipt = [...node.querySelectorAll('.bust-row')];
  // Drain, then the thud, then the receipt prints line by line.
  const drained = d.peak > 0 && !reducedMotion()
    ? (sound.drain?.(1.6), rollNumber(amount, d.peak, 0, { duration: 1600, format: formatCH }))
    : Promise.resolve(amount.textContent = '0');
  node.classList.add('is-draining');
  drained.then(() => {
    if (done) return;
    node.classList.add('is-empty');
    sound.thud?.();
    haptic([220, 70, 320]);
    receipt.forEach((row, i) => setTimeout(() => {
      if (done) return;
      row.classList.add('is-shown');
      sound.tick?.();
    }, ms(260 + i * 240)));
  });
  let done = false;
  const close = after => {
    if (done) return;
    done = true;
    removeEventListener('keydown', onKey, true);
    node.classList.remove('is-open');
    setTimeout(() => { node.remove(); after?.(); then?.(); }, ms(300));
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', () => close());
  node.querySelector('[data-quit]').addEventListener('click', () => close(() => dispatchEvent(new CustomEvent('vegas:leave-to', { detail: { surface: 'lobby' } }))));
  node.querySelector('[data-share]').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    await shareBust(bust, nickname).catch(() => {});
    e.currentTarget.disabled = false;
  });
  node.querySelector('[data-share]').focus({ preventScroll: true });
}

function playedToday() {
  try { const t = playtime.get().today; return t >= 60_000 ? duration(t) : ''; } catch { return ''; }
}

// The bank refilled an empty wallet: what came in, and how many of today's are left.
export function bailoutMoment(bail) {
  const node = el('div', 'bigwin bailout');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', `구제금융 +${formatMoney(bail.amount)}`);
  const left = bail.perDay ? Math.max(0, bail.perDay - bail.nth) : null;
  node.innerHTML = `
    <div class="bigwin-inner">
      <span class="bailout-mark" aria-hidden="true"></span>
      <p class="bigwin-sub">BAILOUT</p>
      <h2 class="bigwin-title">구제금융</h2>
      <strong class="bigwin-amount">+<span data-amount>0</span> <small>원</small></strong>
      <p class="bust-note">칩이 바닥나서 구제금융이 바로 들어왔어요.${left === null ? '' : left ? ` 오늘 ${left}번 더 받을 수 있어요.` : ' 오늘은 이게 마지막이에요.'}</p>
      <div class="bigwin-actions">
        <button type="button" class="pill-button pill-button--solid" data-close>다시 테이블로</button>
      </div>
    </div>`;
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('is-open'));
  sound.chips?.(6);
  haptic([40, 40, 40]);
  rollNumber(node.querySelector('[data-amount]'), 0, bail.amount, { duration: 1000, format: formatCH });
  const close = () => {
    removeEventListener('keydown', onKey, true);
    node.classList.remove('is-open');
    setTimeout(() => node.remove(), ms(300));
  };
  const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-close]').focus({ preventScroll: true });
}

export async function bustCard(bust, nickname = '') {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, H * 0.75);
  bg.addColorStop(0, '#2a1416'); bg.addColorStop(1, '#0a0b0d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,79,79,.35)'; ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);
  const logo = await loadLogo();
  if (logo) ctx.drawImage(logo, W / 2 - 150, 100, 300, 63);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff4f4f';
  ctx.font = '600 34px Archivo, sans-serif';
  ctx.fillText('B A N K R U P T', W / 2, 238);
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '700 150px "Noto Sans KR", Archivo, sans-serif';
  ctx.fillText('파산', W / 2, 390);
  const d = bustDay(bust);
  const { rows, total } = bustLines(bust);
  ctx.fillStyle = '#ff4f4f';
  ctx.font = '600 88px Archivo, "Noto Sans KR", sans-serif';
  ctx.fillText(`${total[1]}원`, W / 2, 500);
  ctx.fillStyle = '#b3b8bf';
  ctx.font = '500 34px "Noto Sans KR", sans-serif';
  ctx.fillText(`${nickname ? `${nickname}님이 ` : ''}${gameName(bust.game) || '테이블'}에서 최고점 ${formatCH(d.peak)}원을 다 날렸어요`, W / 2, 566, W - 160);
  const left = 160, right = W - 160;
  // The day's chips: white up to the high, red down to 0.
  const c = chartPoints(bust.today?.curve);
  let y = 610;
  if (c) {
    const top = 620, h = 170;
    const xy = c.xy.map(([x, yy]) => [left + x / 300 * (right - left), top + yy / 100 * h]);
    const fill = ctx.createLinearGradient(0, top, 0, top + h);
    fill.addColorStop(0, 'rgba(255,255,255,.10)'); fill.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); xy.forEach(([x, yy], i) => (i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy))); ctx.lineTo(right, top + h); ctx.lineTo(left, top + h); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const stroke = (from, to, color) => { ctx.beginPath(); xy.slice(from, to + 1).forEach(([x, yy], i) => (i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy))); ctx.strokeStyle = color; ctx.stroke(); };
    stroke(0, c.top, '#f4f5f7');
    if (c.top < xy.length - 1) stroke(c.top, xy.length - 1, '#ff4f4f');
    ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(...xy[c.top], 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff4f4f'; ctx.beginPath(); ctx.arc(...xy[xy.length - 1], 10, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 28px Archivo, "Noto Sans KR", sans-serif'; ctx.fillStyle = '#fff6dc';
    const [tx, ty] = xy[c.top];
    ctx.textAlign = tx > W * 0.65 ? 'right' : tx < W * 0.3 ? 'left' : 'center';
    ctx.fillText(`최고 ${formatCH(c.pts[c.top][1])}`, tx + (ctx.textAlign === 'left' ? -10 : ctx.textAlign === 'right' ? 10 : 0), Math.max(top - 6, ty - 22));
    y = top + h + 20;
  }
  // The receipt, two columns between thin rules.
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  ctx.font = '500 32px "Noto Sans KR", Archivo, sans-serif';
  for (const [k, v] of rows.slice(0, c ? 5 : 6)) {
    y += 52;
    ctx.textAlign = 'left'; ctx.fillStyle = '#9aa0a8'; ctx.fillText(k, left, y);
    ctx.textAlign = 'right'; ctx.fillStyle = v.startsWith('+') ? '#5fd39a' : v.startsWith('-') ? '#ff8a82' : '#f4f5f7'; ctx.fillText(v, right, y);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '600 42px "Noto Sans KR", sans-serif';
  ctx.fillText(`“${stingFor(bust)}”`, W / 2, Math.min(1180, y + 84), W - 140);
  ctx.fillStyle = '#7d838b';
  ctx.font = '400 32px "Noto Sans KR", sans-serif';
  const date = new Date(bust.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`${date} · 가상 칩 · 현금 가치 없음`, W / 2, 1262);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export async function shareBust(bust, nickname = '') {
  const blob = await bustCard(bust, nickname);
  return shareImage({ blob, filename: 'vegas-bankrupt.png', title: 'VEGAS 파산', text: `VEGAS에서 파산했어요. 최고점에서 -${formatCH(bustDay(bust).peak)}원. ${stingFor(bust)} 💸`, nickname });
}
