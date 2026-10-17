// 월간 랭크 시즌 on screen (lib/rank-season.mjs): the tier emblem, the lobby card that shows how
// far the next tier is, and a season-end moment for the badge just earned.
import { el, formatCH, sound } from './fx.js';

export const TIERS = {
  iron: { name: '아이언', min: 0, label: '시작' },
  bronze: { name: '브론즈', min: 1e8, label: '1억' },
  silver: { name: '실버', min: 1e9, label: '10억' },
  gold: { name: '골드', min: 1e10, label: '100억' },
  platinum: { name: '플래티넘', min: 1e11, label: '1천억' },
  emerald: { name: '에메랄드', min: 5e11, label: '5천억' },
  diamond: { name: '다이아몬드', min: 1e12, label: '1조' },
  master: { name: '마스터', min: 1e13, label: '10조' },
  grandmaster: { name: '그랜드마스터', min: 5e13, label: '50조' },
  legend: { name: '레전드', min: 1e14, label: '100조' }
};
export const tierName = id => TIERS[id]?.name || id;

// A faceted hexagon in the tier's metal; higher tiers add a cut and a star.
export function tierEmblem(id, { size = 40, label = true } = {}) {
  const t = TIERS[id] ? id : 'iron';
  const rank = Object.keys(TIERS).indexOf(t);
  const star = rank >= 6 ? '<path class="tier-star" d="M24 15.5l2.3 4.8 5.2.6-3.9 3.6 1 5.2-4.6-2.6-4.6 2.6 1-5.2-3.9-3.6 5.2-.6z"/>' : '';
  const cut = rank >= 3 ? '<path class="tier-cut" d="M24 9.5 36.5 16.7v14.6L24 38.5 11.5 31.3V16.7z"/>' : '';
  return `<svg class="tier-emblem tier-emblem--${t}" width="${size}" height="${size}" viewBox="0 0 48 48" ${label ? `role="img" aria-label="${tierName(t)}"` : 'aria-hidden="true"'}><path class="tier-face" d="M24 3 42.2 13.5v21L24 45 5.8 34.5v-21z"/>${cut}<path class="tier-shine" d="M24 3 42.2 13.5 24 24 5.8 13.5z"/>${star}</svg>`;
}

const daysLeft = iso => Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 86_400_000));

// The lobby card: my tier, the climb to the next one, and when the month resets.
export function rankBlock(state, onOpen) {
  const r = state.rankSeason;
  if (!r) return null;
  const box = el('section', 'lounge-block rank-block');
  const days = daysLeft(r.season.endsAt);
  const nextLine = r.next ? `${tierName(r.next.id)}까지 ${formatCH(r.next.need)}` : '최고 티어예요';
  box.innerHTML = `
    <header class="lounge-head"><h2>${r.season.name}</h2><small>${days ? `${days}일 남음` : '오늘 끝나요'}</small></header>
    <button type="button" class="rank-card rank-card--${r.tier}">
      ${tierEmblem(r.tier, { size: 52 })}
      <span class="rank-card-text"><b>${tierName(r.tier)}</b><small>이번 달 최고 순자산 ${formatCH(r.peak)} · ${nextLine}</small>
        <span class="rank-bar" aria-hidden="true"><i style="width:${Math.round(r.progress * 100)}%"></i></span></span>
      <span class="rank-card-go" aria-hidden="true">→</span>
    </button>
    <p class="lounge-note rank-note">매달 1일 0시에 칩·사치품·빚이 초기화되고 모두 Gold Room부터 다시 올라가요. 꾸미기·명패·배지·업적은 그대로예요.${r.best ? ` 내 최고 기록 ${tierName(r.best.tier)} (${r.best.name}).` : ''}</p>`;
  box.querySelector('.rank-card').addEventListener('click', () => { sound.tick(); onOpen?.(); });
  return box;
}

// Profile: one badge per month played, plus the 챌린저 podium.
export function rankBadges(history = []) {
  if (!history.length) return '';
  return `<ul class="rank-history">${history.map(h => `<li>${tierEmblem(h.tier, { size: 34 })}<span><b>${tierName(h.tier)}${h.rank && h.rank <= 3 ? ` · 챌린저 ${h.rank}위` : ''}</b><small>${h.name} · ${h.rank}위 / ${h.of}명 · 최고 ${formatCH(h.peak)}</small></span></li>`).join('')}</ul>`;
}

// Once per season, the first look after it closed: the badge I earned.
export function maybeSeasonMoment(state) {
  const mine = state.rankSeason?.last?.mine;
  if (!mine || mine.season !== state.rankSeason.history?.[0]?.season) return;
  const key = `vegas:rank-moment:${mine.season}:${state.user.id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  const node = el('div', 'floor-moment rank-moment');
  node.setAttribute('role', 'status');
  node.innerHTML = `<div class="floor-moment-inner">${tierEmblem(mine.tier, { size: 84 })}<p>${mine.name} 결과</p><h2>${tierName(mine.tier)}${mine.rank <= 3 ? ` · 챌린저 ${mine.rank}위` : ''}</h2><small>${mine.of}명 중 ${mine.rank}위 · 최고 순자산 ${formatCH(mine.peak)}<br>새 시즌이 시작됐어요. Gold Room부터 다시 올라가요.</small><button type="button" class="pill-button pill-button--solid">새 시즌 시작</button></div>`;
  document.body.append(node);
  sound.win();
  requestAnimationFrame(() => node.classList.add('is-open'));
  const close = () => { node.classList.remove('is-open'); setTimeout(() => node.remove(), 400); };
  node.querySelector('button').addEventListener('click', close);
  node.querySelector('button').focus({ preventScroll: true });
}
