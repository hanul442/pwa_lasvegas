// Keeps the live floor state small. Every request reads the whole state and every bet writes it
// back, so settled rounds and old ledger rows that no screen reads any more are moved out into an
// archive (worker/index.mjs stores it under archive:* keys, never loaded again by the game).
// Nothing is deleted: the archive holds every row taken out.
import { canonicalActiveSeasonBoundary } from './seasons.mjs';
import { freezeChallengeScores } from './social-competition.mjs';
import { weekBoundary } from './engagement.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const COMPACT_EVERY = HOUR;
// Settled rounds are only read back for retries of the same request (seconds) and the last round
// at each game (the blackjack table keeps its AI players), so a day is plenty.
export const ROUND_KEEP = DAY;
// Ledger rows feed the weekly ranking (this week and last week's payout), duels (a week) and the
// profile's history (the last 50 per player); two weeks and a day covers all of it.
export const LEDGER_KEEP = 15 * DAY;
export const LEDGER_PER_USER = 50;

const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : 0; };

function ledgerCutoff(state, now) {
  let cutoff = Math.min(now - LEDGER_KEEP, time(weekBoundary(now - 7 * DAY).startsAt));
  const season = canonicalActiveSeasonBoundary(state);
  if (season?.startsAt) cutoff = Math.min(cutoff, time(season.startsAt));
  for (const c of state.socialCompetition?.challenges || []) {
    if (c?.status === 'ACTIVE' && c.startsAt) cutoff = Math.min(cutoff, time(c.startsAt));
  }
  return cutoff;
}

// Moves cold history out of `state` and returns it ({ ledger, rounds }), or null when nothing moved
// or the last pass was under an hour ago.
export function compactHistory(state, now = Date.now()) {
  state.meta ??= {};
  if (now - time(state.meta.compactedAt) < COMPACT_EVERY) return null;
  state.meta.compactedAt = new Date(now).toISOString();

  // Finished duels keep their scores before the rows behind them leave.
  for (const c of state.socialCompetition?.challenges || []) if (c?.status === 'COMPLETED') freezeChallengeScores(state, c);

  const rounds = [];
  if (Array.isArray(state.rounds)) {
    const newest = new Set();
    const keep = [];
    for (let i = state.rounds.length - 1; i >= 0; i--) {
      const r = state.rounds[i];
      const key = `${r?.userId}|${r?.game}`;
      const last = !newest.has(key);
      newest.add(key);
      const cold = r && r.status === 'SETTLED' && typeof r.userId === 'string' && !last && now - time(r.settledAt || r.createdAt) > ROUND_KEEP;
      (cold ? rounds : keep).push(r);
    }
    if (rounds.length) { state.rounds = keep.reverse(); rounds.reverse(); }
  }

  const ledger = [];
  if (Array.isArray(state.ledger)) {
    const cutoff = ledgerCutoff(state, now);
    const seen = {};
    const keep = [];
    for (let i = state.ledger.length - 1; i >= 0; i--) {
      const tx = state.ledger[i];
      const uid = tx?.userId;
      const recent = (seen[uid] = (seen[uid] || 0) + 1) <= LEDGER_PER_USER;
      const cold = tx && !recent && tx.referenceType !== 'ADMIN_PANEL' && time(tx.createdAt) < cutoff;
      (cold ? ledger : keep).push(tx);
    }
    if (ledger.length) { state.ledger = keep.reverse(); ledger.reverse(); }
  }

  if (!rounds.length && !ledger.length) return null;
  state.meta.archived = {
    rounds: (state.meta.archived?.rounds || 0) + rounds.length,
    ledger: (state.meta.archived?.ledger || 0) + ledger.length,
    lastAt: state.meta.compactedAt
  };
  return { ledger, rounds };
}
