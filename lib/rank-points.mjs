// RP (랭크 점수), the economy's new yardstick (2026-10-29, 한서 picked "C: RP 티어 + 주간 리그").
// Chips measure how much a player has; RP measures how they play. Every settled round moves RP
// by what it won or lost *relative to its own bet*, so a bigger bet never buys a bigger score and
// going all-in doesn't win a tier. Losses count three quarters of a win, so steady play climbs
// slowly even against the house edge, while long shots (a roulette straight-up) still drain RP.
// Rounds and days have no cap (한서 removed both on 2026-10-29).
// Higher floors pay more: a win on a floor above the one the player's RP tier belongs to counts
// 1.5×, one below it 0.5×.
// It became the tier on 2026-10-29 (RP_TIER_FROM below).
// Plain data in, plain data out; no imports that would cycle back through the ledger.
import { RANK_TIERS, monthBoundary } from './rank-tier.mjs';
import { FLOORS, LEGACY_ECONOMY } from './constants.mjs';

export const RP_TIER_STEP = 100;      // RP per tier: 아이언 0, 브론즈 100 … 레전드 900
export const RP_PER_STAKE = 10;       // a round that wins its own bet back is +10
// Losses and wins by tier: RP_WIN_BY_TIER / RP_LOSS_BY_TIER below (아이언 loses 7.5 per lost bet).
// 2026-10-29 한서 "한판당 rp 상한이랑 하루 rp상한" 없애: no cap on a round or a day any more.
export const RP_UP_FLOOR = 1.5, RP_DOWN_FLOOR = 0.5;
// 2026-10-29 한서 "Rp시즌 오늘부터 진행해" (and on the card: "오늘 전부 전환"): from October, today,
// RP *is* the month's tier, ranking and badges (lib/rank-season.mjs), it opens the floors
// (lib/state.mjs) three times apart from 1천만 (lib/constants.mjs), the bank lends no more
// (lib/bank.mjs), pay is the same for everyone (lib/state.mjs rewardBase) and money buys each
// table's chips (lib/cashier.mjs). A month that ends in the RP era keeps the chips and hands the next month
// its points three tiers lower (RP_CARRY_DROP) instead of wiping everyone back to 아이언.
// The two switches are kept apart so the tier and the rest could move on different months.
export const RP_TIER_FROM = 'rank-2026-10';
export const RP_ERA_FROM = 'rank-2026-10';
export const RP_CARRY_DROP = 3;
// Tests of the old economy (tests/legacy-economy.mjs) never reach the switch.
const tierFrom = LEGACY_ECONOMY ? 'rank-9999-12' : RP_TIER_FROM, eraFrom = LEGACY_ECONOMY ? 'rank-9999-12' : RP_ERA_FROM;
export const rpTierEraFor = seasonId => String(seasonId || '') >= tierFrom;
export const rpTierEra = (now = Date.now()) => rpTierEraFor(monthBoundary(now).id);
export const rpEraFor = seasonId => String(seasonId || '') >= eraFrom;
export const rpEra = (now = Date.now()) => rpEraFor(monthBoundary(now).id);
const KST = 9 * 60 * 60 * 1000;
const dayKey = now => new Date(now + KST).toISOString().slice(0, 10);
// The Monday (Seoul) that starts the week holding `now`: the weekly league's week (lib/rank-league.mjs).
export function rpWeekOf(now = Date.now()) {
  const k = new Date(now + KST), back = (k.getUTCDay() + 6) % 7;
  const start = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back) - KST;
  return { id: `league-${new Date(start + KST).toISOString().slice(0, 10)}`, startsAt: start, endsAt: start + 7 * 86_400_000 };
}
const tenth = x => Math.round(x * 10) / 10;

