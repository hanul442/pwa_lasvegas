// 월간 랭크 시즌 (한서, 2026-10-17): every calendar month in Seoul is one season. A player's tier is
// set by the highest net worth they reach during it (chips minus debt), so going bust late in the
// month doesn't take a tier away. When a month ends everyone keeps a badge for the tier they
// reached (the top three get a 챌린저 badge too), then chips and debt start over and the
// floors close again: everyone climbs from the bottom. 꾸미기, nameplates, badges, achievements
// and records stay. The first reset is 2026-12-01 00:00 KST (October and November are one season).
// From 2026-10-29 (RP_TIER_FROM) the tier is the month's RP (lib/rank-points.mjs) instead:
// standings, badges and the podium count RP. From November (RP_ERA_FROM) a month's end also keeps
// the chips (only old loans are written off) and RP starts the next month three tiers lower.
import { addLedger } from './economy.mjs';
import { netWorth, debtOf, DEMO_PLAYERS } from './state.mjs';
import { FLOORS, MONEY_UNIT } from './constants.mjs';
import { pushFeed } from './engagement.mjs';
import { RANK_TIERS, tierFor, monthBoundary, notePeak, FIRST_RANK_SEASON } from './rank-tier.mjs';
import { freezeWrapped, wrappedView } from './wrapped.mjs';
import { rpEraFor, rpTierEraFor, rpTierFor, rpPointsNow, rpStandings, rpCarry, rpDivision, rpNextStep } from './rank-points.mjs';

export { RANK_TIERS, tierFor, monthBoundary, notePeak };
export const PODIUM = 3;
const DAY = 24 * 60 * 60 * 1000;

const peakOf = (user, seasonId) => Math.max(0, user.rank?.season === seasonId ? user.rank.peak || 0 : user.rank?.prev?.season === seasonId ? user.rank.prev.peak || 0 : 0);
// Worth right now as the rank counts it: nothing while in debt (lib/economy.mjs notes peaks the same way).
const rankWorth = user => (debtOf(user) > 0 ? 0 : netWorth(user));
const players = state => Object.values(state.users || {}).filter(u => !DEMO_PLAYERS.includes(u.id) && !u.guest);

