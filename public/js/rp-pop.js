// RP 팝업 (2026-10-29, 한서 "티어 RP 올라갔으면 팝업으로"): after a round moves RP, a small card
// slides in under the top bar with the change, where I stand and the step ahead. It never blocks
// the table (no buttons, pointer-events off) and stays quiet for a newcomer's first hands
// (js/first-day.js). The full tier-up moment stays in the lobby (js/rank.js celebrateTier).
// 2026-10-30 한서 "촤라락 올라가는 숫자" + "승급하면 특별한 모션": the RP change and my points roll,
// the bar fills, and a promotion fills the bar to the end, then flips the emblem to the new one
// with a ring, sparks and a gold sweep (bigger for a new tier).
import { el, sound, haptic, rollNumber, reducedMotion, ms } from './fx.js';
import { tierName, tierEmblem, TIERS } from './rank.js';

const ORDER = Object.keys(TIERS), DIVS = ['V', 'IV', 'III', 'II', 'I'];
const rankOf = r => ORDER.indexOf(r.tier) * 10 + (r.division ? DIVS.indexOf(r.division) : 9);
const tenthOf = x => Math.round(x); // RP is whole points since 2026-10-30
const signed = x => `${x > 0 ? '+' : ''}${tenthOf(x)}`;
const pct = x => `${Math.round(Math.max(0, Math.min(1, x || 0)) * 100)}%`;
const ROLL = 900, SWAP_AT = 1000;
let seen = null, node = null, timer = 0;

export function noteRpChange(state, { quiet = false } = {}) {
  const rp = state?.rp, last = rp?.last;
  if (!rp?.era || !state.user) return;
  const now = { key: `${state.user.id}:${rp.season}:${last?.at || ''}`, tier: rp.tier, division: rp.division, points: rp.points, progress: rp.progress };
  const prev = seen;
  seen = now;
  // The first state after a load only sets the mark; the same round never shows twice.
  if (!prev || prev.key === now.key || !last?.delta || quiet) return;
  if (!prev.key.startsWith(`${state.user.id}:${rp.season}:`)) return;
  const up = rankOf(now) > rankOf(prev), down = rankOf(now) < rankOf(prev), tierUp = up && now.tier !== prev.tier;
  const promo = state.promo?.active;
  const from = Number.isFinite(prev.points) ? prev.points : tenthOf(rp.points - last.delta);
  const nextLine = promo ? `승급전 ${promo.wins}승 ${promo.losses}패` : rp.next ? (rp.nextPromo ? `승급전 2승이면 ${tierName(rp.next, rp.nextDivision)}` : `${tierName(rp.next, rp.nextDivision)}까지 ${rp.toNext} RP`) : '최고 티어';
  const label = tierUp ? '티어 승급!' : up ? '승급!' : down ? '강등 · ' : '';
  const motion = !reducedMotion();
  // A promotion opens on where I was, then turns over to where I am.
  const startTier = up && motion ? prev : now;
  const said = `${signed(last.delta)} RP, ${label}${tierName(rp.tier, rp.division)} ${rp.points} RP`;
  // Screen readers get the end result once; the rolling numbers are for the eye.
  const html = `<span class="sr-only">${said}</span><span class="rp-pop-emblem" aria-hidden="true">${tierEmblem(startTier.tier, { size: up ? 36 : 26, label: false })}${up ? '<i class="rp-pop-ring"></i><i class="rp-pop-sparks">' + '<b></b>'.repeat(8) + '</i>' : ''}</span>
    <span class="rp-pop-text" aria-hidden="true">
      <b class="rp-pop-delta ${last.delta > 0 ? 'pos' : 'neg'}">${motion ? (last.delta > 0 ? '+0' : '-0') : signed(last.delta)} RP</b>
      <span class="rp-pop-tier"><em class="rp-pop-label">${up && motion ? '' : label}</em><span class="rp-pop-name">${tierName(startTier.tier, startTier.division)}</span></span>
      <span class="rp-pop-bar" aria-hidden="true"><i style="width:${pct(motion ? prev.progress ?? rp.progress : rp.progress)}"></i></span>
      <small class="rp-pop-next"><b class="rp-pop-points">${tenthOf(motion ? from : rp.points)}</b> RP<span class="rp-pop-step"> · ${nextLine}</span></small>
    </span>`;
  const card = show(html, { big: up, down, tierUp, long: up ? 4200 : 2800 });
  if (!motion) { if (up) promoted(card, { tierUp }); return; }

  const bar = card.querySelector('.rp-pop-bar i');
  rollNumber(card.querySelector('.rp-pop-delta'), 0, Math.round(last.delta), { duration: ROLL, format: v => `${signed(v)} RP` });
  rollNumber(card.querySelector('.rp-pop-points'), Math.round(from), Math.round(rp.points), { duration: ROLL, format: v => `${v}` });
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = up ? '100%' : down ? '0%' : pct(rp.progress); }));
  if (down) setTimeout(() => { bar.style.transition = 'none'; bar.style.width = '100%'; requestAnimationFrame(() => { bar.style.transition = ''; bar.style.width = pct(rp.progress); }); }, ms(ROLL));
  if (!up) return;
  setTimeout(() => {
    if (!card.isConnected) return;
    card.querySelector('.rp-pop-emblem svg').outerHTML = tierEmblem(rp.tier, { size: 36, label: false });
    card.querySelector('.rp-pop-name').textContent = tierName(rp.tier, rp.division);
    card.querySelector('.rp-pop-label').textContent = label;
    bar.style.transition = 'none'; bar.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = ''; bar.style.width = pct(rp.progress); }));
    promoted(card, { tierUp });
  }, ms(SWAP_AT));
}

function promoted(card, { tierUp }) {
  card.classList.add('is-promoted');
  sound.levelUp?.(tierUp ? 3 : 2);
  haptic?.(tierUp ? [20, 40, 20, 40, 80] : [14, 30, 30]);
}

function show(html, { big, down, tierUp, long }) {
  clearTimeout(timer);
  node?.remove();
  node = el('div', `rp-pop${big ? ' is-big' : ''}${tierUp ? ' is-tier' : ''}${down ? ' is-down' : ''}`);
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.innerHTML = html;
  document.body.append(node);
  const mine = node;
  requestAnimationFrame(() => mine.classList.add('is-shown'));
  timer = setTimeout(() => { mine.classList.remove('is-shown'); setTimeout(() => mine.remove(), 300); if (node === mine) node = null; }, long);
  return mine;
}
