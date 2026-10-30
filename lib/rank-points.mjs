// RP (랭크 점수), the economy's new yardstick (2026-10-29, 한서 picked "C: RP 티어 + 주간 리그").
// Chips measure how much a player has; RP measures how they play. Every settled round moves RP
// by what it won or lost *relative to its own bet*, so a bigger bet never buys a bigger score and
// going all-in doesn't win a tier. Losses count three quarters of a win, so steady play climbs
// slowly even against the house edge, while long shots (a roulette straight-up) still drain RP.
// Rounds and days have no cap (한서 removed both on 2026-10-29).
// A win on a floor below the one the player's RP tier belongs to counts 0.5× (2026-10-30: no more 1.5×
// above it).
// It became the tier on 2026-10-29 (RP_TIER_FROM below).
// Plain data in, plain data out; no imports that would cycle back through the ledger.
import { RANK_TIERS, monthBoundary } from './rank-tier.mjs';
import { FLOORS, LEGACY_ECONOMY } from './constants.mjs';

export const RP_PER_STAKE = 10;       // a round that wins its own bet back is +10
// Losses and wins by tier: RP_WIN_BY_TIER / RP_LOSS_BY_TIER below (아이언 loses 7.5 per lost bet).
// 2026-10-29 한서 "한판당 rp 상한이랑 하루 rp상한" 없애: no cap on a round or a day any more.
export const RP_DOWN_FLOOR = 0.5;
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
// RP is whole points (2026-10-30 한서 "소숫점 없애는게나을듯").
const whole = x => Math.round(x) || 0;

// Where each tier starts (2026-10-29, 한서 picked "둘 다" for 티어가 올라갈수록 어렵게): the tiers
// widen as they climb, 100 RP at the bottom to 400 at 그랜드마스터, on top of the smaller wins and
// bigger losses up high (RP_WIN_BY_TIER / RP_LOSS_BY_TIER).
// 2026-10-29 한서 "레전드로 올라가는거는 더 어렵게": 그랜드마스터 is 800 wide, so 레전드 starts at 2300.
export const RP_TIER_STARTS = [0, 100, 200, 350, 500, 700, 900, 1200, 1500, 2300];
const TOP_TIER_AT = RP_TIER_STARTS[RP_TIER_STARTS.length - 1];
export const rpTierStart = i => RP_TIER_STARTS[Math.max(0, Math.min(RP_TIER_STARTS.length - 1, i))];
export const rpTierIndex = points => { const p = Math.max(0, points || 0); let i = 0; while (i + 1 < RP_TIER_STARTS.length && p >= RP_TIER_STARTS[i + 1]) i++; return i; };
export const rpTierFor = points => RANK_TIERS[rpTierIndex(points)];

