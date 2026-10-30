// What a player has already been shown: the terms they agreed to, each table's first-hand tips,
// the season warnings and moments, the bust receipt. The phone keeps these in localStorage, and
// the account keeps a copy here, so signing in on another phone doesn't start the player over.
// Keys are the client's own localStorage keys (public/js/seen.js lists which ones travel).

const KEY = /^vegas:[A-Za-z0-9:_.-]{1,100}$/;
const MAX_VALUE = 600;
const MAX_KEYS = 300;

// Values arrive as strings. An empty string forgets the key (설정 → 가이드 다시 보기).
export function noteSeen(user, flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new Error('BAD_REQUEST');
  const seen = user.shown && typeof user.shown === 'object' ? user.shown : (user.shown = {});
  for (const [key, raw] of Object.entries(flags).slice(0, 60)) {
    if (!KEY.test(key)) continue;
    const value = raw == null ? '' : String(raw).slice(0, MAX_VALUE);
    delete seen[key]; // re-inserted last, so the oldest keys go first when the list is full
    if (value) seen[key] = value;
  }
  const keys = Object.keys(seen);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete seen[key];
  return { seen: seenView(user) };
}

export const seenView = user => ({ ...(user.shown || {}) });
