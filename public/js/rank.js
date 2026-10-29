// 월간 랭크 시즌 on screen (lib/rank-season.mjs): the tier emblem, the lobby card that shows how
// far the next tier is, and a season-end moment for the badge just earned.
import { el, formatCH, sound, haptic } from './fx.js';
import { toast } from './notice.js';
import { bragButton } from './share.js';
import { bragTier } from './brags.js';

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
    <p class="lounge-note rank-note">매달 1일 0시에 칩·빚이 초기화되고 모두 Gold Room부터 다시 올라가요. 꾸미기·명패·배지·업적은 그대로예요.${r.best ? ` 내 최고 기록 ${tierName(r.best.tier)} (${r.best.name}).` : ''}</p>`;
  box.querySelector('.rank-card').addEventListener('click', () => { sound.tick(); onOpen?.(); });
  return box;
}

// Profile: one badge per month played, plus the 챌린저 podium.
export function rankBadges(history = []) {
  if (!history.length) return '';
  return `<ul class="rank-history">${history.map(h => `<li>${tierEmblem(h.tier, { size: 34 })}<span><b>${tierName(h.tier)}${h.rank && h.rank <= 3 ? ` · 챌린저 ${h.rank}위` : ''}</b><small>${h.name} · ${h.rank}위 / ${h.of}명 · 최고 ${formatCH(h.peak)}</small></span></li>`).join('')}</ul>`;
}

// ---------- the month's end ----------
// The last week of a season counts down on home; the last three days and the last day each open
// the warning once; at a table the last hour, ten minutes and minute come as toasts.
const DAY = 86_400_000;
export const seasonLeft = rs => (rs ? Math.max(0, Date.parse(rs.season.endsAt) - Date.now()) : Infinity);
export const seasonEnding = rs => seasonLeft(rs) <= 7 * DAY;
const pad = n => String(n).padStart(2, '0');
export function seasonClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), hms = `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  return d ? `${d}일 ${hms}` : hms;
}
const seasonShort = name => String(name || '').replace(' (프리시즌)', '');
const endDay = iso => new Date(Date.parse(iso)).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });

// Every [data-season-clock] on screen ticks down to its data-ends.
setInterval(() => {
  document.querySelectorAll('[data-season-clock]').forEach(n => { n.textContent = seasonClock(Date.parse(n.dataset.ends) - Date.now()); });
}, 1000);

const RESETS = ['칩 (테이블 위 칩 포함)', '빚과 대출', '열린 층과 입장권'];
const KEEPS = ['꾸미기와 명패', '배지와 업적', '게임 기록', '이번 달 티어 배지'];

// The warning sheet: the clock, where I stand, and what goes and what stays.
export function seasonEndBlock(state, { onShop, onBoard, onWrapped } = {}) {
  const r = state.rankSeason;
  if (!r) return null;
  const box = el('section', 'season-end');
  const nextLine = r.next ? `${tierName(r.next.id)}까지 ${formatCH(r.next.need)}` : '최고 티어예요';
  box.innerHTML = `
    <span class="season-end-kicker">${seasonShort(r.season.name)} 마감${r.season.preseason ? ' · 첫 초기화' : ''}</span>
    <h2>시즌 초기화까지</h2>
    <p class="season-end-clock" data-season-clock data-ends="${r.season.endsAt}" role="timer">${seasonClock(seasonLeft(r))}</p>
    <p class="season-end-when">${endDay(r.season.endsAt)} 0시 (한국 시간)</p>
    <button type="button" class="season-end-me" data-board>${tierEmblem(r.tier, { size: 44 })}<span><b>지금 ${tierName(r.tier)}</b><small>이번 달 최고 순자산 ${formatCH(r.peak)} · ${nextLine}</small></span></button>
    <div class="season-end-lists">
      <div><h3>초기화돼요</h3><ul>${RESETS.map(x => `<li>${x}</li>`).join('')}</ul></div>
      <div><h3>그대로 남아요</h3><ul class="is-keep">${KEEPS.map(x => `<li>${x}</li>`).join('')}</ul></div>
    </div>
    <p class="season-end-tip">티어는 이번 달에 찍은 최고 순자산으로 정해져서, 마지막에 잃어도 내려가지 않아요. 칩은 사라지지만 꾸미기는 남아요.</p>
    <div class="season-end-actions">${state.wrapped?.live && onWrapped ? '<button type="button" class="pill-button pill-button--solid" data-wrapped>이번 달 결산 미리 보기</button>' : ''}<button type="button" class="pill-button" data-shop>상점 보기</button></div>`;
  box.querySelector('[data-wrapped]')?.addEventListener('click', () => { sound.tick(); onWrapped(state.wrapped.live); });
  box.querySelector('[data-shop]').addEventListener('click', () => { sound.tick(); onShop?.(); });
  box.querySelector('[data-board]').addEventListener('click', () => { sound.tick(); onBoard?.(); });
  return box;
}

