// Running totals of game results, kept as each ledger row is written, so the weekly ranking and
// friends' duels never have to re-read the ledger. That lets old ledger rows leave the live state
// (lib/history.mjs) and keeps every request the same size however long people have played.
import { weekBoundary } from './engagement.mjs';

const GAME_TYPES = new Set(['GAME_WIN', 'GAME_LOSS', 'GAME_PUSH']);
const WEEK = 7 * 24 * 60 * 60 * 1000;
// This week and last week (paid out on the first change of a new week), plus one to spare.
const WEEKS_KEPT = 3;

const pnlOf = tx => Number(tx.qualifiedPnlDelta ?? tx.rawPnlDelta ?? 0);

function addToWeek(weeks, tx) {
  const at = Date.parse(tx.createdAt);
  if (!Number.isFinite(at)) return;
  const id = weekBoundary(at).id;
  const wagered = Number(tx.metadata?.stake);
  const pnl = pnlOf(tx);
  if (!Number.isFinite(wagered) || wagered < 0 || !Number.isFinite(pnl)) return;
  const week = (weeks[id] ??= {});
  const row = (week[tx.userId] ??= { profit: 0, wagered: 0, wins: 0 });
  row.profit += pnl; row.wagered += wagered; if (tx.type === 'GAME_WIN' && pnl > 0) row.wins += 1;
}

function addToDuels(state, tx) {
  const at = Date.parse(tx.createdAt);
  for (const c of state.socialCompetition?.challenges || []) {
    if (c?.status !== 'ACTIVE' || !c.liveScores || (c.challengerId !== tx.userId && c.opponentId !== tx.userId)) continue;
    const start = Date.parse(c.startsAt);
    const end = c.endsAt ? Date.parse(c.endsAt) : Infinity;
    if (!(at >= start && at < end)) continue;
    const pnl = pnlOf(tx);
    c.liveScores[tx.userId] = (c.liveScores[tx.userId] || 0) + (c.metric === 'WINS' ? (pnl > 0 ? 1 : 0) : pnl);
  }
}

// Called for every ledger row as it is written (lib/economy.mjs addLedger).
export function tallyRow(state, tx) {
  if (!state.tally || !GAME_TYPES.has(tx?.type) || typeof tx.userId !== 'string') return;
  addToWeek(state.tally.weeks, tx);
  addToDuels(state, tx);
}

// Starts the totals from the ledger rows still in the state, once; also gives a running duel that
// predates the totals its score so far. Runs before every change (lib/api.mjs).
export function ensureTally(state, now = Date.now()) {
  if (!state.tally || typeof state.tally.weeks !== 'object') {
    const weeks = {};
    const from = Date.parse(weekBoundary(now - WEEK).startsAt);
    for (const tx of state.ledger || []) {
      if (tx && GAME_TYPES.has(tx.type) && typeof tx.userId === 'string' && Date.parse(tx.createdAt) >= from) addToWeek(weeks, tx);
    }
    // `from`: the first week the totals cover in full.
    state.tally = { weeks, from: new Date(from).toISOString() };
  }
  for (const c of state.socialCompetition?.challenges || []) {
    if (c?.status !== 'ACTIVE' || c.liveScores) continue;
    c.liveScores = {};
    const start = Date.parse(c.startsAt);
    const end = c.endsAt ? Date.parse(c.endsAt) : Infinity;
    for (const tx of state.ledger || []) {
      if (!tx || !GAME_TYPES.has(tx.type) || (tx.userId !== c.challengerId && tx.userId !== c.opponentId)) continue;
      const at = Date.parse(tx.createdAt);
      if (!(at >= start && at < end)) continue;
      const pnl = pnlOf(tx);
      c.liveScores[tx.userId] = (c.liveScores[tx.userId] || 0) + (c.metric === 'WINS' ? (pnl > 0 ? 1 : 0) : pnl);
    }
  }
  const keep = new Set(Array.from({ length: WEEKS_KEPT }, (_, k) => weekBoundary(now - k * WEEK).id));
  for (const id of Object.keys(state.tally.weeks)) if (!keep.has(id)) delete state.tally.weeks[id];
  return state.tally;
}

// The week's totals per player, or null for a week the totals don't cover.
export function weekTotals(state, boundary) {
  const tally = state?.tally;
  if (!tally?.weeks || !(Date.parse(boundary.startsAt) >= Date.parse(tally.from))) return null;
  return structuredClone(tally.weeks[boundary.id] || {});
}
