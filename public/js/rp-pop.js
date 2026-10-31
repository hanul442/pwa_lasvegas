// RP 팝업 (2026-10-29, 한서 "티어 RP 올라갔으면 팝업으로"): after a round moves RP, a small card
// slides in under the top bar with the change, where I stand and the step ahead. It never blocks
// the table (no buttons, pointer-events off) and stays quiet for a newcomer's first hands
// (js/first-day.js). The full tier-up moment stays in the lobby (js/rank.js celebrateTier).
// 2026-10-30 한서 "촤라락 올라가는 숫자" + "승급하면 특별한 모션": the RP change and my points roll,
// the bar fills, and a promotion fills the bar to the end, then flips the emblem to the new one
// with a ring, sparks and a gold sweep (bigger for a new tier).
import { el, sound, haptic, rollNumber, reducedMotion, ms } from './fx.js';
import { tierName, tierEmblem, TIERS } from './rank.js';
import { TIERS as FLOOR_TIERS } from './chips.js';
import { wonCH, chipValueFor } from './money.js';

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
  const pa = state.promo?.active, pl = state.promo?.last;
  const promoSig = pa ? `a:${pa.target}:${pa.log ?? `${pa.wins}-${pa.losses}`}` : pl ? `e:${pl.target}:${pl.result}:${pl.at}` : '';
  const da = state.defense?.active, dl = state.defense?.last;
  const defenseSig = da ? `a:${da.tier}:${da.log}` : dl ? `e:${dl.tier}:${dl.result}:${dl.at}` : '';
  const now = { key: `${state.user.id}:${rp.season}:${last?.at || ''}`, tier: rp.tier, division: rp.division, points: rp.points, progress: rp.progress, floorLevel: rp.floorLevel, promoSig, defenseSig };
  const prev = seen;
  seen = now;
  // The first state after a load only sets the mark; the same round never shows twice.
  if (!prev || prev.key === now.key || quiet) return;
  if (!prev.key.startsWith(`${state.user.id}:${rp.season}:`)) return;
  // 승급전 (2026-10-30 한서 "승급전이면 승급전이라고 말하면서 몇번 이기면 승급된다고", "5판3선승제",
  // "동그라미 안에 하얀색 채워넣는걸로"): a round that starts, moves or loses the series gets its
  // own card with five circles; the winning round goes on to the promotion below with the circles.
  // 강등 방어전: the same five circles, from the other side.
  if (prev.defenseSig !== defenseSig) {
    if (da) return defenseCard(da, { started: !prev.defenseSig?.startsWith(`a:${da.tier}:`), delta: last?.delta || 0 });
    if (dl && dl.result !== 'dropped') return defenseCard(dl, { ended: dl.result, delta: last?.delta || 0 });
  }
  const promoMoved = prev.promoSig !== promoSig;
  const promoWon = promoMoved && !pa && pl?.result === 'won';
  if (promoMoved && pa) return promoCard(pa, { started: !prev.promoSig.startsWith(`a:${pa.target}:`), delta: last?.delta || 0 });
  if (promoMoved && pl?.result === 'lost') return promoCard(pl, { lost: true, delta: last?.delta || 0 });
  if (!last?.delta && !promoWon) return;
  const up = rankOf(now) > rankOf(prev), down = rankOf(now) < rankOf(prev), tierUp = up && now.tier !== prev.tier;
  const promo = state.promo?.active;
  const from = Number.isFinite(prev.points) ? prev.points : tenthOf(rp.points - last.delta);
  const nextLine = promo ? `승급전 ${promo.wins}승 ${promo.losses}패` : rp.next ? (rp.nextPromo ? `승급전 3승이면 ${tierName(rp.next, rp.nextDivision)}` : `${tierName(rp.next, rp.nextDivision)}까지 ${rp.toNext} RP`) : '최고 티어';
  const label = promoWon && tierUp ? '승급전 통과!' : tierUp ? '티어 승급!' : up ? '승급!' : down ? '강등 · ' : '';
  const motion = !reducedMotion();
  // A promotion opens on where I was, then turns over to where I am.
  const startTier = up && motion ? prev : now;
  const said = `${signed(last.delta)} RP, ${label}${tierName(rp.tier, rp.division)} ${rp.points} RP`;
  // Screen readers get the end result once; the rolling numbers are for the eye.
  const html = `<span class="sr-only">${said}</span><span class="rp-pop-emblem" aria-hidden="true">${tierEmblem(startTier.tier, { size: up ? 36 : 26, label: false })}${up ? '<i class="rp-pop-ring"></i><i class="rp-pop-sparks">' + '<b></b>'.repeat(8) + '</i>' : ''}</span>
    <span class="rp-pop-text" aria-hidden="true">
      <b class="rp-pop-delta ${last.delta > 0 ? 'pos' : 'neg'}">${motion ? (last.delta > 0 ? '+0' : '-0') : signed(last.delta)} RP</b>
      <span class="rp-pop-tier"><em class="rp-pop-label">${up && motion ? '' : label}</em><span class="rp-pop-name">${tierName(startTier.tier, startTier.division)}</span></span>
      ${promoWon ? `<span class="rp-pop-dots">${dotsHtml(pl.log, { fresh: motion })}</span>` : ''}<span class="rp-pop-bar" aria-hidden="true"><i style="width:${pct(motion ? prev.progress ?? rp.progress : rp.progress)}"></i></span>
      <small class="rp-pop-next"><b class="rp-pop-points">${tenthOf(motion ? from : rp.points)}</b> RP<span class="rp-pop-step"> · ${nextLine}</span></small>
    </span>`;
  // A new tier opens a new floor, and its chips are worth more (2026-10-31, 한서 "승급할때 이제
  // 칩단위가 바뀌었다고 알려주고나"): 1칩 is a hundredth of the floor's smallest bet.
  const floors = Object.values(FLOOR_TIERS), newFloor = tierUp && rp.floors && rp.floorLevel > (prev.floorLevel ?? rp.floorLevel) ? floors[rp.floorLevel] : null;
  const unitHtml = newFloor ? `<small class="rp-pop-unit">${newFloor.name} 열림 · 1칩 = ${wonCH(chipValueFor(newFloor.min))}원 (전 ${wonCH(chipValueFor(floors[prev.floorLevel]?.min || newFloor.min))}원)</small>` : '';
  const card = show(html.replace(/<\/span>$/, `${unitHtml}</span>`), { big: up, down, tierUp, long: newFloor ? 6500 : up ? 4200 : 2800 });
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

