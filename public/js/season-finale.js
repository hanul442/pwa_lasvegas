// 시즌 마감 화면 (2026-10-30, 한서 "ㄱㄱ"): the first look after an RP season closes is a short
// show in three beats instead of a plain card.
//   1. 최종 결과: the emblem turns over, the season's RP rolls up, my place and the podium.
//   2. 보상: the badges the season left me (tier badge, 챌린저, a new personal best).
//   3. 새 시즌: a ladder of my tier and the three below it; the marker steps down one tier at a
//      time while the RP rolls down to where the new season starts me (lib/rank-points.mjs rpCarry).
// A tap anywhere on the card skips to the end. Reduced motion shows the end state at once.
// Seasons before the RP era keep the old card (js/rank.js maybeSeasonMoment).
import { el, sound, haptic, rollNumber, reducedMotion, ms } from './fx.js';
import { tierEmblem, tierName, TIERS, maybeSeasonMoment } from './rank.js';
import { bragButton } from './share.js';
import { bragTier } from './brags.js';
import { remember } from './seen.js';

const ORDER = Object.keys(TIERS);
const short = name => String(name || '').replace(' (프리시즌)', '');

// The season result: the RP show for an RP season, the old card otherwise. True when one opened.
export function seasonMoment(state, opts = {}) {
  const last = state?.rankSeason?.last;
  if (last?.mode === 'rp' && last.start) return seasonFinale(state, opts);
  maybeSeasonMoment(state, opts);
  return Boolean(document.querySelector('.rank-moment'));
}