// 2026-10-29 한서 "티어도 아이언 4 3 2 로마자로": each tier below 레전드 splits into equal
// divisions; 2026-10-30 "디비전도 5개까지로 확장해": five, V (lowest) to I. Floors and the season
// carry still go by the whole tier.
export const RP_DIVISIONS = ['V', 'IV', 'III', 'II', 'I'];
const divisionStep = i => (rpTierStart(i + 1) - rpTierStart(i)) / RP_DIVISIONS.length;
export const rpDivision = points => {
  const p = Math.max(0, points || 0);
  if (p >= TOP_TIER_AT) return null;
  const i = rpTierIndex(p);
  return RP_DIVISIONS[Math.min(RP_DIVISIONS.length - 1, Math.floor((p - rpTierStart(i)) / divisionStep(i)))];
};
// The next step up (a division or, from I, the next tier's IV), what it takes, and how far along
// the current division I am.
// From division I the next tier only comes through its 승급전 (2026-10-30 한서 "승급전을 해야만
// 올라갈 수 있게"): `promo: true`, nothing left to earn, the bar full at the ceiling.
export function rpNextStep(points) {
  const p = Math.max(0, points || 0);
  if (p >= TOP_TIER_AT) return { next: null, progress: 1 };
  const i = rpTierIndex(p), step = divisionStep(i);
  const at = rpTierStart(i) + Math.floor((p - rpTierStart(i)) / step) * step, to = at + step;
  if (rpDivision(p) === 'I') return { next: { id: rpTierFor(to).id, division: rpDivision(to), need: 0, promo: true }, progress: Math.min(1, (p - at) / (step - 1)) };
  return { next: { id: rpTierFor(to).id, division: rpDivision(to), need: Math.max(0, Math.ceil(to - p)) }, progress: (p - at) / step };
}
// The most RP a tier can hold: one short of the next tier, which only a won 승급전 opens.
export const rpCeiling = points => { const i = rpTierIndex(points); return i + 1 < RP_TIER_STARTS.length ? rpTierStart(i + 1) - 1 : Infinity; };
// 승급전 (2026-10-29, 한서 "돈을 더 쓰게"): in a tier's top division (I) a player may pay
// PROMO_FEE_BETS of the next tier's floor minimum to play a best of five. Three wins on bets of at
// least their own floor's minimum lift them straight to the next tier; three losses end it, fee gone.
// Ordinary RP keeps counting during the series either way. A new season drops an open series.
// 2026-10-30 한서 "5판3선승제": best of five, three wins up, three losses out.
export const PROMO_WINS = 3, PROMO_LOSSES = 3, PROMO_FEE_BETS = 20;
export const promoTarget = points => {
  const p = Math.max(0, points || 0);
  if (p >= TOP_TIER_AT || rpDivision(p) !== 'I') return null;
  return RANK_TIERS[rpTierIndex(p) + 1];
};
const floorAt = level => FLOORS[Math.max(0, Math.min(FLOORS.length - 1, level))];
export const promoFee = target => floorAt(rpFloorLevel(rpTierStart(RANK_TIERS.indexOf(target)))).minBet * PROMO_FEE_BETS;
export const promoMinStake = points => floorAt(rpFloorLevel(points)).minBet;

// The floor an RP tier plays on: 아이언·브론즈 the Gold Room, then one floor per tier.
export const rpFloorLevel = points => Math.max(0, RANK_TIERS.indexOf(rpTierFor(points)) - 1);

// 베팅 상한 by division (2026-10-30 한서 picked "티어 안에서도 디비전별 상한"): on the floor a
// player's tier has just opened, the top bet grows with the division from the floor below's top
// bet (V) to this floor's own (I), in even steps. It started at 2× this floor's minimum, which sat
// under the floor below's top: going up a tier lowered the most one could bet (한서 "위로 올라가니까
// 금액 적어지는것도 잇음"). Floors are 3× apart with a 10× range, so the steps are the floor below's
// top × 1, 1.5, 2, 2.5, 3. Floors below (and the Gold Room for 아이언·브론즈) keep their full limit;
// event tables keep theirs (lib/stakes.mjs validateEventStake).
const DIVISION_STEP = { V: 0, IV: 1, III: 2, II: 3, I: 4 };
export function rpBetCap(points, floorIndex) {
  const f = FLOORS[floorIndex], below = FLOORS[floorIndex - 1];
  if (!f) return 0;
  const t = rpTierIndex(points), division = rpDivision(points);
  if (t < 2 || floorIndex !== t - 1 || !division || !below) return f.maxBet;
  const lo = Math.max(f.minBet, below.maxBet);
  return Math.min(f.maxBet, Math.round(lo + (f.maxBet - lo) * DIVISION_STEP[division] / 4));
}
// The same steps as multiples of the floor's minimum, for the rules card (3.3× … 10×).
export const RP_DIVISION_BET_TIMES = Object.fromEntries(Object.keys(DIVISION_STEP).map(d => [d, Math.round(rpBetCap(RP_TIER_STARTS[2] + (RP_TIER_STARTS[3] - RP_TIER_STARTS[2]) * DIVISION_STEP[d] / 5, 1) / FLOORS[1].minBet * 10) / 10]));
// Every floor's top bet for me, keyed by slug (the screens show the lower one).
export const rpBetCaps = points => Object.fromEntries(FLOORS.map((f, i) => [f.slug, rpBetCap(points, i)]));