// 2026-10-29 한서 "티어도 아이언 4 3 2 로마자로": each tier below 레전드 splits into four
// divisions of 25 RP, IV (lowest) to I. Floors and the season carry still go by the whole tier.
export const RP_DIVISIONS = ['IV', 'III', 'II', 'I'];
export const RP_DIVISION_STEP = RP_TIER_STEP / RP_DIVISIONS.length;
const TOP_TIER_AT = (RANK_TIERS.length - 1) * RP_TIER_STEP;
export const rpDivision = points => {
  const p = Math.max(0, points || 0);
  return p >= TOP_TIER_AT ? null : RP_DIVISIONS[Math.min(RP_DIVISIONS.length - 1, Math.floor((p % RP_TIER_STEP) / RP_DIVISION_STEP))];
};
// The next step up (a division or, from I, the next tier's IV), what it takes, and how far along
// the current division I am.
export function rpNextStep(points) {
  const p = Math.max(0, points || 0);
  if (p >= TOP_TIER_AT) return { next: null, progress: 1 };
  const at = Math.floor(p / RP_DIVISION_STEP) * RP_DIVISION_STEP, to = at + RP_DIVISION_STEP;
  return { next: { id: rpTierFor(to).id, division: rpDivision(to), need: Math.max(0, Math.ceil(to - p)) }, progress: (p - at) / RP_DIVISION_STEP };
}
// 승급전 (2026-10-29, 한서 "돈을 더 쓰게"): in a tier's top division (I) a player may pay
// PROMO_FEE_BETS of the next tier's floor minimum to play a best-of-three. Two wins on bets of at
// least their own floor's minimum lift them straight to the next tier; two losses end it, fee gone.
// Ordinary RP keeps counting during the series either way. A new season drops an open series.
export const PROMO_WINS = 2, PROMO_LOSSES = 2, PROMO_FEE_BETS = 20;
export const promoTarget = points => {
  const p = Math.max(0, points || 0);
  if (p >= TOP_TIER_AT || rpDivision(p) !== 'I') return null;
  return rpTierFor((Math.floor(p / RP_TIER_STEP) + 1) * RP_TIER_STEP);
};
const floorAt = level => FLOORS[Math.max(0, Math.min(FLOORS.length - 1, level))];
export const promoFee = target => floorAt(rpFloorLevel(RANK_TIERS.indexOf(target) * RP_TIER_STEP)).minBet * PROMO_FEE_BETS;
export const promoMinStake = points => floorAt(rpFloorLevel(points)).minBet;

export const rpTierFor = points => RANK_TIERS[Math.max(0, Math.min(RANK_TIERS.length - 1, Math.floor((points || 0) / RP_TIER_STEP)))];
// The floor an RP tier plays on: 아이언·브론즈 the Gold Room, then one floor per tier.
export const rpFloorLevel = points => Math.max(0, RANK_TIERS.indexOf(rpTierFor(points)) - 1);

// The cheapest floor a bet could be placed on (its table maximum reaches it), so a top bet on a
// floor never counts as the floor above.
export const rpLevelForStake = stake => { const i = FLOORS.findIndex(f => stake <= f.maxBet); return i < 0 ? FLOORS.length - 1 : i; };

// What one round is worth in RP, before the day's cap.
// The climb gets steeper (2026-10-29, 한서 "티어가 올라갈수록 올라가기 어렵게"): by the tier the
// player stands in, a win counts less and a loss costs more. 아이언·브론즈 play as before.
export const RP_WIN_BY_TIER = [1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35];
export const RP_LOSS_BY_TIER = [0.75, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.2, 1.3];
const tierIndex = points => RANK_TIERS.indexOf(rpTierFor(points));

export function rpForRound({ stake, netPnl, points = 0 }) {
  if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(netPnl) || netPnl === 0) return 0;
  const ratio = netPnl / stake, at = tierIndex(points);
  if (ratio < 0) return tenth(ratio * RP_PER_STAKE * RP_LOSS_BY_TIER[at]);
  const level = rpLevelForStake(stake), home = Math.min(FLOORS.length - 1, rpFloorLevel(points));
  const floor = level > home ? RP_UP_FLOOR : level < home ? RP_DOWN_FLOOR : 1;
  return tenth(ratio * RP_PER_STAKE * floor * RP_WIN_BY_TIER[at]);
}

// The season before `seasonId` ('rank-2026-12' → 'rank-2026-10', as October ran two months).
function monthBefore(seasonId) {
  const [y, m] = seasonId.replace('rank-', '').split('-').map(Number);
  return monthBoundary(Date.UTC(y, m - 1, 1) - 86_400_000).id;
}
// Where a month in the RP era starts: last month's points three tiers lower, when last month was
// in the RP era too and this player played it; otherwise 0.
export function rpCarry(user, season) {
  if (!rpEraFor(season)) return 0;
  const before = monthBefore(season);
  if (!rpEraFor(before)) return 0;
  const last = user.rp?.season === before ? user.rp.points : user.rp?.prev?.season === before ? user.rp.prev.points : 0;
  const at = RANK_TIERS.indexOf(rpTierFor(last || 0));
  return Math.max(0, at - RP_CARRY_DROP) * RP_TIER_STEP;
}
// My points this month, read only (the month may not have rolled over on this record yet).
export function rpPointsNow(user, now = Date.now()) {
  const season = monthBoundary(now).id;
  return user?.rp?.season === season ? user.rp.points || 0 : rpCarry(user || {}, season);
}

