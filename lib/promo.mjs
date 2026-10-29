// 승급전 참가비 (2026-10-29, 한서 "돈을 더 쓰게 만들어야" → "다 해서 업데이트까지"): the money side
// of the promotion series. The series itself counts in lib/rank-points.mjs (notePromo).
import { rpEra, rpOf, rpPointsNow, promoTarget, promoFee, promoMinStake, PROMO_WINS, PROMO_LOSSES } from './rank-points.mjs';
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

export function promoView(user, now = Date.now()) {
  if (!rpEra(now)) return null;
  const season = monthBoundary(now).id;
  const promo = user.rp?.season === season ? user.rp.promo : null;
  const need = { wins: PROMO_WINS, losses: PROMO_LOSSES };
  if (promo?.active) return { active: { target: promo.target, wins: promo.wins, losses: promo.losses, minStake: promo.minStake, fee: promo.fee, needWins: PROMO_WINS, needLosses: PROMO_LOSSES }, offer: null, last: null };
  const points = rpPointsNow(user, now), target = promoTarget(points);
  return {
    active: null,
    offer: target ? { target: target.id, fee: promoFee(target), minStake: promoMinStake(points), ...need } : null,
    last: promo ? { target: promo.target, result: promo.result, at: promo.at } : null
  };
}
