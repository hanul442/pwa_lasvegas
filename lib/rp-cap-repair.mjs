// One-time RP repair (2026-10-30). PR #234 capped every game's RP win at 3× its bet for a few
// minutes; 한서 then narrowed the cap to roulette and slots ("그냥 룰렛 슬롯만 막자") and had just
// won 100× for little RP. Each big win settled in that window at any other game gets back the RP
// the cap took, once (state.meta.rpCapRepair).
import { rpForRound, rpOf, rpTierIndex, rpCeiling, RP_CAPPED_GAMES, RP_PAYOUT_CAP, RP_TIER_STARTS, RP_TIER_STARTS_BEFORE_1031 } from './rank-points.mjs';
import { monthBoundary } from './rank-tier.mjs';

export const RP_CAP_FROM = '2026-10-30T10:10:00.000Z';

export function repairRpCap(state, now = Date.now()) {
  if (state.meta?.rpCapRepair) return [];
  const fixed = [];
  for (const tx of state.ledger || []) {
    if (tx.type !== 'GAME_WIN' || tx.referenceType !== 'GAME_ROUND' || String(tx.createdAt) < RP_CAP_FROM) continue;
    const game = tx.metadata?.game, stake = tx.metadata?.stake, net = tx.rawPnlDelta;
    if (!game || RP_CAPPED_GAMES.has(game) || !(stake > 0) || !(net > stake * RP_PAYOUT_CAP)) continue;
    const user = state.users?.[tx.userId];
    if (!user) continue;
    const rp = rpOf(user, now);
    const points = rp.points;
    const missing = rpForRound({ stake, netPnl: net, points, game }) - rpForRound({ stake, netPnl: stake * RP_PAYOUT_CAP, points, game });
    if (missing <= 0) continue;
    rp.points += missing;
    rp.peak = Math.max(rp.peak, rp.points);
    if (rp.dayGain != null) rp.dayGain += missing;
    if (user.rpWeek) user.rpWeek.net += missing;
    fixed.push({ userId: user.id, game, roundId: tx.referenceId, rp: missing, tier: rpTierIndex(rp.points) });
  }
  state.meta = { ...(state.meta || {}), rpCapRepair: { at: new Date(now).toISOString(), fixed } };
  return fixed;
}

// Second one-time repair (2026-10-31, 한서 "딴돈에 54배 벌었는데 왜 10rp밖에 안오르지"): 맞고 and
// 고스톱 measured RP against |net| instead of the 10-point deposit, so every win was +10. Each win
// this season bigger than its deposit gets the RP it was short, once (state.meta.rpHwatuRepair),
// never past the top of the player's division I (a 승급전 still decides the next tier).
const HWATU = new Set(['Matgo', 'Gostop']);
export function repairHwatuRp(state, now = Date.now()) {
  if (state.meta?.rpHwatuRepair) return [];
  const since = new Date(monthBoundary(now).startsAt ?? 0).toISOString();
  const fixed = [];
  for (const tx of state.ledger || []) {
    if (tx.type !== 'GAME_WIN' || tx.referenceType !== 'GAME_ROUND' || String(tx.createdAt) < since) continue;
    const game = tx.metadata?.game, stake = tx.metadata?.stake, net = tx.rawPnlDelta;
    if (!HWATU.has(game) || !(stake > 0) || !(net > stake)) continue;
    const user = state.users?.[tx.userId];
    if (!user) continue;
    const rp = rpOf(user, now), points = rp.points;
    const owed = rpForRound({ stake, netPnl: net, points, game }) - rpForRound({ stake: net, netPnl: net, points, game });
    const missing = Math.max(0, Math.min(owed, rpCeiling(points) - points));
    if (missing <= 0) continue;
    rp.points += missing;
    rp.peak = Math.max(rp.peak, rp.points);
    if (rp.dayGain != null) rp.dayGain += missing;
    if (user.rpWeek) user.rpWeek.net += missing;
    fixed.push({ userId: user.id, game, roundId: tx.referenceId, rp: missing, tier: rpTierIndex(rp.points) });
  }
  state.meta = { ...(state.meta || {}), rpHwatuRepair: { at: new Date(now).toISOString(), fixed } };
  return fixed;
}

// 티어 칸 넓히기 (2026-10-31, 한서 "5000으로 딱 맞추자"): the ladder moved from
// RP_TIER_STARTS_BEFORE_1031 to RP_TIER_STARTS. Every stored point total moves once to the same
// spot inside its tier (state.meta.rpTierRescale), so tiers and divisions stay where they were.
export function rescaleRpPoints(p, from = RP_TIER_STARTS_BEFORE_1031, to = RP_TIER_STARTS) {
  if (!Number.isFinite(p) || p <= 0) return p;
  let i = 0;
  while (i + 1 < from.length && p >= from[i + 1]) i++;
  const top = i === from.length - 1;
  const fromW = top ? from[i] - from[i - 1] : from[i + 1] - from[i];
  const toW = top ? to[i] - to[i - 1] : to[i + 1] - to[i];
  return Math.round(to[i] + (p - from[i]) * toW / fromW);
}
export function rescaleRpTiers(state) {
  if (state.meta?.rpTierRescale) return 0;
  let moved = 0;
  for (const user of Object.values(state.users || {})) {
    const rp = user.rp;
    if (!rp || typeof rp !== 'object') continue;
    for (const k of ['points', 'peak', 'carried']) if (Number.isFinite(rp[k])) rp[k] = rescaleRpPoints(rp[k]);
    if (rp.prev && typeof rp.prev === 'object') for (const k of ['points', 'peak']) if (Number.isFinite(rp.prev[k])) rp.prev[k] = rescaleRpPoints(rp.prev[k]);
    moved++;
  }
  state.meta = { ...(state.meta || {}), rpTierRescale: { at: new Date().toISOString(), moved } };
  return moved;
}