// Opens the warning once when three days are left and once more on the last day.
export function maybeSeasonWarning(state, open) {
  const r = state.rankSeason;
  if (!r || !state.user) return;
  const left = seasonLeft(r);
  const stage = left <= DAY ? 'day' : left <= 3 * DAY ? 'three' : null;
  if (!stage) return;
  const key = `vegas:season-warn:${r.season.id}:${stage}:${state.user.id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
  open();
}

// At a table (or anywhere) the last hour, ten minutes and minute are called out.
const CALLS = [[60, '시즌 초기화까지 1시간 남았어요. 자정에 칩·빚이 정리돼요.'], [10, '시즌 초기화까지 10분! 테이블에 걸린 칩도 함께 정리돼요.'], [1, '1분 뒤 시즌 초기화예요.']];
const called = new Set();
export function watchSeasonEnd(getState) {
  setInterval(() => {
    const r = getState()?.rankSeason;
    if (!r) return;
    const min = seasonLeft(r) / 60_000;
    for (const [at, text] of CALLS) {
      const key = `${r.season.id}:${at}`;
      if (min <= at && min > at - 1.5 && !called.has(key)) { called.add(key); toast(text, { duration: 6000 }); }
    }
  }, 15_000);
}

// Once per season, the first look after it closed: the badge I earned, the podium, and what the
// fresh start cleared. Also opens on demand from the tier board.
export function maybeSeasonMoment(state, { force = false, onWrapped } = {}) {
  const last = state.rankSeason?.last;
  if (!last || !state.user) return;
  const { mine, reset } = last;
  if (!force && !mine && !reset) return;
  const key = `vegas:rank-moment:${last.id || mine?.season}:${state.user.id}`;
  if (!force) { try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; } }
  const node = el('div', 'floor-moment rank-moment');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', `${seasonShort(last.name)} 결과`);
  // VEGAS 랩드 for the month just closed (js/wrapped.js), when this player played it.
  const wrapped = onWrapped ? (state.wrapped?.history || []).find(h => h.season === last.id && h.rounds) : null;
  const podium = (last.podium || []).map(p => `<li${p.userId === state.user.id ? ' class="is-me"' : ''}><span class="rank-moment-place">${p.rank}</span>${tierEmblem(p.tier, { size: 24, label: false })}<b>${p.nickname}</b><small>${formatCH(p.peak)}</small></li>`).join('');
  const cleared = reset ? [reset.chips ? `칩 ${formatCH(reset.chips)}` : '', reset.loans ? `대출 ${reset.loans}건` : ''].filter(Boolean).join(' · ') : '';
  node.innerHTML = `<div class="floor-moment-inner">
    ${mine ? tierEmblem(mine.tier, { size: 84 }) : ''}
    <p>${seasonShort(last.name)} 결과</p>
    <h2>${mine ? tierName(mine.tier) : '새 시즌'}</h2>${mine && mine.rank <= 3 ? `<span class="rank-moment-champ">챌린저 ${mine.rank}위</span>` : ''}
    ${mine ? `<small>${mine.of}명 중 ${mine.rank}위 · 최고 순자산 ${formatCH(mine.peak)}</small>` : ''}
    ${podium ? `<ol class="rank-moment-podium" aria-label="챌린저">${podium}</ol>` : ''}
    <p class="rank-moment-reset">${cleared ? `정리된 것 ${cleared}<br>` : ''}꾸미기·명패·배지·업적은 그대로예요. Gold Room부터 다시 올라가요.</p>
    <div class="rank-moment-actions moment-actions">${wrapped ? `<button type="button" class="pill-button pill-button--solid" data-wrapped>${seasonShort(last.name)} 결산 카드 보기</button>` : ''}
    <button type="button" class="pill-button${wrapped ? '' : ' pill-button--solid'}" data-close>${force ? '닫기' : '새 시즌 시작'}</button></div></div>`;
  document.body.append(node);
  if (!force) sound.win();
  requestAnimationFrame(() => node.classList.add('is-open'));
  const close = () => { node.classList.remove('is-open'); setTimeout(() => node.remove(), 400); removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-wrapped]')?.addEventListener('click', () => { close(); onWrapped(wrapped); });
  if (mine) {
    const brag = bragButton(() => bragTier({ tier: mine.tier, name: tierName(mine.tier), season: seasonShort(last.name), rank: mine.rank, of: mine.of, peak: mine.peak }), '티어 자랑하기');
    if (wrapped) { brag.classList.remove('pill-button--solid'); node.querySelector('[data-wrapped]').after(brag); }
    else { node.querySelector('[data-close]').classList.remove('pill-button--solid'); node.querySelector('.moment-actions').prepend(brag); }
  }
  node.querySelector('.moment-actions button').focus({ preventScroll: true });
}

// Mid-month, climbing a tier stops the screen for a beat (once per tier, per device) with a card
// to brag with. The first look of a month only remembers where the player stands.
export function celebrateTier(state) {
  const r = state?.rankSeason;
  if (!r?.tier || !state.user) return;
  const order = Object.keys(TIERS);
  const now = order.indexOf(r.tier);
  const key = `vegas:tier-seen:${r.season.id}:${state.user.id}`;
  let seen = null;
  try { seen = localStorage.getItem(key); localStorage.setItem(key, r.tier); } catch { return; }
  if (seen === null || order.indexOf(seen) < 0 || now <= order.indexOf(seen) || now <= 0) return;
  const node = el('div', 'floor-moment rank-moment tier-up');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', `${tierName(r.tier)} 승급`);
  node.innerHTML = `<div class="floor-moment-inner">${tierEmblem(r.tier, { size: 96 })}<p>티어 승급</p><h2>${tierName(r.tier)}</h2>
    <small>이번 달 최고 순자산 ${formatCH(r.peak)}${r.next ? ` · 다음 ${tierName(r.next.id)}까지 ${formatCH(r.next.need)}` : ' · 최고 티어'}</small>
    <div class="moment-actions"><button type="button" class="pill-button" data-close>계속</button></div></div>`;
  document.body.append(node);
  sound.win(); haptic([30, 50, 30, 50, 120]);
  requestAnimationFrame(() => node.classList.add('is-open'));
  const close = () => { clearTimeout(timer); node.classList.remove('is-open'); setTimeout(() => node.remove(), 400); };
  const brag = bragButton(async () => { clearTimeout(timer); await bragTier({ tier: r.tier, name: tierName(r.tier), season: seasonShort(r.season.name), peak: r.peak, up: true }); });
  node.querySelector('.moment-actions').prepend(brag);
  node.querySelector('[data-close]').addEventListener('click', close);
  brag.focus({ preventScroll: true });
  const timer = setTimeout(close, 7000);
}