// The floor a bet counts for: the most expensive floor whose minimum it covers, never above my own
// floor (2026-10-30). The old rule (the cheapest floor whose maximum reaches it) counted a minimum
// bet on a newly opened floor as the floor below, at half RP, and with the division caps a V
// player could not bet past that line at all. Capping at my own floor also ends the 1.5× for
// playing above it (event tables open to anyone; a player can't sit above their floor otherwise).
export const rpLevelForStake = stake => { let i = 0; while (i + 1 < FLOORS.length && stake >= FLOORS[i + 1].minBet) i++; return i; };

// What one round is worth in RP, before the day's cap.
// The climb gets steeper (2026-10-29, 한서 "티어가 올라갈수록 올라가기 어렵게"): by the tier the
// player stands in, a win counts less and a loss costs more. 아이언·브론즈 play as before.
// Eased the same day (한서 "티어 올리기 좀 어려운거 같은데 ... 50대 50? 그리고 레전드로 올라가는거는 더
// 어렵게"): 실버 to 마스터 a win and a loss of the same bet now move RP by the same amount, 아이언·브론즈
// keep the 3/4 loss, and only 그랜드마스터 (the climb to 레전드) and 레전드 stay steep.
// 2026-10-30: at 0.6/1.2 nobody could reach 레전드 (climb sim), so 한서 picked 1:1 for 그랜드마스터
// too; its 800-RP width alone keeps 레전드 the longest climb (about 8,700 blackjack hands).
export const RP_WIN_BY_TIER = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5];
export const RP_LOSS_BY_TIER = [0.75, 0.75, 1, 1, 1, 1, 1, 1, 1, 1.3];

// 배당 상한 (2026-10-30, 한서 "배당 상한을 넣자" → "그냥 룰렛 슬롯만 막자"): at roulette (lightning
// included) and slots a win counts for RP up to RP_PAYOUT_CAP times its bet. A lightning straight-up
// (up to 499×) or a slot jackpot used to be worth thousands of RP in one spin; now at most +30,
// while the miss still costs a full bet. Every other game counts its whole win.
export const RP_PAYOUT_CAP = 3;
export const RP_CAPPED_GAMES = new Set(['Roulette', 'Slots']);

export function rpForRound({ stake, netPnl, points = 0, game = null }) {
  if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(netPnl) || netPnl === 0) return 0;
  const ratio = RP_CAPPED_GAMES.has(game) ? Math.min(netPnl / stake, RP_PAYOUT_CAP) : netPnl / stake, at = rpTierIndex(points);
  if (ratio < 0) return whole(ratio * RP_PER_STAKE * RP_LOSS_BY_TIER[at]);
  const home = Math.min(FLOORS.length - 1, rpFloorLevel(points)), level = Math.min(home, rpLevelForStake(stake));
  const floor = level < home ? RP_DOWN_FLOOR : 1;
  return whole(ratio * RP_PER_STAKE * floor * RP_WIN_BY_TIER[at]);
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
  return rpTierStart(Math.max(0, at - RP_CARRY_DROP));
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

// What makes a 승급전 round a win (2026-10-30, 한서 "ㅇㅋ"): at the house's instant tables the round
// has to win back about its whole bet (PROMO_WIN_SHARE; baccarat's banker pays 0.95). Spreading 35
// straight-ups over a roulette wheel used to "win" 35 spins in 37 and passed the series 99% of the
// time; now a cover like that wins only when the share it won is a real win, and its misses still
// count as losses. Card and poker games against the AI (a buy-in or a deposit, not one bet) count
// any win, as before. Rounds in a friend's room never count for the series either way: a friend
// could lose to me on purpose.
export const PROMO_WIN_SHARE = 0.9;
const PROMO_ANY_WIN = new Set(['Matgo', 'Gostop', 'Seotda', "Hold'em", 'Seven Poker']);
export function promoRoundResult({ game, stake, netPnl, room = false }) {
  if (room || !netPnl) return null;
  if (netPnl < 0) return 'loss';
  return PROMO_ANY_WIN.has(game) || netPnl >= stake * PROMO_WIN_SHARE ? 'win' : null;
}

