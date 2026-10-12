// 핫 딜러 타임 on the client: which game is hot right now, and the next one, from the windows
// every server state carries (lib/hot-table.mjs), read against the server's clock.
let skew = 0;

export function hotStatus(state) {
  if (state?.serverTime && state !== hotStatus.seen) { hotStatus.seen = state; skew = Date.parse(state.serverTime) - Date.now(); }
  const now = Date.now() + skew;
  const windows = [state?.hotTable, state?.hotNext].filter(Boolean);
  const live = windows.find(w => now >= Date.parse(w.startsAt) && now < Date.parse(w.endsAt)) || null;
  const next = windows.find(w => now < Date.parse(w.startsAt)) || null;
  return { live, next, now };
}

// 452 seconds → "7:32".
export const clock = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export const pct = w => `+${Math.round((w?.bonus || 0) * 100)}%`;

// "15:00", in Korea time like the rest of the floor.
export const startTime = w => new Date(w.startsAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
