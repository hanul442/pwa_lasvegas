// RP 팝업 (2026-10-29, 한서 "티어 RP 올라갔으면 팝업으로"): after a round moves RP, a small card
// slides in under the top bar with the change, where I stand and the step ahead. A new division or
// tier makes it bigger. It never blocks the table (no buttons, pointer-events off) and stays quiet
// for a newcomer's first hands (js/first-day.js). The full tier-up moment stays in the lobby
// (js/rank.js celebrateTier).
import { el, sound, haptic } from './fx.js';
import { tierName, tierEmblem, TIERS } from './rank.js';

const ORDER = Object.keys(TIERS), DIVS = ['IV', 'III', 'II', 'I'];
const rankOf = r => ORDER.indexOf(r.tier) * 10 + (r.division ? DIVS.indexOf(r.division) : 9);
const signed = x => `${x > 0 ? '+' : ''}${Math.round(x * 10) / 10}`;
let seen = null, node = null, timer = 0;

export function noteRpChange(state, { quiet = false } = {}) {
  const rp = state?.rp, last = rp?.last;
  if (!rp?.era || !state.user) return;
  const now = { key: `${state.user.id}:${rp.season}:${last?.at || ''}`, tier: rp.tier, division: rp.division };
  const prev = seen;
  seen = now;
  // The first state after a load only sets the mark; the same round never shows twice.
  if (!prev || prev.key === now.key || !last?.delta || quiet) return;
  if (!prev.key.startsWith(`${state.user.id}:${rp.season}:`)) return;
  const up = rankOf(now) > rankOf(prev), down = rankOf(now) < rankOf(prev), tierUp = up && now.tier !== prev.tier;
  const promo = state.promo?.active;
  const lines = [
    `<b class="rp-pop-delta ${last.delta > 0 ? 'pos' : 'neg'}">${signed(last.delta)} RP</b>`,
    `<span class="rp-pop-tier">${tierUp ? '티어 승급 · ' : up ? '승급 · ' : down ? '강등 · ' : ''}${tierName(rp.tier, rp.division)} <small>${rp.points} RP</small></span>`,
    `<small class="rp-pop-next">${promo ? `승급전 ${promo.wins}승 ${promo.losses}패` : rp.next ? `${tierName(rp.next, rp.nextDivision)}까지 ${rp.toNext} RP` : '최고 티어'}</small>`
  ];
  show(`${tierEmblem(rp.tier, { size: up ? 34 : 26, label: false })}<span class="rp-pop-text">${lines.join('')}</span>`, { big: up, down });
  if (up) { sound.chip?.(); haptic?.(tierUp ? [20, 40, 20, 40, 60] : [14, 30, 14]); }
}

function show(html, { big, down }) {
  clearTimeout(timer);
  node?.remove();
  node = el('div', `rp-pop${big ? ' is-big' : ''}${down ? ' is-down' : ''}`);
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.innerHTML = html;
  document.body.append(node);
  const mine = node;
  requestAnimationFrame(() => mine.classList.add('is-shown'));
  timer = setTimeout(() => { mine.classList.remove('is-shown'); setTimeout(() => mine.remove(), 300); if (node === mine) node = null; }, big ? 3600 : 2400);
}
