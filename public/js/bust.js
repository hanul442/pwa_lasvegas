// Going bust is news too: the screen goes dark, the loss rolls up in red, and the player gets a
// card to brag about it ("동네방네 자랑하기"). Everyone else already hears it through the lounge
// feed, the top banner and a push notification (lib/news.mjs).
import { el, sound, haptic, rollNumber, formatCH, formatFull, ms } from './fx.js';
import { playerId } from './api.js';
import { gameName } from './lounge.js';
import { loadLogo, shareImage } from './share.js';

const ROASTS = [
  '카지노는 이겼고, 나는 졌다',
  '전 재산 탕진 인증합니다',
  '지갑이 텅 비었어요. 위로는 칩으로 받습니다',
  '오늘의 교훈: 그만둘 때를 알자',
  '딜러가 고맙다고 인사했어요',
  '이 정도면 VIP 대접 받아야 해요'
];
const roastFor = id => ROASTS[[...String(id)].reduce((n, c) => n + c.charCodeAt(0), 0) % ROASTS.length];

const seenKey = () => `vegas:bust-seen:${playerId()}`;
const bailSeenKey = () => `vegas:bailout-seen:${playerId()}`;
const RECENT_MS = 60 * 60_000;

// True once per id: marks it seen so a later state (the lobby after the table) doesn't show it again.
function firstSight(key, item) {
  if (!item?.id || Date.now() - Date.parse(item.createdAt) > RECENT_MS) return false;
  try { if (localStorage.getItem(key) === item.id) return false; localStorage.setItem(key, item.id); } catch {}
  return true;
}

function worth(bust) {
  const c = bust.comparisons?.[0];
  return c ? `${c.name} ${c.count}개 값` : '';
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

export function bustMoment(bust, nickname, then = null) {
  const node = el('div', 'bigwin bust');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', `파산 -${formatFull(bust.sessionLoss)}원`);
  const w = worth(bust);
  node.innerHTML = `
    <div class="bigwin-inner">
      <span class="bust-mark" aria-hidden="true"></span>
      <p class="bigwin-sub">BANKRUPT</p>
      <h2 class="bigwin-title">파산</h2>
      <strong class="bigwin-amount bust-amount">-<span data-amount>0</span> <small>원</small></strong>
      <p class="bust-note">${gameName(bust.game) || '테이블'}에서 전 재산을 날렸어요.${w ? ` ${w}이에요.` : ''}</p>
      <p class="bust-roast">“${roastFor(bust.id)}”</p>
      <div class="bigwin-actions">
        <button type="button" class="pill-button pill-button--solid" data-share>동네방네 자랑하기</button>
        <button type="button" class="pill-button" data-close>다시 일어서기</button>
      </div>
    </div>`;
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('is-open'));
  sound.lose?.();
  haptic([200, 80, 200]);
  rollNumber(node.querySelector('[data-amount]'), 0, bust.sessionLoss, { duration: 1200, format: formatCH });
  const close = () => {
    removeEventListener('keydown', onKey, true);
    node.classList.remove('is-open');
    setTimeout(() => { node.remove(); then?.(); }, ms(300));
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-share]').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    await shareBust(bust, nickname).catch(() => {});
    e.currentTarget.disabled = false;
  });
  node.querySelector('[data-share]').focus({ preventScroll: true });
}

// The bank refilled an empty wallet: what came in, and how many of today's are left.
export function bailoutMoment(bail) {
  const node = el('div', 'bigwin bailout');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', `구제금융 +${formatFull(bail.amount)}원`);
  const left = bail.perDay ? Math.max(0, bail.perDay - bail.nth) : null;
  node.innerHTML = `
    <div class="bigwin-inner">
      <span class="bailout-mark" aria-hidden="true"></span>
      <p class="bigwin-sub">BAILOUT</p>
      <h2 class="bigwin-title">구제금융</h2>
      <strong class="bigwin-amount">+<span data-amount>0</span> <small>원</small></strong>
      <p class="bust-note">칩이 바닥나서 은행이 바로 채워 줬어요.${left === null ? '' : left ? ` 오늘 ${left}번 더 받을 수 있어요.` : ' 오늘은 이게 마지막이에요.'}</p>
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
  if (logo) ctx.drawImage(logo, W / 2 - 180, 120, 360, 76);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff4f4f';
  ctx.font = '600 40px Archivo, sans-serif';
  ctx.fillText('B A N K R U P T', W / 2, 330);
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '700 230px "Noto Sans KR", Archivo, sans-serif';
  ctx.fillText('파산', W / 2, 580);
  ctx.fillStyle = '#ff4f4f';
  ctx.font = '600 104px Archivo, "Noto Sans KR", sans-serif';
  ctx.fillText(`-${formatCH(bust.sessionLoss)}원`, W / 2, 730);
  ctx.fillStyle = '#b3b8bf';
  ctx.font = '500 42px "Noto Sans KR", sans-serif';
  ctx.fillText(`${nickname ? `${nickname}님이 ` : ''}${gameName(bust.game) || '테이블'}에서 전 재산을 날렸어요`, W / 2, 830);
  const w = worth(bust);
  if (w) ctx.fillText(`${w}이에요`, W / 2, 895);
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '600 50px "Noto Sans KR", sans-serif';
  ctx.fillText(`“${roastFor(bust.id)}”`, W / 2, 1020);
  ctx.fillStyle = '#7d838b';
  ctx.font = '400 32px "Noto Sans KR", sans-serif';
  const date = new Date(bust.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(date, W / 2, 1150);
  ctx.fillText('가상 칩 · 현금 가치 없음', W / 2, 1210);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export async function shareBust(bust, nickname = '') {
  const blob = await bustCard(bust, nickname);
  return shareImage({ blob, filename: 'vegas-bankrupt.png', title: 'VEGAS 파산', text: `VEGAS에서 파산했어요. -${formatCH(bust.sessionLoss)}원. ${roastFor(bust.id)} 💸`, nickname });
}