// This season's standings: everyone with a peak this month, best first.
export function rankStandings(state, now = Date.now()) {
  const season = monthBoundary(now);
  if (rpTierEraFor(season.id)) return rpStandings(state, now, DEMO_PLAYERS);
  return players(state)
    .map(u => ({ id: u.id, nickname: u.nickname, value: Math.max(peakOf(u, season.id), rankWorth(u)) }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value || a.nickname.localeCompare(b.nickname))
    .map((r, i) => ({ ...r, rank: i + 1, tier: tierFor(r.value).id }));
}

// Rows for the ranking screen: the top fifty and my own row.
export function rankBoard(state, userId, now = Date.now()) {
  const rows = rankStandings(state, now);
  return rows.filter(r => r.rank <= 50 || r.id === userId);
}

// What a player's screens show: the season, my tier and the next one, and past results.
export function rankView(state, user, now = Date.now()) {
  const season = monthBoundary(now);
  const seasonInfo = { id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt, preseason: season.id === FIRST_RANK_SEASON };
  const shared = { best: user.rank?.best ?? null, last: state.meta?.lastRankSeason ? lastSeasonView(state, user) : null, history: (user.rankHistory || []).slice(0, 12) };
  if (rpTierEraFor(season.id)) {
    const points = Math.floor(rpPointsNow(user, now)), tier = rpTierFor(points), step = rpNextStep(points);
    return {
      mode: 'rp', carry: rpEraFor(season.id), season: seasonInfo, rp: points, peak: Math.max(peakOf(user, season.id), rankWorth(user)), worth: netWorth(user), tier: tier.id, division: rpDivision(points),
      next: step.next, progress: step.progress,
      ...shared
    };
  }
  // Read only: a view never rewrites the record (the new month may not have been settled yet).
  const peak = Math.max(peakOf(user, season.id), rankWorth(user));
  const tier = tierFor(peak);
  const next = RANK_TIERS[RANK_TIERS.indexOf(tier) + 1] || null;
  const from = tier.min, to = next?.min ?? null;
  return {
    season: { id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt, preseason: season.id === FIRST_RANK_SEASON },
    peak, worth: netWorth(user), tier: tier.id,
    next: next ? { id: next.id, need: Math.max(0, next.min - peak) } : null,
    progress: to ? Math.min(1, Math.max(0, (Math.log10(Math.max(peak, 1)) - Math.log10(Math.max(from, 1))) / (Math.log10(to) - Math.log10(Math.max(from, 1))))) : 1,
    best: user.rank?.best ?? null,
    last: state.meta?.lastRankSeason ? lastSeasonView(state, user) : null,
    history: (user.rankHistory || []).slice(0, 12)
  };
}

// VEGAS 랩드 (lib/wrapped.mjs): this month so far, with where I stand, and the months gone by.
export function wrappedFor(state, user, now = Date.now()) {
  const season = monthBoundary(now);
  const peak = Math.max(peakOf(user, season.id), rankWorth(user));
  const rows = rankStandings(state, now);
  const mine = rows.find(r => r.id === user.id);
  const tier = rpTierEraFor(season.id) ? rpTierFor(rpPointsNow(user, now)) : tierFor(peak);
  return wrappedView(user, { season, peak, tier: tier.id, rank: mine?.rank ?? null, of: rows.length || null });
}

// True once a month has ended that nobody has closed yet (the state screen closes it on first look).
export function rankSeasonDue(state, now = Date.now()) {
  const current = monthBoundary(now);
  const prev = monthBoundary(Date.parse(current.startsAt) - DAY);
  const since = state.meta?.rankSince;
  if (!since || prev.id < since) return false;
  return !(state.meta.rankSeasonsSettled || []).includes(prev.id);
}

// The season that closed last: the podium, my result in it, and what the fresh start took from me.
function lastSeasonView(state, user) {
  const last = state.meta.lastRankSeason;
  const mine = (user.rankHistory || []).find(h => h.season === last.id) ?? null;
  const r = user.rank?.reset;
  const reset = r?.season === last.id ? { chips: r.chips, loans: r.loans, ...(r.mode ? { mode: r.mode, carry: r.carry } : {}) } : null;
  return { id: last.id, name: last.name, mode: last.mode ?? 'worth', podium: last.podium, mine, reset };
}

// The first state change of a new month closes the month before: badges, then the fresh start.
export function settleFinishedRankSeason(state, now = Date.now()) {
  const current = monthBoundary(now);
  const prev = monthBoundary(Date.parse(current.startsAt) - DAY);
  state.meta ??= {};
  // A casino counts seasons from the month it first saw (a fresh state never closes old months).
  if (!state.meta.rankSince) state.meta.rankSince = current.id < FIRST_RANK_SEASON ? FIRST_RANK_SEASON : current.id;
  if (prev.id < state.meta.rankSince) return null;
  const done = Array.isArray(state.meta.rankSeasonsSettled) ? state.meta.rankSeasonsSettled : [];
  if (done.includes(prev.id)) return null;
  state.meta.rankSeasonsSettled = [...done, prev.id].slice(-24);

  // An RP month ranks by the month's RP (its last points, read before anything rolls over).
  const rpMonth = rpTierEraFor(prev.id);
  const rpOfMonth = u => Math.floor(u.rp?.season === prev.id ? u.rp.points || 0 : u.rp?.prev?.season === prev.id ? u.rp.prev.points || 0 : 0);
  const playedRp = u => (u.rp?.season === prev.id ? u.rp.rounds > 0 || u.rp.points > 0 : u.rp?.prev?.season === prev.id);
  const standings = rpMonth
    ? players(state).filter(playedRp).map(u => ({ u, peak: peakOf(u, prev.id), rp: rpOfMonth(u) }))
      .sort((a, b) => b.rp - a.rp || a.u.nickname.localeCompare(b.u.nickname))
    : players(state)
      .map(u => ({ u, peak: peakOf(u, prev.id) }))
      .filter(x => x.peak > 0)
      .sort((a, b) => b.peak - a.peak || a.u.nickname.localeCompare(b.u.nickname));
  const tierOf = x => (rpMonth ? rpTierFor(x.rp) : tierFor(x.peak));
  const podium = standings.slice(0, PODIUM).map((x, i) => ({ rank: i + 1, userId: x.u.id, nickname: x.u.nickname, peak: x.peak, tier: tierOf(x).id, ...(rpMonth ? { rp: x.rp, division: rpDivision(x.rp) } : {}) }));
  standings.forEach((x, i) => {
    const tier = tierOf(x);
    const result = { season: prev.id, name: prev.name, tier: tier.id, peak: x.peak, rank: i + 1, of: standings.length, ...(rpMonth ? { rp: x.rp, division: rpDivision(x.rp) } : {}) };
    x.u.rankHistory = [result, ...(Array.isArray(x.u.rankHistory) ? x.u.rankHistory : [])].slice(0, 24);
    freezeWrapped(x.u, prev, result);
    const best = x.u.rank?.best;
    if (!best || RANK_TIERS.findIndex(t => t.id === tier.id) > RANK_TIERS.findIndex(t => t.id === best.tier)) x.u.rank = { ...x.u.rank, best: { tier: tier.id, season: prev.id, name: prev.name } };
    x.u.badges = Array.isArray(x.u.badges) ? x.u.badges : [];
    x.u.badges.unshift({ kind: 'RANK', tier: tier.id, ...(rpMonth ? { division: rpDivision(x.rp) } : {}), rank: i < PODIUM ? i + 1 : null, seasonId: prev.id, name: prev.name, at: new Date(now).toISOString() });
    if (x.u.badges.length > 40) x.u.badges.length = 40;
  });
  // VEGAS 랩드 for players who played but never had a peak above zero.
  const ranked = new Set(standings.map(x => x.u.id));
  for (const u of players(state)) if (!ranked.has(u.id)) freezeWrapped(u, prev);
  if (podium[0]) pushFeed(state, { type: 'RANK_CHAMPION', actorId: podium[0].userId, amount: podium[0].peak, season: prev.name, ...(rpMonth ? { rp: podium[0].rp } : {}) });

  // Guests start over too: they don't rank, but a guest who picks a name keeps what they hold.
  for (const u of Object.values(state.users || {})) if (!DEMO_PLAYERS.includes(u.id)) (rpEraFor(prev.id) ? carryForSeason : resetForSeason)(state, u, prev, current);
  state.meta.lastRankSeason = { id: prev.id, name: prev.name, mode: rpMonth ? 'rp' : 'worth', podium, settledAt: new Date(now).toISOString() };
  return state.meta.lastRankSeason;
}

// The fresh start: chips in the wallet go back to the house, and so do chips still on a table, as
// they come off it (account.seasonOwed, lib/economy.mjs); loans are cleared, the floors
// and this month's floor passes close again down to the Gold Room.
function resetForSeason(state, user, prev, current) {
  const chips = user.account.available;
  const loans = Array.isArray(user.loans) ? user.loans.length : 0;
  user.loans = [];
  if (user.credit && typeof user.credit === 'object') user.credit.score = 500;
  user.account.unlockedFloors = [FLOORS[0].slug];
  user.account.floorPasses = [];
  user.account.seasonOwed = (user.account.seasonOwed || 0) + Math.max(0, user.account.locked);
  // A ledger row even at zero, so the 칩 내역 shows the new season began.
  addLedger(state, user, { type: 'SEASON_RESET', amount: -chips, referenceType: 'RANK_SEASON', referenceId: prev.id, metadata: { season: prev.name, next: current.name, loans, unit: MONEY_UNIT } });
  user.rank = { season: current.id, peak: Math.max(0, netWorth(user)), best: user.rank?.best ?? null, reset: { season: prev.id, chips, loans } };
}

// The end of an RP month: chips stay (they only buy seats now), loans left from before the bank
// closed are written off, and RP starts the new month three tiers lower (lib/rank-points.mjs rpOf).
function carryForSeason(state, user, prev, current) {
  const loans = Array.isArray(user.loans) ? user.loans.length : 0;
  user.loans = [];
  if (user.credit && typeof user.credit === 'object') user.credit.score = 500;
  const carry = rpCarry(user, current.id);
  addLedger(state, user, { type: 'SEASON_RESET', amount: 0, referenceType: 'RANK_SEASON', referenceId: prev.id, metadata: { season: prev.name, next: current.name, loans, mode: 'rp', carry, unit: MONEY_UNIT } });
  user.rank = { season: current.id, peak: Math.max(0, netWorth(user)), best: user.rank?.best ?? null, reset: { season: prev.id, chips: 0, loans, mode: 'rp', carry } };
}
