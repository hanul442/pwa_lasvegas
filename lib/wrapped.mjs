// VEGAS 랩드 (한서, 2026-10-24): each player's month in a few story cards — rounds played, the game
// they kept coming back to, the best and the worst single round, the highest net worth and the
// tier it earned. Totals are kept as rounds settle (lib/economy.mjs), since old ledger rows leave
// the live state. When the month closes (lib/rank-season.mjs) a copy is frozen in wrappedHistory,
// so the summary survives the reset that follows.
import { monthBoundary, tierFor, FIRST_RANK_SEASON } from './rank-tier.mjs';

const KST = 9 * 60 * 60 * 1000;
const dayOf = now => new Date(now + KST).toISOString().slice(0, 10);
export const WRAPPED_KEEP = 12;

const blank = season => ({ season, rounds: 0, wins: 0, losses: 0, wagered: 0, pnl: 0, games: {}, best: null, worst: null, biggestBet: null, run: 0, bestRun: 0, days: 0, lastDay: null });

// The game came out in October, so the preseason month starts from the lifetime records the
// player already has (a month without them would miss most of October).
function seedFromStats(user, season) {
  const w = blank(season);
  for (const [game, s] of Object.entries(user.stats || {})) {
    if (!s?.rounds) continue;
    w.rounds += s.rounds; w.wins += s.wins || 0; w.losses += s.losses || 0; w.wagered += s.wagered || 0; w.pnl += s.pnl || 0;
    w.games[game] = { rounds: s.rounds, wins: s.wins || 0, pnl: s.pnl || 0, wagered: s.wagered || 0 };
    if (s.biggestWin > 0 && !(w.best?.pnl >= s.biggestWin)) w.best = { game, pnl: s.biggestWin, stake: null, at: null };
    if (s.biggestLoss > 0 && !(w.worst?.pnl <= -s.biggestLoss)) w.worst = { game, pnl: -s.biggestLoss, stake: null, at: null };
    if (s.biggestBet > 0 && !(w.biggestBet?.stake >= s.biggestBet)) w.biggestBet = { game, stake: s.biggestBet };
  }
  if (w.rounds) w.seeded = true;
  w.bestRun = user.streak?.best || 0;
  w.run = user.streak?.current || 0;
  return w;
}

// This month's record for a player, rolled over to a new one when the month has changed.
function monthRecord(user, now) {
  const id = monthBoundary(now).id;
  let w = user.wrapped;
  if (w && typeof w === 'object' && w.season === id) return w;
  if (w && typeof w === 'object' && w.season > id) return null; // a clock behind the record: leave it
  if (w && typeof w === 'object' && w.rounds) user.wrappedPrev = w; // kept until the season close freezes it
  // The first round of November for a player who never played since the totals began: their
  // October still comes from the lifetime records, before this round adds to them.
  if (!w && id !== FIRST_RANK_SEASON && !(user.wrappedHistory || []).some(h => h.season === FIRST_RANK_SEASON)) {
    const seed = seedFromStats(user, FIRST_RANK_SEASON);
    if (seed.rounds) user.wrappedPrev = seed;
  }
  w = user.wrapped = id === FIRST_RANK_SEASON && !w ? seedFromStats(user, id) : blank(id);
  return w;
}

// Every settled round (called before the lifetime stats count it, so a preseason seed doesn't count it twice).
export function noteWrapped(user, { game, stake, netPnl }, now = Date.now()) {
  const w = monthRecord(user, now);
  if (!w) return;
  const at = new Date(now).toISOString();
  w.rounds++; w.wagered += stake; w.pnl += netPnl;
  const g = (w.games[game] ??= { rounds: 0, wins: 0, pnl: 0, wagered: 0 });
  g.rounds++; g.wagered += stake; g.pnl += netPnl;
  if (netPnl > 0) { w.wins++; g.wins++; w.run++; w.bestRun = Math.max(w.bestRun, w.run); }
  else if (netPnl < 0) { w.losses++; w.run = 0; }
  if (netPnl > 0 && !(w.best?.pnl >= netPnl)) w.best = { game, pnl: netPnl, stake, at };
  if (netPnl < 0 && !(w.worst?.pnl <= netPnl)) w.worst = { game, pnl: netPnl, stake, at };
  if (!(w.biggestBet?.stake >= stake)) w.biggestBet = { game, stake };
  const day = dayOf(now);
  if (w.lastDay !== day) { w.days++; w.lastDay = day; }
}

// The cards' content: totals, the top games, and the rounds that stood out.
export function wrappedSummary(w) {
  if (!w || !w.rounds) return null;
  const games = Object.entries(w.games || {})
    .map(([game, g]) => ({ game, rounds: g.rounds, wins: g.wins, pnl: g.pnl, share: g.rounds / w.rounds }))
    .sort((a, b) => b.rounds - a.rounds || b.pnl - a.pnl);
  const multiple = r => (r?.stake > 0 ? Math.round((r.pnl / r.stake) * 10) / 10 : null);
  return {
    season: w.season,
    rounds: w.rounds, wins: w.wins, losses: w.losses,
    winRate: w.rounds ? w.wins / w.rounds : 0,
    wagered: w.wagered, pnl: w.pnl,
    games: games.slice(0, 5), gamesPlayed: games.length,
    best: w.best ? { ...w.best, multiple: multiple(w.best) } : null,
    worst: w.worst ? { ...w.worst } : null,
    biggestBet: w.biggestBet,
    bestRun: w.bestRun || 0,
    days: w.seeded ? null : w.days
  };
}

// Read only: a preseason player who hasn't played since the totals began still has a month.
const recordFor = (user, season) => (user.wrapped?.season === season ? user.wrapped
  : user.wrappedPrev?.season === season ? user.wrappedPrev
  : season === FIRST_RANK_SEASON && !user.wrapped ? seedFromStats(user, season) : null);

// The season close (lib/rank-season.mjs): the month's summary with its result, kept for good.
export function freezeWrapped(user, season, result = null) {
  const sum = wrappedSummary(recordFor(user, season.id));
  if (!sum && !result) return null;
  const peak = result?.peak ?? 0;
  const frozen = { ...(sum || { season: season.id, rounds: 0 }), season: season.id, name: season.name, peak, tier: result?.tier ?? tierFor(peak).id, rank: result?.rank ?? null, of: result?.of ?? null, ...(result?.rp != null ? { rp: result.rp } : {}) };
  const list = Array.isArray(user.wrappedHistory) ? user.wrappedHistory.filter(x => x.season !== season.id) : [];
  user.wrappedHistory = [frozen, ...list].slice(0, WRAPPED_KEEP);
  if (user.wrappedPrev?.season === season.id) delete user.wrappedPrev;
  return frozen;
}

// What the screens get: this month so far (with where I stand now) and the closed months.
export function wrappedView(user, { season, peak, tier, rank = null, of = null, rp = null }) {
  const live = wrappedSummary(recordFor(user, season.id));
  return {
    live: live ? { ...live, name: season.name, peak, tier, rank, of, ...(rp != null ? { rp } : {}), live: true } : null,
    history: (user.wrappedHistory || []).slice(0, WRAPPED_KEEP)
  };
}