export function seasonFinale(state, { force = false, onWrapped } = {}) {
  const last = state.rankSeason.last, { mine, start } = last;
  if (!state.user) return false;
  const key = `vegas:rank-moment:${last.id}:${state.user.id}`;
  if (!force) {
    if (!mine && !last.reset) return false;
    try { if (localStorage.getItem(key)) return false; } catch { return false; }
    remember(key, '1');
  }
  const motion = !reducedMotion();
  const wrapped = onWrapped ? (state.wrapped?.history || []).find(h => h.season === last.id && h.rounds) : null;
  const finalTier = mine?.tier ?? start.tier, finalRp = mine?.rp ?? start.rp;
  const from = ORDER.indexOf(finalTier), to = ORDER.indexOf(start.tier);
  // My tier and the ones the drop passes through, highest first.
  const ladder = ORDER.slice(Math.max(0, to), from + 1).reverse();
  const dropped = from - to;

  const rewards = [];
  if (mine) rewards.push([tierEmblem(mine.tier, { size: 30, label: false }), `${tierName(mine.tier, mine.division)} 시즌 배지`, `${short(last.name)} 기록으로 프로필에 남아요`]);
  if (mine?.rank <= 3) rewards.push([`<span class="finale-medal">${mine.rank}</span>`, `챌린저 ${mine.rank}위 배지`, `${mine.of}명 중 ${mine.rank}위`]);
  if (last.newBest) rewards.push(['<span class="finale-medal is-best">★</span>', '역대 최고 티어 갱신', `${tierName(mine.tier)}가 내 최고 기록이 됐어요`]);
  const podium = (last.podium || []).map(p => `<li${p.userId === state.user.id ? ' class="is-me"' : ''}><span class="rank-moment-place">${p.rank}</span>${tierEmblem(p.tier, { size: 22, label: false })}<b>${p.nickname}</b><small>${p.rp} RP</small></li>`).join('');

  const node = el('div', 'floor-moment rank-moment season-finale');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', `${short(last.name)} 결과${mine ? `: ${tierName(mine.tier, mine.division)}, ${mine.of}명 중 ${mine.rank}위` : ''}. ${last.next || '새 시즌'}은 ${tierName(start.tier, start.division)} RP ${start.rp}에서 시작해요.`);
  node.innerHTML = `<div class="floor-moment-inner season-finale-inner">
    <section class="finale-beat finale-result">
      <p class="finale-kicker">${short(last.name)} 종료</p>
      ${mine ? `<span class="finale-emblem">${tierEmblem(mine.tier, { size: 92 })}<i class="finale-ring"></i></span>
      <h2>${tierName(mine.tier, mine.division)}</h2>
      <p class="finale-line"><b data-final-rp>${motion ? 0 : finalRp}</b> RP · ${mine.of}명 중 ${mine.rank}위</p>
      ${mine.rank <= 3 ? `<span class="rank-moment-champ">챌린저 ${mine.rank}위</span>` : ''}` : '<h2>새 시즌</h2><p class="finale-line">지난 시즌엔 랭크 판이 없었어요</p>'}
      ${podium ? `<ol class="rank-moment-podium" aria-label="챌린저">${podium}</ol>` : ''}
    </section>
    ${rewards.length ? `<section class="finale-beat finale-rewards"><h3>받은 보상</h3><ul>${rewards.map(([icon, title, sub]) => `<li><span class="finale-reward-icon">${icon}</span><span><b>${title}</b><small>${sub}</small></span></li>`).join('')}</ul></section>` : ''}
    <section class="finale-beat finale-drop">
      <h3>${last.next || '새 시즌'} 시작</h3>
      ${ladder.length > 1 ? `<ol class="finale-ladder" aria-hidden="true" style="--steps:${ladder.length}">${ladder.map(id => `<li data-tier="${id}">${tierEmblem(id, { size: 34, label: false })}<small>${TIERS[id].name}</small></li>`).join('')}<i class="finale-marker"></i></ol>` : ''}
      <p class="finale-start"><span data-start-name>${tierName(motion && dropped > 0 ? finalTier : start.tier, motion && dropped > 0 ? mine?.division : start.division)}</span> · <b data-start-rp>${motion && dropped > 0 ? finalRp : start.rp}</b> RP에서 시작</p>
      <p class="finale-keep">${dropped > 0 ? `티어는 ${dropped}단계 내려가요. ` : ''}칩·꾸미기·명패·배지·업적은 그대로예요.</p>
    </section>
    <div class="rank-moment-actions moment-actions">${wrapped ? `<button type="button" class="pill-button" data-wrapped>${short(last.name)} 결산 카드</button>` : ''}<button type="button" class="pill-button pill-button--solid" data-close>${force ? '닫기' : '새 시즌 시작'}</button></div>
  </div>`;
  document.body.append(node);
  const actions = node.querySelector('.moment-actions');
  if (mine) actions.prepend(bragButton(() => bragTier({ tier: mine.tier, name: tierName(mine.tier, mine.division), season: short(last.name), rank: mine.rank, of: mine.of, peak: mine.peak, rp: mine.rp }), '티어 자랑하기'));
  actions.querySelectorAll('.pill-button--solid:not([data-close])').forEach(b => b.classList.remove('pill-button--solid'));
  requestAnimationFrame(() => node.classList.add('is-open'));

  const marker = node.querySelector('.finale-marker');
  const place = i => { if (marker) marker.style.setProperty('--at', i); node.querySelectorAll('.finale-ladder li').forEach((li, k) => li.classList.toggle('is-here', k === i)); };
  place(motion ? 0 : ladder.length - 1);

  const timers = [];
  const at = (t, fn) => timers.push(setTimeout(() => { if (node.isConnected) fn(); }, ms(t)));
  const settle = () => {
    timers.forEach(clearTimeout);
    node.classList.add('is-beat-1', 'is-beat-2', 'is-beat-3', 'is-done');
    place(ladder.length - 1);
    const fr = node.querySelector('[data-final-rp]'); if (fr) fr.textContent = finalRp;
    node.querySelector('[data-start-name]').textContent = tierName(start.tier, start.division);
    node.querySelector('[data-start-rp]').textContent = start.rp;
  };
  if (!motion) settle();
  else {
    at(150, () => {
      node.classList.add('is-beat-1');
      if (!force) { sound.win(); haptic([20, 40, 60]); }
      const fr = node.querySelector('[data-final-rp]');
      if (fr) rollNumber(fr, 0, finalRp, { duration: ms(1200), format: v => `${Math.round(v)}` });
    });
    const rewardsAt = 1700, dropAt = rewards.length ? rewardsAt + 600 + rewards.length * 250 : rewardsAt;
    if (rewards.length) at(rewardsAt, () => { node.classList.add('is-beat-2'); if (!force) sound.levelUp?.(2); });
    at(dropAt, () => {
      node.classList.add('is-beat-3');
      // On a short screen the drop sits below the fold: bring it up.
      node.querySelector('.finale-drop').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (dropped <= 0) { node.classList.add('is-done'); return; }
      const step = 520;
      rollNumber(node.querySelector('[data-start-rp]'), finalRp, start.rp, { duration: ms(step * dropped + 300), format: v => `${Math.round(v)}` });
      for (let i = 1; i <= dropped; i++) at(450 + step * i, () => {
        place(i);
        node.querySelector('[data-start-name]').textContent = tierName(ladder[i]);
        if (!force) { sound.tick?.(); haptic(10); }
        if (i === dropped) {
          node.querySelector('[data-start-name]').textContent = tierName(start.tier, start.division);
          node.classList.add('is-done');
        }
      });
    });
  }
  // A tap on the card (not a button) skips to the end.
  node.querySelector('.season-finale-inner').addEventListener('click', e => { if (!e.target.closest('button') && !node.classList.contains('is-done')) settle(); });

  const close = () => { timers.forEach(clearTimeout); node.classList.remove('is-open'); setTimeout(() => node.remove(), 400); removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-wrapped]')?.addEventListener('click', () => { close(); onWrapped(wrapped); });
  node.querySelector('[data-close]').focus({ preventScroll: true });
  return true;
}