export function rpOf(user, now = Date.now()) {
  const season = monthBoundary(now).id;
  if (!user.rp || typeof user.rp !== 'object' || user.rp.season !== season) {
    const prev = user.rp?.season && user.rp.season < season ? { season: user.rp.season, points: user.rp.points || 0, peak: user.rp.peak || 0 } : user.rp?.prev ?? null;
    const start = rpCarry(user, season);
    user.rp = { season, points: start, peak: start, rounds: 0, day: dayKey(now), dayGain: 0, last: null, ...(start ? { carried: start } : {}), ...(prev ? { prev } : {}) };
  }
  if (user.rp.day !== dayKey(now)) { user.rp.day = dayKey(now); user.rp.dayGain = 0; }
  return user.rp;
}

// One round of an open 승급전: counts when the bet reached the series' minimum and wasn't a push.
function notePromo(rp, { stake, netPnl }, now) {
  const promo = rp.promo;
  if (!promo?.active) return;
  const start = RANK_TIERS.findIndex(t => t.id === promo.target) * RP_TIER_STEP;
  if (stake >= promo.minStake && netPnl) { if (netPnl > 0) promo.wins++; else promo.losses++; }
  const at = new Date(now).toISOString();
  if (promo.wins >= PROMO_WINS || rp.points >= start) {
    rp.points = Math.max(rp.points, start);
    rp.peak = Math.max(rp.peak, rp.points);
    rp.promo = { ...promo, active: false, result: 'won', at };
  } else if (promo.losses >= PROMO_LOSSES) rp.promo = { ...promo, active: false, result: 'lost', at };
}

// Every settled round (lib/economy.mjs updateStats).
export function noteRp(user, { game, stake, netPnl }, now = Date.now()) {
  const rp = rpOf(user, now);
  let delta = rpForRound({ stake, netPnl, points: rp.points });
  if (delta < 0) delta = Math.max(delta, -rp.points);
  delta = tenth(delta) || 0;
  rp.rounds++;
  if (delta > 0) rp.dayGain = tenth(rp.dayGain + delta);
  rp.points = tenth(rp.points + delta);
  rp.peak = Math.max(rp.peak, rp.points);
  rp.last = { delta, game, at: new Date(now).toISOString() };
  notePromo(rp, { stake, netPnl }, now);
  // The week's RP, kept apart from the month's points so a week that spans two months still adds up.
  const week = rpWeekOf(now).id;
  if (user.rpWeek?.id !== week) user.rpWeek = { id: week, net: 0, rounds: 0, first: new Date(now).toISOString() };
  user.rpWeek.net = tenth(user.rpWeek.net + delta);
  user.rpWeek.rounds++;
  return delta;
}

// My RP on the screens: points, tier, the next one, today's gains.
export function rpView(user, now = Date.now()) {
  const season = monthBoundary(now);
  const rp = user.rp?.season === season.id ? user.rp : null;
  const points = rpPointsNow(user, now), tier = rpTierFor(points);
  const step = rpNextStep(points);
  return {
    season: season.id, points: Math.floor(points), peak: Math.floor(rp?.peak || 0), rounds: rp?.rounds || 0,
    tier: tier.id, division: rpDivision(points), next: step.next?.id ?? null, nextDivision: step.next?.division ?? null, toNext: step.next?.need ?? 0,
    progress: step.progress,
    today: rp?.day === dayKey(now) ? Math.floor(rp.dayGain) : 0,
    last: rp?.last ?? null,
    era: rpTierEra(now), floors: rpEra(now), eraFrom, floorLevel: rpFloorLevel(points)
  };
}

// This month's RP board: everyone with a round played, best first (demo seats and guests left out).
export function rpStandings(state, now = Date.now(), skip = []) {
  const season = monthBoundary(now).id;
  return Object.values(state.users || {})
    .filter(u => !u.guest && !skip.includes(u.id) && (u.rp?.season === season ? u.rp.rounds > 0 || u.rp.points > 0 : rpPointsNow(u, now) > 0))
    .map(u => ({ id: u.id, nickname: u.nickname, value: Math.floor(rpPointsNow(u, now)) }))
    .sort((a, b) => b.value - a.value || a.nickname.localeCompare(b.nickname))
    .map((r, i) => ({ ...r, rank: i + 1, tier: rpTierFor(r.value).id, division: rpDivision(r.value) }));
}
export const rpBoard = (state, userId, now = Date.now(), skip = []) => rpStandings(state, now, skip).filter(r => r.rank <= 50 || r.id === userId);
