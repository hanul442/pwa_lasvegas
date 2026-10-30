// "Already shown" marks that follow the account, not the phone (lib/seen.mjs keeps the copy).
// Each mark still lives in localStorage under its usual key, so the code that reads it is the same;
// remember() also sends it to the server, and absorb() fills a new phone from the account's copy
// before the app decides what to show. Signing in elsewhere then skips what was already seen.
import { api, playerId } from './api.js';

// Which localStorage keys travel with the account. Settings, last tables and the like stay per phone.
const SYNCED = [
  'vegas:terms',           // 이용약관 version agreed to
  'vegas:guide:',          // each table's first-hand tips and coach
  'vegas:gesture-tip',     // "펠트를 톡 치면 히트" (count)
  'vegas:push-nags',       // how many times the push sheet was waved off (count)
  'vegas:luxury-refund',   // the 사치품 refund toast
  'vegas:season-warn:',    // 시즌 3일/1일 전 경고
  'vegas:rank-moment:',    // the season result card
  'vegas:league-moment:',  // the weekly league result card
  'vegas:tier-seen:',      // the tier-up card
  'vegas:seen-floors:',    // the "새 층이 열렸어요" moment
  'vegas:bust-seen:',      // the bust receipt
  'vegas:bailout-seen:'    // the 구제금융 note
];
const COUNTS = new Set(['vegas:gesture-tip', 'vegas:push-nags']);

export const isSynced = key => SYNCED.some(p => (p.endsWith(':') ? key.startsWith(p) : key === p));

// Marks scoped to a player end with that player's id; another account's marks on this phone stay here.
const SCOPED = /^vegas:(bust-seen|bailout-seen|seen-floors|season-warn|rank-moment|league-moment|tier-seen):/;
const ownedBy = (key, me) => !SCOPED.test(key) || key.endsWith(`:${me}`);

const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch {} };

let pending = {}, timer = null, absorbedFor = null;

function flush() {
  clearTimeout(timer);
  timer = null;
  const flags = pending;
  pending = {};
  if (!Object.keys(flags).length || !playerId()) return;
  api.seen(flags).catch(() => { pending = { ...flags, ...pending }; });
}
function send(key, value) {
  if (!isSynced(key)) return;
  pending[key] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, 1200);
}
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', flush);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

// Stores a mark on this phone and on the account. An empty value forgets it everywhere.
export function remember(key, value) {
  const v = value == null ? '' : String(value);
  write(key, v);
  send(key, v);
}

// The account's marks, from any state the server sends (js/api.js calls this before anyone else
// sees the state). A mark the account has wins on this phone; a count keeps the larger of the two.
// The first state after signing in also sends up what this phone saw before marks were kept on the
// account, so the phones a player already used teach the account.
export function absorb(state) {
  const seen = state?.seen;
  const me = state?.user?.id;
  if (!seen || typeof seen !== 'object' || !me) return;
  for (const [key, value] of Object.entries(seen)) {
    if (!isSynced(key) || typeof value !== 'string' || key in pending) continue;
    const here = read(key);
    if (COUNTS.has(key)) { if ((Number(here) || 0) < (Number(value) || 0)) write(key, value); }
    else if (here !== value) write(key, value);
  }
  if (absorbedFor === me) return;
  absorbedFor = me;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isSynced(key) || !ownedBy(key, me)) continue;
      const here = read(key);
      if (!here) continue;
      if (!(key in seen) || (COUNTS.has(key) && Number(here) > Number(seen[key]))) send(key, here);
    }
  } catch {}
}
