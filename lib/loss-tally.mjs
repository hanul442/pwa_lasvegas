// 오늘의 손익: what each player has won and lost at the tables since midnight in Seoul, kept as
// each round settles (lib/economy.mjs updateStats). The tables show the day's net under the
// wallet and on every losing banner, and a bust shows the whole day: how high the chips were,
// how much went, how many hands it took (한서 2026-10-27: "얼마 잃었는지 보여주는게 많았으면").
// The day also keeps its chip curve (one point a round, thinned past CURVE_MAX) for the bust
// chart and the 오늘의 손익 sheet, the net per game, and the month's totals.
const KST = 9 * 60 * 60 * 1000;
export const dayOf = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);
export const monthOf = (now = Date.now()) => dayOf(now).slice(0, 7);
// Minutes since midnight in Seoul.
const minuteOf = now => Math.floor(((now + KST) % 86_400_000) / 60_000);
export const CURVE_MAX = 96;

const fresh = (day, before, now) => ({ day, start: before, peak: before, peakAt: minuteOf(now), rounds: 0, losses: 0, won: 0, lost: 0, worst: 0, best: 0, losingRun: 0, winningRun: 0, high: 0, busts: 0, games: {}, curve: [[minuteOf(now), before]] });

// Past CURVE_MAX points, every other one goes; the day's high and the latest always stay.
export function thinCurve(curve) {
  if (curve.length <= CURVE_MAX) return curve;
  let top = 0;
  curve.forEach((p, i) => { if (p[1] >= curve[top][1]) top = i; });
  return curve.filter((p, i) => i % 2 === 0 || i === top || i === curve.length - 1);
}

// balance: chips (available + locked) after the round.
export function noteDay(user, { netPnl, balance, game = '' }, now = Date.now()) {
  if (!Number.isFinite(netPnl) || !Number.isFinite(balance)) return null;
  const day = dayOf(now);
  const d = user.today?.day === day ? user.today : fresh(day, balance - netPnl, now);
  d.rounds++;
  if (netPnl < 0) { d.losses = (d.losses || 0) + 1; d.lost += -netPnl; d.worst = Math.max(d.worst, -netPnl); d.losingRun++; d.winningRun = 0; }
  else if (netPnl > 0) { d.won += netPnl; d.best = Math.max(d.best, netPnl); d.losingRun = 0; d.winningRun = (d.winningRun || 0) + 1; }
  // high: the best the day's net ever stood at, so a bust can say "한때 +5억까지".
  d.high = Math.max(d.high || 0, d.won - d.lost);
  const before = balance - netPnl;
  if (Math.max(before, balance) > d.peak || d.peakAt == null) { d.peak = Math.max(d.peak, before, balance); d.peakAt = minuteOf(now); }
  if (game) {
    const g = ((d.games ||= {})[game] ||= { net: 0, rounds: 0 });
    g.net += netPnl; g.rounds++;
  }
  d.curve = thinCurve([...(Array.isArray(d.curve) ? d.curve : [[minuteOf(now), before]]), [minuteOf(now), balance]]);
  user.today = d;
  noteMonth(user, { netPnl }, now);
  return d;
}

function monthRow(user, now) {
  const month = monthOf(now);
  if (user.month?.month !== month) user.month = { month, won: 0, lost: 0, busts: 0, rounds: 0 };
  return user.month;
}

function noteMonth(user, { netPnl }, now) {
  const m = monthRow(user, now);
  m.rounds++;
  if (netPnl < 0) m.lost += -netPnl; else m.won += netPnl;
}

export function noteBust(user, now = Date.now()) {
  monthRow(user, now).busts++;
  const d = user.today?.day === dayOf(now) ? user.today : null;
  if (d) d.busts++;
  return d;
}

// Today's row for the client, or null once the day has turned.
export function todayView(user, now = Date.now()) {
  const d = user?.today;
  if (!d || d.day !== dayOf(now)) return null;
  return { ...d, games: { ...(d.games || {}) }, curve: [...(d.curve || [])], net: d.won - d.lost };
}

export function monthView(user, now = Date.now()) {
  const m = user?.month;
  if (!m || m.month !== monthOf(now)) return null;
  return { ...m, net: m.won - m.lost };
}
