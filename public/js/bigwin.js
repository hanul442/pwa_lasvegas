// The big-win moment: the table dims, a star bursts, the payout rolls up while chips rain,
// and the phone shakes in your hand. From there the win can be saved or shared as a card.
import { el, sound, haptic, rollNumber, formatMoney, animate, ms, reducedMotion } from './fx.js';
import { createChip } from './chips.js';

const BRAGS = ['“오늘은 내가 하우스”', '“딜러가 울고 갔어요”', '“동네방네 자랑합니다”', '“이 맛에 앉아 있죠”'];
const RAIN = [50_000_000, 10_000_000, 30_000_000, 100_000_000, 20_000_000, 500_000_000, 70_000_000];

// Wins worth stopping the table for, unless a game names its own moment: 5x the stake, or
// 5억 or more however it was won (the same bar as the lounge feed's hot wins).
export const BIG_WIN_MULTIPLE = 5;
export const BIG_WIN_CHIPS = 500_000_000;

export function isBigWin(net, staked) {
  return net > 0 && ((staked > 0 && net >= staked * BIG_WIN_MULTIPLE) || net >= BIG_WIN_CHIPS);
}

function fanfare() {
  sound.win();
  setTimeout(() => sound.chips(8), 260);
  setTimeout(() => sound.win(), 700);
}

// title: the moment ("BLACKJACK", "광땡", "35×"); amount: chips won; game: shown on the share card.
export function bigWin({ title, amount, game = '', subtitle = '', nickname = '' }) {
  return new Promise(resolve => {
    const node = el('div', 'bigwin');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', `${title} ${formatMoney(amount)} 벌었어요`);
    node.innerHTML = `
      <div class="bigwin-rain" aria-hidden="true"></div>
      <div class="bigwin-inner">
        <span class="bigwin-star" aria-hidden="true"></span>
        <p class="bigwin-sub">${subtitle || 'BIG WIN'}</p>
        <h2 class="bigwin-title">${title}</h2>
        <strong class="bigwin-amount"><span data-amount>0원</span> <small>벌었어요</small></strong>
        <div class="bigwin-actions">
          <button type="button" class="pill-button pill-button--solid" data-share>동네방네 자랑하기</button>
          <button type="button" class="pill-button" data-close>계속</button>
        </div>
      </div>`;
    document.body.append(node);
    const rain = node.querySelector('.bigwin-rain');
    if (!reducedMotion()) {
      for (let i = 0; i < 26; i++) {
        const chip = createChip(RAIN[i % RAIN.length]);
        chip.style.left = `${Math.random() * 100}%`;
        chip.style.setProperty('--fall', `${ms(1600 + Math.random() * 1400)}ms`);
        chip.style.setProperty('--delay', `${ms(Math.random() * 900)}ms`);
        chip.style.setProperty('--spin', `${Math.random() > 0.5 ? '' : '-'}${360 + Math.floor(Math.random() * 540)}deg`);
        rain.append(chip);
      }
    }
    requestAnimationFrame(() => node.classList.add('is-open'));
    fanfare();
    haptic([40, 50, 40, 50, 120, 80, 200]);
    rollNumber(node.querySelector('[data-amount]'), 0, amount, { duration: 1400, format: formatMoney });
    animate(node.querySelector('.bigwin-title'), [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 650 });

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      removeEventListener('keydown', onKey, true);
      node.classList.remove('is-open');
      setTimeout(() => { node.remove(); resolve(); }, ms(300));
    };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); } };
    addEventListener('keydown', onKey, true);
    // It goes away on its own unless the player reaches for the share button.
    let timer = setTimeout(close, ms(4200) + 600);
    node.querySelector('[data-close]').addEventListener('click', close);
    node.querySelector('[data-share]').addEventListener('click', async e => {
      clearTimeout(timer);
      e.currentTarget.disabled = true;
      await shareWin({ title, amount, game, nickname }).catch(() => {});
      e.currentTarget.disabled = false;
    });
    node.querySelector('[data-share]').focus({ preventScroll: true });
  });
}

// ---------- share card ----------
let logoImage = null;
export function loadLogo() {
  if (logoImage) return logoImage;
  logoImage = new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'logo.svg';
  });
  return logoImage;
}

function star(ctx, x, y, r, color) {
  // The VEGAS four-point star, same proportions as --star-shape.
  const pts = [[0, -1], [0.2, -0.2], [1, 0], [0.2, 0.2], [0, 1], [-0.2, 0.2], [-1, 0], [-0.2, -0.2]];
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + px * r, y + py * r));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export async function winCard({ title, amount, game, nickname = '' }) {
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, H * 0.75);
  bg.addColorStop(0, '#1f242b'); bg.addColorStop(1, '#0a0b0d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);
  const logo = await loadLogo();
  if (logo) ctx.drawImage(logo, W / 2 - 180, 120, 360, 76);
  star(ctx, W / 2, 470, 90, '#fff6dc');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b3b8bf';
  ctx.font = '500 40px "Noto Sans KR", Archivo, sans-serif';
  ctx.fillText(game ? `${game} · BIG WIN` : 'BIG WIN', W / 2, 650);
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '700 128px Archivo, "Noto Sans KR", sans-serif';
  let size = 128;
  while (ctx.measureText(title).width > W - 180 && size > 60) { size -= 8; ctx.font = `700 ${size}px Archivo, "Noto Sans KR", sans-serif`; }
  ctx.fillText(title, W / 2, 800);
  ctx.fillStyle = '#fff6dc';
  const won = `${formatMoney(amount)} 벌었어요`;
  size = 96;
  ctx.font = `700 ${size}px Archivo, "Noto Sans KR", sans-serif`;
  while (ctx.measureText(won).width > W - 140 && size > 48) { size -= 6; ctx.font = `700 ${size}px Archivo, "Noto Sans KR", sans-serif`; }
  ctx.fillText(won, W / 2, 940);
  ctx.fillStyle = '#f4f5f7';
  ctx.font = '600 50px "Noto Sans KR", sans-serif';
  ctx.fillText(BRAGS[Math.floor(amount / 7) % BRAGS.length], W / 2, 1050);
  ctx.fillStyle = '#7d838b';
  ctx.font = '400 32px "Noto Sans KR", sans-serif';
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  ctx.fillText(`${nickname ? `${nickname} · ` : ''}${date}`, W / 2, 1150);
  ctx.fillText('가상 칩 · 현금 가치 없음', W / 2, 1210);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

export async function shareWin({ title, amount, game, nickname = '' }) {
  const blob = await winCard({ title, amount, game, nickname });
  if (!blob) return;
  const file = new File([blob], 'vegas-big-win.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'VEGAS 대박', text: `VEGAS에서 ${title}! ${formatMoney(amount)} 벌었어요` }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vegas-big-win.png';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
