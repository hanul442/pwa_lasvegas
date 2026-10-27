// The big-win moment: the table dims, a star bursts, the payout rolls up while chips rain,
// and the phone shakes in your hand. From there the win can be saved or shared as a card.
import { el, sound, haptic, rollNumber, formatMoney, animate, ms, reducedMotion } from './fx.js';
import { createChip } from './chips.js';
import { loadLogo, drawStar as star, shareImage } from './share.js';

const BRAGS = ['“오늘은 내가 하우스”', '“딜러가 울고 갔어요”', '“동네방네 자랑합니다”', '“이 맛에 앉아 있죠”'];
const RAIN = [50_000_000, 10_000_000, 20_000_000, 100_000_000, 20_000_000, 500_000_000, 1_000_000_000];

// Wins worth stopping the table for, measured in the table's minimum bet (its maximum is 10×), so
// the bar rises with the floor: 5억 was every other hand at a 100억 table. 한서 (2026-10-27): "많이
// 땄을 때 뜨는 거 금액대를 올려". A win also has to be at least double what was on the felt, so
// a full-felt even-money win never counts however large.
export const BIG_WIN_LEVELS = [
  { at: 300, level: 3, label: 'MEGA WIN' },
  { at: 100, level: 2, label: 'HUGE WIN' },
  { at: 25, level: 1, label: 'BIG WIN' }
];
export const BIG_WIN_MULTIPLE = 2;
// A named moment (BLACKJACK, 광땡, 포카드) stops the table only when it paid a max bet's worth.
export const NAMED_WIN_MIN = 10;

export function bigWinLevel(net, staked, min) {
  if (!(net > 0) || !(min > 0)) return 0;
  if (staked > 0 && net < staked * BIG_WIN_MULTIPLE) return 0;
  return BIG_WIN_LEVELS.find(l => net >= l.at * min)?.level || 0;
}
export const isBigWin = (net, staked, min) => bigWinLevel(net, staked, min) > 0;
export const namedWinCounts = (net, min) => net > 0 && (!(min > 0) || net >= NAMED_WIN_MIN * min);
const levelOf = level => BIG_WIN_LEVELS.find(l => l.level === level) || BIG_WIN_LEVELS[BIG_WIN_LEVELS.length - 1];

function fanfare(level) {
  sound.win();
  setTimeout(() => sound.chips(8), 260);
  setTimeout(() => sound.win(), 700);
  if (level >= 2) { setTimeout(() => sound.chips(10), 1100); setTimeout(() => sound.win(), 1500); }
  if (level >= 3) setTimeout(() => sound.bugle?.(), 1900);
}

// title: the moment ("BLACKJACK", "광땡", "35×"); amount: chips won; game: shown on the share card.
export function bigWin({ title, amount, game = '', subtitle = '', nickname = '', level = 1, multiple = 0 }) {
  const tier = levelOf(level);
  return new Promise(resolve => {
    const node = el('div', `bigwin bigwin--l${tier.level}`);
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', `${tier.label} ${title} ${formatMoney(amount)} 벌었어요`);
    node.innerHTML = `
      <div class="bigwin-rain" aria-hidden="true"></div>
      <div class="bigwin-inner">
        <span class="bigwin-star" aria-hidden="true"></span>
        <p class="bigwin-sub">${tier.label}${subtitle ? ` · ${subtitle}` : ''}</p>
        <h2 class="bigwin-title">${title}</h2>
        <strong class="bigwin-amount"><span data-amount>0원</span> <small>벌었어요</small></strong>
        ${multiple >= 2 ? `<p class="bigwin-multiple">판돈의 ${multiple}배</p>` : ''}
        <div class="bigwin-actions">
          <button type="button" class="pill-button pill-button--solid" data-share>동네방네 자랑하기</button>
          <button type="button" class="pill-button" data-close>계속</button>
        </div>
      </div>`;
    document.body.append(node);
    const rain = node.querySelector('.bigwin-rain');
    if (!reducedMotion()) {
      for (let i = 0; i < 18 + tier.level * 14; i++) {
        const chip = createChip(RAIN[i % RAIN.length]);
        chip.style.left = `${Math.random() * 100}%`;
        chip.style.setProperty('--fall', `${ms(1600 + Math.random() * 1400)}ms`);
        chip.style.setProperty('--delay', `${ms(Math.random() * 900)}ms`);
        chip.style.setProperty('--spin', `${Math.random() > 0.5 ? '' : '-'}${360 + Math.floor(Math.random() * 540)}deg`);
        rain.append(chip);
      }
    }
    requestAnimationFrame(() => node.classList.add('is-open'));
    fanfare(tier.level);
    haptic(tier.level >= 3 ? [60, 40, 60, 40, 60, 40, 160, 80, 320] : tier.level === 2 ? [40, 50, 40, 50, 120, 80, 260] : [40, 50, 40, 50, 120, 80, 200]);
    rollNumber(node.querySelector('[data-amount]'), 0, amount, { duration: 1000 + tier.level * 500, format: formatMoney });
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
    const onKey = e => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.target.closest?.('[data-share]'))) { e.preventDefault(); e.stopPropagation(); close(); } };
    addEventListener('keydown', onKey, true);
    // It goes away on its own unless the player reaches for the share button.
    let timer = setTimeout(close, ms(3600 + tier.level * 900) + 600);
    node.querySelector('[data-close]').addEventListener('click', close);
    node.querySelector('[data-share]').addEventListener('click', async e => {
      clearTimeout(timer);
      e.currentTarget.disabled = true;
      await shareWin({ title, amount, game, nickname, label: tier.label }).catch(() => {});
      e.currentTarget.disabled = false;
    });
    node.querySelector('[data-share]').focus({ preventScroll: true });
  });
}

// ---------- share card ----------
export { loadLogo };

export async function winCard({ title, amount, game, nickname = '', label = 'BIG WIN' }) {
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
  ctx.fillText(game ? `${game} · ${label}` : label, W / 2, 650);
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

export async function shareWin({ title, amount, game, nickname = '', label }) {
  const blob = await winCard({ title, amount, game, nickname, label });
  return shareImage({ blob, filename: 'vegas-big-win.png', title: 'VEGAS 대박', text: `VEGAS ${game ? `${game}에서 ` : ''}${title}! ${formatMoney(amount)} 벌었어요 🎰`, nickname });
}
