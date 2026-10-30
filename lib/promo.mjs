// 승급전 참가비 (2026-10-29, 한서 "돈을 더 쓰게 만들어야" → "다 해서 업데이트까지"): the money side
// of the promotion series. The series itself counts in lib/rank-points.mjs (notePromo).
import { rpEra, rpOf, rpPointsNow, rpCeiling, promoTarget, promoFee, promoMinStake, PROMO_WINS, PROMO_LOSSES, DEFENSE_WINS, DEFENSE_LOSSES, rpDemoteTo } from './rank-points.mjs';
import { RANK_TIERS } from './rank-tier.mjs';
import { monthBoundary } from './rank-tier.mjs';
import { payFee } from './cashier.mjs';

export function startPromo(state, user, now = Date.now()) {
  if (!rpEra(now)) throw new Error('PROMO_CLOSED');
  const target = promoTarget(rpPointsNow(user, now));
  if (!target) throw new Error('PROMO_NOT_AVAILABLE');
  const rp = rpOf(user, now);
  if (rp.promo?.active) throw new Error('PROMO_ACTIVE');
  const fee = promoFee(target), minStake = promoMinStake(rp.points);
  payFee(state, user, fee, { type: 'PROMO_FEE', referenceType: 'RANK', referenceId: target.id, metadata: { target: target.id, season: rp.season } });
  rp.promo = { active: true, target: target.id, wins: 0, losses: 0, minStake, fee, startedAt: new Date(now).toISOString() };
  return { target: target.id, fee, minStake };
}

// 승급전 자동 시작 (2026-10-30, 한서 "승급전이 자동으로 되는거지 rp다 차면"): the round that fills
// division I to the top opens the series by itself and pays the fee. If the wallet can't cover the
// fee the series waits for the button instead. Only the round that reaches the top starts it, so a
// lost series needs the RP climbed back before the next one (no fee charged over and over).
export function autoPromo(state, user, before, now = Date.now()) {
  if (!rpEra(now)) return null;
  const points = rpPointsNow(user, now);
  if (!(before < points) || points !== rpCeiling(points) || !promoTarget(points)) return null;
  if (user.rp?.promo?.active) return null;
  try { return { ...startPromo(state, user, now), auto: true }; }
  catch (e) { if (e.message === 'INSUFFICIENT_BANKROLL') return null; throw e; }
}

// 강등 방어전 for the screens: the running series or how the last one ended.
export function defenseView(user, now = Date.now()) {
  if (!rpEra(now)) return null;
  const season = monthBoundary(now).id;
  const d = user.rp?.season === season ? user.rp.defense : null;
  if (!d) return null;
  const i = RANK_TIERS.findIndex(t => t.id === d.tier);
  const below = RANK_TIERS[Math.max(0, i - 1)].id;
  const base = { tier: d.tier, below, wins: d.wins || 0, losses: d.losses || 0, log: d.log || '', needWins: DEFENSE_WINS, needLosses: DEFENSE_LOSSES, minStake: d.minStake, demoteTo: rpDemoteTo(i) };
  return d.active ? { active: base, last: null } : { active: null, last: { ...base, result: d.result, at: d.at } };
}

export function promoView(user, now = Date.now()) {
  if (!rpEra(now)) return null;
  const season = monthBoundary(now).id;
  const promo = user.rp?.season === season ? user.rp.promo : null;
  const need = { wins: PROMO_WINS, losses: PROMO_LOSSES };
  if (promo?.active) return { active: { target: promo.target, wins: promo.wins, losses: promo.losses, minStake: promo.minStake, fee: promo.fee, needWins: PROMO_WINS, needLosses: PROMO_LOSSES, log: promo.log || '' }, offer: null, last: null };
  const points = rpPointsNow(user, now), target = promoTarget(points);
  return {
    active: null,
    offer: target ? { target: target.id, fee: promoFee(target), minStake: promoMinStake(points), ...need } : null,
    last: promo ? { target: promo.target, result: promo.result, at: promo.at, wins: promo.wins || 0, losses: promo.losses || 0, log: promo.log || '' } : null
  };
}