// Five circles in the order the series went: a win fills white, a loss is a red ring with a slash,
// rounds still to play stay empty. The newest one pops in.
const PROMO_ROUNDS = 5;
function dotsHtml(log = '', { fresh = false } = {}) {
  return Array.from({ length: PROMO_ROUNDS }, (_, i) => {
    const r = log[i];
    return `<i class="${r === 'W' ? 'is-win' : r === 'L' ? 'is-loss' : ''}${fresh && i === log.length - 1 ? ' is-new' : ''}"></i>`;
  }).join('');
}

function promoCard(p, { started = false, lost = false, delta = 0 }) {
  const wins = p.wins || 0, losses = p.losses || 0, need = p.needWins || 3, out = p.needLosses || 3;
  const target = tierName(p.target, 'V');
  const matchPoint = !lost && wins === need - 1, edge = !lost && losses === out - 1;
  const head = started ? '승급전 시작!' : lost ? '승급전 탈락' : matchPoint && edge ? '마지막 판!' : matchPoint ? "매치 포인트!" : edge ? "벼랑 끝" : `${wins}승 ${losses}패`;
  const foot = started ? `5판 중 ${need}승이면 ${target}` : lost ? 'RP를 다시 채우면 또 도전해요' : matchPoint ? `1승만 더하면 ${target}` : edge ? `1패면 탈락 · ${need - wins}승 더 필요` : `${need - wins}승 더하면 ${target}`;
  const said = `${tierName(p.target)} ${head} ${wins}승 ${losses}패. ${foot}`;
  const html = `<span class="sr-only">${said}</span><span class="rp-pop-emblem" aria-hidden="true">${tierEmblem(p.target, { size: 30, label: false })}</span>
    <span class="rp-pop-text" aria-hidden="true">
      <span class="rp-pop-tier rp-pop-promo-head"><em class="rp-pop-label">${head}</em><span class="rp-pop-name">${tierName(p.target)} 승급전</span></span>
      <span class="rp-pop-dots">${dotsHtml(p.log, { fresh: !started && !reducedMotion() })}</span>
      <small class="rp-pop-next">${foot}${delta ? ` · ${signed(delta)} RP` : ''}</small>
    </span>`;
  const card = show(html, { big: started || matchPoint, down: lost, tierUp: false, long: started || lost ? 4200 : 3200 });
  card.classList.add('is-promo');
  if (started || matchPoint) { sound.levelUp?.(1); haptic?.([12, 30, 12]); }
  else if (!lost && p.log?.endsWith('W')) haptic?.(12);
}

