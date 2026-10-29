// 관전: watching a friend's friends' room over their shoulder, their cards included. Nothing can be
// played or said from the rail. To keep the rail from feeding anyone at the table:
//   - the friend must count me as a friend (lib/friends.mjs), so nobody watches a stranger, and
//   - nobody else at the table may be my friend either way, so what I see has nobody to go to.
// Who is watching lives in memory (like presence), so the players see "👀 2명 관전 중".
import { friendMap } from './friends.mjs';

export const WATCHER_MS = 10_000; // a watcher's screen polls every 1.5 s
const rails = new Map(); // room code → Map(userId → { nickname, at })

export function noteWatcher(code, user, now = Date.now()) {
  if (!rails.has(code)) rails.set(code, new Map());
  rails.get(code).set(user.id, { nickname: user.nickname, at: now });
}

export function watchersOf(code, now = Date.now()) {
  const rail = rails.get(code);
  if (!rail) return [];
  for (const [id, w] of rail) if (now - w.at >= WATCHER_MS) rail.delete(id);
  if (!rail.size) { rails.delete(code); return []; }
  return [...rail].map(([userId, w]) => ({ userId, nickname: w.nickname }));
}
export function resetWatchers() { rails.clear(); }

// The room's people are its `players` (both friends' rooms and Hold'em rooms key them by user id).
export function watchRefusal(state, viewer, room, friendId) {
  if (!room.players?.[friendId]) return 'WATCH_GONE';
  if (room.players[viewer.id]) return 'WATCH_CONFLICT';
  const friend = state.users[friendId];
  if (!friend || !friendMap(state, friend).has(viewer.id)) return 'WATCH_NOT_FRIEND';
  const mine = friendMap(state, viewer);
  for (const id of Object.keys(room.players)) {
    if (id === friendId) continue;
    if (mine.has(id) || (state.users[id] && friendMap(state, state.users[id]).has(viewer.id))) return 'WATCH_CONFLICT';
  }
  return null;
}

export function assertCanWatch(state, viewer, room, friendId) {
  const why = watchRefusal(state, viewer, room, String(friendId || ''));
  if (why) throw new Error(why);
  return String(friendId);
}
