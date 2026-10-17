// 오류 기록: errors that happen on players' phones (sent by public/js/error-report.js) and server
// errors the API didn't expect, grouped by message and place, so the operator sees what breaks.
// Only the most recent groups are kept, so the shared state stays small.
export const ERROR_GROUPS_KEPT = 60;
const MAX_TEXT = 300, MAX_STACK = 1200;

const cut = (v, n) => String(v ?? '').slice(0, n);
const log = state => (Array.isArray(state.errorLog) ? state.errorLog : (state.errorLog = []));

// Adds one occurrence. source: 'client' | 'server'.
export function recordError(state, { source = 'client', message, stack, where, ua, build, userId = null }, now = Date.now()) {
  const msg = cut(message, MAX_TEXT).trim() || '(빈 오류)';
  const place = cut(where, 160);
  const key = `${source}|${msg}|${place}`;
  const list = log(state);
  let g = list.find(x => x.key === key);
  if (!g) {
    g = { key, source, message: msg, where: place, stack: cut(stack, MAX_STACK), count: 0, users: [], firstAt: now, lastAt: now, ua: cut(ua, 120), build: cut(build, 40) };
    list.push(g);
  }
  g.count += 1;
  g.lastAt = now;
  if (ua) g.ua = cut(ua, 120);
  if (build) g.build = cut(build, 40);
  if (userId && !g.users.includes(userId) && g.users.length < 20) g.users.push(userId);
  // Keep the groups seen most recently.
  if (list.length > ERROR_GROUPS_KEPT) {
    list.sort((a, b) => b.lastAt - a.lastAt);
    list.length = ERROR_GROUPS_KEPT;
  }
  return g;
}

// For the operator panel: newest first, with player names instead of ids.
export function errorLogView(state, limit = 30) {
  return [...log(state)].sort((a, b) => b.lastAt - a.lastAt).slice(0, limit).map(g => ({
    source: g.source, message: g.message, where: g.where, stack: g.stack, count: g.count,
    players: g.users.map(id => state.users[id]?.nickname ?? '?'), firstAt: g.firstAt, lastAt: g.lastAt, ua: g.ua, build: g.build
  }));
}

export function clearErrors(state) { state.errorLog = []; }

// An API error is "unexpected" when it isn't one of the game's own refusals (ALL_CAPS codes).
export const unexpected = e => !(e instanceof Error) || !/^[A-Z][A-Z0-9_]+$/.test(e.message || '');
