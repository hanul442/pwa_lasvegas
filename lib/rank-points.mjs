// RP (랭크 점수), the economy's new yardstick (2026-10-29, 한서 picked "C: RP 티어 + 주간 리그").
// Chips measure how much a player has; RP measures how they play. Every settled round moves RP
// by what it won or lost *relative to its own bet*, so a bigger bet never buys a bigger score and
// going all-in doesn't win a tier. Losses count three quarters of a win, so steady play climbs
// slowly even against the house edge, while long shots (a roulette straight-up) still drain RP.
// One round moves at most RP_ROUND_CAP either way, and a day's gains stop at RP_DAY_CAP.
// Higher floors pay more: a win on a floor above the one the player's RP tier belongs to counts
// 1.5×, one below it 0.5×.
// November 2026 runs RP as a 베타 next to the net-worth tiers (lib/rank-season.mjs); from the
// December season RP becomes the tier. Points start again from 0 every month for now.
// Plain data in, plain data out; no imports that would cycle back through the ledger.
import { RANK_TIERS, monthBoundary } from './rank-tier.mjs';
import { levelForStake } from './constants.mjs';

export const RP_TIER_STEP = 100;      // RP per tier: 아이언 0, 브론즈 100 … 레전드 900
export const RP_PER_STAKE = 10;       // a round that wins its own bet back is +10
export const RP_LOSS_RATE = 0.75;     // a lost bet is −7.5
export const RP_ROUND_CAP = 30;       // one round: at most ±30
export const RP_DAY_CAP = 300;        // gains in one Seoul day stop here
export const RP_UP_FLOOR = 1.5, RP_DOWN_FLOOR = 0.5;
const KST = 9 * 60 * 60 * 1000;
const dayKey = now => new Date(now + KST).toISOString().slice(0, 10);
// The Monday (Seoul) that starts the week holding `now`: the weekly league's week (lib/rank-league.mjs).
export function rpWeekOf(now = Date.now()) {
  const k = new Date(now + KST), back = (k.getUTCDay() + 6) % 7;
  const start = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back) - KST;
  return { id: `league-${new Date(start + KST).toISOString().slice(0, 10)}`, startsAt: start, endsAt: start + 7 * 86_400_000 };
}
const tenth = x => Math.round(x * 10) / 10;

export const rpTierFor = points => RANK_TIERS[Math.max(0, Math.min(RANK_TIERS.length - 1, Math.floor((points || 0) / RP_TIER_STEP)))];
// The floor an RP tier plays on: 아이언·브론즈 the Gold Room, then one floor per tier.
export const rpFloorLevel = points => Math.max(0, RANK_TIERS.indexOf(rpTierFor(points)) - 1);

// What one round is worth in RP, before the day's cap.
export function rpForRound({ stake, netPnl, points = 0 }) {
  if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(netPnl) || netPnl === 0) return 0;
  const ratio = netPnl / stake;
  if (ratio < 0) return tenth(Math.max(-RP_ROUND_CAP, ratio * RP_PER_STAKE * RP_LOSS_RATE));
  const level = levelForStake(stake), home = rpFloorLevel(points);
  const floor = level > home ? RP_UP_FLOOR : level < home ? RP_DOWN_FLOOR : 1;
  return tenth(Math.min(RP_ROUND_CAP, ratio * RP_PER_STAKE * floor));
}

function rpOf(user, now) {
  const season = monthBoundary(now).id;
  if (!user.rp || typeof user.rp !== 'object' || user.rp.season !== season) {
    const prev = user.rp?.season && user.rp.season < season ? { season: user.rp.season, points: user.rp.points || 0, peak: user.rp.peak || 0 } : user.rp?.prev ?? null;
    user.rp = { season, points: 0, peak: 0, rounds: 0, day: dayKey(now), dayGain: 0, last: null, ...(prev ? { prev } : {}) };
  }
  if (user.rp.day !== dayKey(now)) { user.rp.day = dayKey(now); user.rp.dayGain = 0; }
  return user.rp;
}

// Every settled round (lib/economy.mjs updateStats).
export function noteRp(user, { game, stake, netPnl }, now = Date.now()) {
  const rp = rpOf(user, now);
  let delta = rpForRound({ stake, netPnl, points: rp.points });
  if (delta > 0) delta = Math.min(delta, Math.max(0, RP_DAY_CAP - rp.dayGain));
  if (delta < 0) delta = Math.max(delta, -rp.points);
  delta = tenth(delta) || 0;
  rp.rounds++;
  if (delta > 0) rp.dayGain = tenth(rp.dayGain + delta);
  rp.points = tenth(rp.points + delta);
  rp.peak = Math.max(rp.peak, rp.points);
  rp.last = { delta, game, at: new Date(now).toISOString() };
  // The week's RP, kept apart from the month's points so a week that spans two months still adds up.
  const week = rpWeekOf(now).id;
  if (user.rpWeek?.id !== week) user.rpWeek = { id: week, net: 0, rounds: 0, first: new Date(now).toISOString() };
  user.rpWeek.net = tenth(user.rpWeek.net + delta);
  user.rpWeek.rounds++;
  return delta;
}

// My RP on the screens: points, tier, the next one, today's gains against the cap.
export function rpView(user, now = Date.now()) {
  const season = monthBoundary(now);
  const rp = user.rp?.season === season.id ? user.rp : null;
  const points = rp?.points || 0, tier = rpTierFor(points);
  const at = RANK_TIERS.indexOf(tier), next = RANK_TIERS[at + 1] || null;
  return {
    season: season.id, points: Math.floor(points), peak: Math.floor(rp?.peak || 0), rounds: rp?.rounds || 0,
    tier: tier.id, next: next?.id ?? null, toNext: next ? Math.ceil((at + 1) * RP_TIER_STEP - points) : 0,
    progress: next ? (points - at * RP_TIER_STEP) / RP_TIER_STEP : 1,
    today: rp?.day === dayKey(now) ? Math.floor(rp.dayGain) : 0, dayCap: RP_DAY_CAP,
    last: rp?.last ?? null
  };
}

// This month's RP board: everyone with a round played, best first (demo seats and guests left out).
export function rpStandings(state, now = Date.now(), skip = []) {
  const season = monthBoundary(now).id;
  return Object.values(state.users || {})
    .filter(u => !u.guest && !skip.includes(u.id) && u.rp?.season === season && u.rp.rounds > 0)
    .map(u => ({ id: u.id, nickname: u.nickname, value: Math.floor(u.rp.points || 0) }))
    .sort((a, b) => b.value - a.value || a.nickname.localeCompare(b.nickname))
    .map((r, i) => ({ ...r, rank: i + 1, tier: rpTierFor(r.value).id }));
}
export const rpBoard = (state, userId, now = Date.now(), skip = []) => rpStandings(state, now, skip).filter(r => r.rank <= 50 || r.id === userId);