// One round of an open 승급전: counts when the bet reached the series' minimum and wasn't a push.
function notePromo(rp, { game, stake, netPnl, room }, now) {
  const promo = rp.promo;
  if (!promo?.active) return;
  const start = rpTierStart(RANK_TIERS.findIndex(t => t.id === promo.target));
  const result = stake >= promo.minStake ? promoRoundResult({ game, stake, netPnl, room }) : null;
  if (result === 'win') promo.wins++; else if (result === 'loss') promo.losses++;
  // The order of results, for the five circles in the RP popup (W/L).
  if (result) promo.log = `${promo.log || ''}${result === 'win' ? 'W' : 'L'}`;
  const at = new Date(now).toISOString();
  if (promo.wins >= PROMO_WINS) {
    rp.points = Math.max(rp.points, start);
    rp.peak = Math.max(rp.peak, rp.points);
    rp.promo = { ...promo, active: false, result: 'won', at };
    return 'won';
  } else if (promo.losses >= PROMO_LOSSES) rp.promo = { ...promo, active: false, result: 'lost', at };
  return null;
}

// What a player has done with RP for good, past every season (lib/achievements.mjs reads it):
// the highest tier reached, 승급전 won, weekly league promotions, the best league, podiums.
export function rpRecordOf(user) {
  const r = user.rpRecord && typeof user.rpRecord === 'object' ? user.rpRecord : {};
  return { tier: r.tier || 0, promoWins: r.promoWins || 0, leagueUps: r.leagueUps || 0, league: r.league || 0, podiums: r.podiums || 0 };
}
export function noteRpRecord(user, change) {
  const r = rpRecordOf(user);
  user.rpRecord = { ...r, ...change(r) };
}
// The best tier this player has ever held: the record, or this season's or last season's peak.
export const rpBestTier = user => Math.max(rpRecordOf(user).tier, rpTierIndex(user.rp?.peak || 0), rpTierIndex(user.rp?.prev?.peak || 0));

// Every settled round (lib/economy.mjs updateStats).
// `room`: the round was played in a friend's room (no 승급전 wins or losses there).
export function noteRp(user, { game, stake, netPnl, room = false }, now = Date.now()) {
  const rp = rpOf(user, now);
  let delta = rpForRound({ stake, netPnl, points: rp.points, game });
  if (delta < 0) delta = Math.max(delta, -rp.points);
  delta = whole(delta) || 0;
  // RP stops at the top of division I; what a round earns past it is not kept (rpCeiling).
  if (delta > 0) delta = Math.max(0, Math.min(delta, rpCeiling(rp.points) - rp.points));
  rp.rounds++;
  if (delta > 0) rp.dayGain = whole(rp.dayGain + delta);
  rp.points = whole(rp.points + delta);
  rp.peak = Math.max(rp.peak, rp.points);
  rp.last = { delta, game, at: new Date(now).toISOString() };
  const promo = notePromo(rp, { game, stake, netPnl, room }, now);
  const tier = rpTierIndex(rp.peak);
  if (promo || tier > rpRecordOf(user).tier) noteRpRecord(user, r => ({ tier: Math.max(r.tier, tier), promoWins: r.promoWins + (promo === 'won' ? 1 : 0) }));
  // The week's RP, kept apart from the month's points so a week that spans two months still adds up.
  const week = rpWeekOf(now).id;
  if (user.rpWeek?.id !== week) user.rpWeek = { id: week, net: 0, rounds: 0, first: new Date(now).toISOString() };
  user.rpWeek.net = whole(user.rpWeek.net + delta);
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
    tier: tier.id, division: rpDivision(points), next: step.next?.id ?? null, nextDivision: step.next?.division ?? null, toNext: step.next?.need ?? 0, nextPromo: Boolean(step.next?.promo),
    progress: step.progress,
    today: rp?.day === dayKey(now) ? Math.floor(rp.dayGain) : 0, starts: RP_TIER_STARTS,
    last: rp?.last ?? null,
    era: rpTierEra(now), floors: rpEra(now), eraFrom, floorLevel: rpFloorLevel(points),
    betCaps: rpEra(now) ? rpBetCaps(points) : null,
    // The numbers behind the rules card on the ranking tab, so it can't drift from the maths here.
    rules: { perStake: RP_PER_STAKE, winBy: RP_WIN_BY_TIER, lossBy: RP_LOSS_BY_TIER, downFloor: RP_DOWN_FLOOR, payoutCap: RP_PAYOUT_CAP, betTimes: RP_DIVISION_BET_TIMES }
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
