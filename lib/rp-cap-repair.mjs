// One-time RP repair (2026-10-30). PR #234 capped every game's RP win at 3× its bet for a few
// minutes; 한서 then narrowed the cap to roulette and slots ("그냥 룰렛 슬롯만 막자") and had just
// won 100× for little RP. Each big win settled in that window at any other game gets back the RP
// the cap took, once (state.meta.rpCapRepair).
import { rpForRound, rpOf, rpTierIndex, RP_CAPPED_GAMES, RP_PAYOUT_CAP } from './rank-points.mjs';

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
