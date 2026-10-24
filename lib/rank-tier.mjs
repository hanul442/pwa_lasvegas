// Tiers of the monthly rank season (lib/rank-season.mjs), kept free of imports so the ledger
// (lib/economy.mjs addLedger) can note each player's peak without an import cycle.
// Ten tiers (한서 asked for more on 2026-10-17): 아이언 to start, then mostly ten times a step,
// with 에메랄드 and 그랜드마스터 as half-way steps near the top where the climb is longest.
export const RANK_TIERS = [
  { id: 'iron', name: '아이언', min: 0 },
  { id: 'bronze', name: '브론즈', min: 100_000_000 }, // 1억
  { id: 'silver', name: '실버', min: 1_000_000_000 }, // 10억
  { id: 'gold', name: '골드', min: 10_000_000_000 }, // 100억
  { id: 'platinum', name: '플래티넘', min: 100_000_000_000 }, // 1천억
  { id: 'emerald', name: '에메랄드', min: 500_000_000_000 }, // 5천억
  { id: 'diamond', name: '다이아몬드', min: 1_000_000_000_000 }, // 1조
  { id: 'master', name: '마스터', min: 10_000_000_000_000 }, // 10조
  { id: 'grandmaster', name: '그랜드마스터', min: 50_000_000_000_000 }, // 50조
  { id: 'legend', name: '레전드', min: 100_000_000_000_000 } // 100조
];
export const FIRST_RANK_SEASON = 'rank-2026-10';
const KST = 9 * 60 * 60 * 1000;

export const tierFor = worth => RANK_TIERS.findLast(t => (worth || 0) >= t.min) || RANK_TIERS[0];

// The calendar month in Seoul holding `now`.
export function monthBoundary(now = Date.now()) {
  const k = new Date(now + KST);
  const y = k.getUTCFullYear(), m = k.getUTCMonth();
  const start = Date.UTC(y, m, 1) - KST, end = Date.UTC(y, m + 1, 1) - KST;
  const id = `rank-${y}-${String(m + 1).padStart(2, '0')}`;
  return { id, name: `${m + 1}월 시즌${id === FIRST_RANK_SEASON ? ' (프리시즌)' : ''}`, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

// Every balance change: keep this month's highest net worth.
export function notePeak(user, worth, now = Date.now()) {
  const id = monthBoundary(now).id;
  if (!user.rank || typeof user.rank !== 'object') user.rank = { season: id, peak: 0, best: null };
  if (user.rank.season !== id) {
    // A month that closed before the reset reached this player (no state change since): start fresh.
    if (user.rank.season > id) return;
    // Keep last month's peak until the season closes it (lib/rank-season.mjs settle).
    user.rank = { season: id, peak: 0, best: user.rank.best ?? null, prev: { season: user.rank.season, peak: user.rank.peak || 0 } };
  }
  if (worth > user.rank.peak) user.rank.peak = worth;
}