function defenseCard(d, { started = false, ended = null, delta = 0 }) {
  const wins = d.wins || 0, losses = d.losses || 0, need = d.needWins || 3, out = d.needLosses || 3;
  const keep = tierName(d.tier, 'V'), drop = tierName(d.below, 'I');
  const live = !ended, matchPoint = live && wins === need - 1, edge = live && losses === out - 1;
  const head = started ? '강등 방어전!' : ended === 'kept' ? '방어 성공!' : ended === 'demoted' ? '강등' : matchPoint && edge ? '마지막 판!' : matchPoint ? '방어까지 1승' : edge ? '벼랑 끝' : `${wins}승 ${losses}패`;
  const foot = started ? `${need}승이면 유지 · ${out}패면 ${drop}` : ended === 'kept' ? `${keep} 지켰어요` : ended === 'demoted' ? `${drop}로 내려갔어요` : edge ? `1패면 ${drop} · ${need - wins}승이면 유지` : `${need - wins}승 더하면 ${keep} 유지`;
  const said = `${tierName(d.tier)} 강등 방어전 ${head} ${wins}승 ${losses}패. ${foot}`;
  const html = `<span class="sr-only">${said}</span><span class="rp-pop-emblem" aria-hidden="true">${tierEmblem(ended === 'demoted' ? d.below : d.tier, { size: 30, label: false })}</span>
    <span class="rp-pop-text" aria-hidden="true">
      <span class="rp-pop-tier rp-pop-promo-head"><em class="rp-pop-label">${head}</em><span class="rp-pop-name">${tierName(d.tier)} 방어전</span></span>
      <span class="rp-pop-dots">${dotsHtml(d.log, { fresh: !started && !reducedMotion() })}</span>
      <small class="rp-pop-next">${foot}${delta ? ` · ${signed(delta)} RP` : ''}</small>
    </span>`;
  const danger = started || edge || ended === 'demoted';
  const card = show(html, { big: ended === 'kept' || matchPoint, down: danger, tierUp: false, long: started || ended ? 4200 : 3200 });
  card.classList.add('is-promo', 'is-defense');
  if (ended === 'kept') promoted(card, { tierUp: false });
  else if (started) haptic?.([30, 40, 30]);
  else if (d.log?.endsWith('W')) haptic?.(12);
}

function promoted(card, { tierUp }) {
  card.classList.add('is-promoted');
  sound.levelUp?.(tierUp ? 3 : 2);
  haptic?.(tierUp ? [20, 40, 20, 40, 80] : [14, 30, 30]);
}

// A table's one-line hint (js/guide.js .tip-line, e.g. "규칙과 따라 하기는 ? 버튼에 있어요") sits
// near the top too: when the card would cover it, the card moves just below it.
function clearHint(card) {
  const hint = document.querySelector('.tip.is-on .tip-line');
  if (!hint) return;
  const h = hint.getBoundingClientRect(), c = card.getBoundingClientRect();
  if (!h.height || h.top > c.bottom + 4 || h.bottom < c.top - 4) return;
  card.style.top = `${Math.round(h.bottom + 8)}px`;
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
  clearHint(mine);
  requestAnimationFrame(() => mine.classList.add('is-shown'));
  timer = setTimeout(() => { mine.classList.remove('is-shown'); setTimeout(() => mine.remove(), 300); if (node === mine) node = null; }, long);
  return mine;
}
