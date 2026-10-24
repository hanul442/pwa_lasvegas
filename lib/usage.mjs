// 이용 현황 for the operator (한서 asked 2026-10-24 "얼마나 사용자가 사용하고 있는지"): who came
// each day, how many rounds of which game, and who signed up. Old ledger rows leave the live state
// (lib/history.mjs), so each day is counted as it happens and kept for 90 days; a player's own
// last rows and sign-up date stay in the state, so "last seen" and sign-ups go back to the start.
import { dayKey } from './engagement.mjs';
import { DEMO_PLAYERS } from './state.mjs';

const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 90;
const GAME_TYPES = new Set(['GAME_WIN', 'GAME_LOSS', 'GAME_PUSH']);
const counted = id => typeof id === 'string' && !DEMO_PLAYERS.includes(id);

// The first time: who was around on earlier days, from the rows each player still has (their last
// 50). Rounds are counted only from today, since most old rows have left.
function startUsage(state, now) {
  const days = {};
  for (const tx of state.ledger || []) {
    const at = Date.parse(tx.createdAt);
    if (!counted(tx.userId) || !Number.isFinite(at) || now - at > KEEP_DAYS * DAY) continue;
    const row = (days[dayKey(at)] ??= { users: [], rounds: {}, wagered: 0, partial: true });
    noteUser(row, tx.userId);
  }
  state.usage = { since: dayKey(now), days };
}

function dayRow(state, now) {
  if (!state.usage?.days) startUsage(state, now);
  const key = dayKey(now);
  const days = state.usage.days;
  if (days[key]?.partial) delete days[key].partial;
  if (!days[key]) {
    days[key] = { users: [], rounds: {}, wagered: 0 };
    const keys = Object.keys(days).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[old];
  }
  return days[key];
}

function noteUser(row, userId) { if (!row.users.includes(userId)) row.users.push(userId); }

// Every ledger row (lib/economy.mjs addLedger): the player was here; a settled round counts once.
export function noteUsage(state, tx, now = Date.now()) {
  if (!counted(tx?.userId)) return;
  const row = dayRow(state, now);
  noteUser(row, tx.userId);
  if (GAME_TYPES.has(tx.type)) {
    const game = String(tx.metadata?.game || '기타').slice(0, 40);
    row.rounds[game] = (row.rounds[game] || 0) + 1;
    const stake = Number(tx.metadata?.stake);
    if (Number.isFinite(stake) && stake > 0) row.wagered += stake;
  }
}

// The first look of a player's day (GET /api/state) also counts, even without a bet.
export const visitDue = (user, now = Date.now()) => counted(user?.id) && user.seen?.day !== dayKey(now);
export function noteVisit(state, user, now = Date.now()) {
  if (!counted(user?.id)) return;
  user.seen = { day: dayKey(now), at: new Date(now).toISOString() };
  noteUser(dayRow(state, now), user.id);
}

function lastSeenOf(state, user) {
  const tx = state.ledger.findLast(x => x.userId === user.id);
  return Math.max(tx ? Date.parse(tx.createdAt) : 0, user.seen?.at ? Date.parse(user.seen.at) : 0, user.push?.lastSeenAt ? Date.parse(user.push.lastSeenAt) : 0, user.createdAt ? Date.parse(user.createdAt) : 0);
}

// The operator's screen: headline counts, the last 14 days, games this week, and every player.
export function usageReport(state, now = Date.now()) {
  const players = Object.values(state.users || {}).filter(u => counted(u.id));
  const days = state.usage?.days || {};
  const seen = new Map(players.map(u => [u.id, lastSeenOf(state, u)]));
  const within = ms => players.filter(u => now - seen.get(u.id) < ms).length;
  const signupDay = u => (u.createdAt ? dayKey(Date.parse(u.createdAt)) : null);
  const daily = [];
  for (let i = 13; i >= 0; i--) {
    const key = dayKey(now - i * DAY);
    const row = days[key];
    const rounds = row && !row.partial ? Object.values(row.rounds).reduce((a, b) => a + b, 0) : null;
    daily.push({ day: key, active: row ? row.users.length : null, rounds, signups: players.filter(u => signupDay(u) === key).length });
  }
  const games = {};
  let weekRounds = 0;
  const weekUsers = new Set();
  for (let i = 0; i < 7; i++) {
    const row = days[dayKey(now - i * DAY)];
    if (!row) continue;
    row.users.forEach(id => weekUsers.add(id));
    for (const [g, n] of Object.entries(row.rounds)) { games[g] = (games[g] || 0) + n; weekRounds += n; }
  }
  const today = days[dayKey(now)];
  return {
    since: state.usage?.since ?? null,
    totals: {
      players: players.length,
      today: today ? today.users.length : within(DAY),
      week: within(7 * DAY),
      month: within(30 * DAY),
      now: within(10 * 60 * 1000),
      signupsWeek: players.filter(u => u.createdAt && now - Date.parse(u.createdAt) < 7 * DAY).length,
      roundsToday: today ? Object.values(today.rounds).reduce((a, b) => a + b, 0) : 0,
      roundsWeek: weekRounds
    },
    daily,
    games: Object.entries(games).map(([game, rounds]) => ({ game, rounds })).sort((a, b) => b.rounds - a.rounds),
    players: players
      .map(u => ({ id: u.id, nickname: u.nickname, joinedAt: u.createdAt ?? null, lastSeenAt: seen.get(u.id) ? new Date(seen.get(u.id)).toISOString() : null, worth: u.account.available + u.account.locked }))
      .sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0))
      .slice(0, 100)
  };
}
