// 오늘의 손익: what each player has won and lost at the tables since midnight in Seoul, kept as
// each round settles (lib/economy.mjs updateStats). The tables show the day's net under the
// wallet and on every losing banner, and a bust shows the whole day: how high the chips were,
// how much went, how many hands it took (한서 2026-10-27: "얼마 잃었는지 보여주는게 많았으면").
const KST = 9 * 60 * 60 * 1000;
export const dayOf = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);

const fresh = (day, before) => ({ day, start: before, peak: before, rounds: 0, losses: 0, won: 0, lost: 0, worst: 0, best: 0, losingRun: 0, high: 0, busts: 0 });

// balance: chips (available + locked) after the round.
export function noteDay(user, { netPnl, balance }, now = Date.now()) {
  if (!Number.isFinite(netPnl) || !Number.isFinite(balance)) return null;
  const day = dayOf(now);
  const d = user.today?.day === day ? user.today : fresh(day, balance - netPnl);
  d.rounds++;
  if (netPnl < 0) { d.losses = (d.losses || 0) + 1; d.lost += -netPnl; d.worst = Math.max(d.worst, -netPnl); d.losingRun++; }
  else if (netPnl > 0) { d.won += netPnl; d.best = Math.max(d.best, netPnl); d.losingRun = 0; }
  // high: the best the day's net ever stood at, so a bust can say "한때 +5억까지".
  d.high = Math.max(d.high || 0, d.won - d.lost);
  d.peak = Math.max(d.peak, balance - netPnl, balance);
  user.today = d;
  return d;
}

export function noteBust(user, now = Date.now()) {
  const d = user.today?.day === dayOf(now) ? user.today : null;
  if (d) d.busts++;
  return d;
}

// Today's row for the client, or null once the day has turned.
export function todayView(user, now = Date.now()) {
  const d = user?.today;
  if (!d || d.day !== dayOf(now)) return null;
  return { ...d, net: d.won - d.lost };
}
