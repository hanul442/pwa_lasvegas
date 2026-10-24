// 핫 딜러 타임: every hour on the hour one solo house game turns "hot" for ten minutes, and every
// winning round settled there in that window pays HOT_BONUS more of its net win, house-funded,
// inside the same GAME_WIN ledger row (lib/economy.mjs). The schedule is worked out from the clock
// alone, so the Node server and the Cloudflare Worker agree without storing anything. Windows open
// at :00 so the hourly push cron (wrangler.toml "0 * * * *") lands right as a table turns hot.
import { isMoney, roundMoney } from './constants.mjs';

const HOUR = 3_600_000;
export const HOT_MINUTES = 10;
export const HOT_WINDOW = HOT_MINUTES * 60_000;
// Net win +50%, never more than the round's stake (a 35:1 straight-up or a slots line pays at most
// one extra stake), so the bonus stays a treat rather than the point of the game.
export const HOT_BONUS = 0.5;

// key: the client's game id; game: the name the settlement path uses; label: what players read.
export const HOT_GAMES = [
  { key: 'blackjack', game: 'Blackjack', label: '블랙잭' },
  { key: 'baccarat', game: 'Baccarat', label: '바카라' },
  { key: 'roulette', game: 'Roulette', label: '룰렛' },
  { key: 'dice', game: 'Sic Bo', label: '식보' },
  { key: 'slots', game: 'Slots', label: '슬롯' }
];

// A small integer mix (splitmix-style) so neighbouring hours land on unrelated games.
function mix(n) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

// The hot game of hour `h` (hours since the epoch). Each day (UTC) starts on a seeded game and
// every later hour steps to a different one, so no game is hot two hours running within a day.
export function hotGameOfHour(h) {
  const n = HOT_GAMES.length, day = h - (((h % 24) + 24) % 24);
  let k = mix(day) % n;
  for (let x = day + 1; x <= h; x++) k = (k + 1 + (mix(x) % (n - 1))) % n;
  return HOT_GAMES[k];
}

const windowOf = h => {
  const g = hotGameOfHour(h), startsAt = h * HOUR;
  return { game: g.key, name: g.game, label: g.label, startsAt, endsAt: startsAt + HOT_WINDOW, bonus: HOT_BONUS };
};

// Development and test hook: a forced game stays hot in rolling ten-minute windows, 'off' keeps every
// table cold (tests that count exact payouts), anything else returns to the clock. lib/api.mjs sets
// it from env.HOT_TABLE_FORCE outside production only.
let forced = null;
export function forceHotTable(key) { forced = key === 'off' || HOT_GAMES.some(g => g.key === key) ? key : null; }

// The window running at `now`, or null.
export function hotTableAt(now = Date.now()) {
  if (forced === 'off') return null;
  if (forced) {
    const g = HOT_GAMES.find(x => x.key === forced), startsAt = Math.floor(now / HOT_WINDOW) * HOT_WINDOW;
    return { game: g.key, name: g.game, label: g.label, startsAt, endsAt: startsAt + HOT_WINDOW, bonus: HOT_BONUS };
  }
  const w = windowOf(Math.floor(now / HOUR));
  return now >= w.startsAt && now < w.endsAt ? w : null;
}

// The next window that has not started yet.
export function nextHotTable(now = Date.now()) {
  const h = Math.floor(now / HOUR);
  return windowOf(now >= h * HOUR ? h + 1 : h);
}

const iso = w => w && { game: w.game, label: w.label, startsAt: new Date(w.startsAt).toISOString(), endsAt: new Date(w.endsAt).toISOString(), bonus: w.bonus };
// For the state payload: the hot table now (or null) and the one after it.
export const hotTableView = (now = Date.now()) => ({ hotTable: iso(hotTableAt(now)), hotNext: iso(nextHotTable(now)) });

// The extra a settled round earns: only a win, only at the hot game, only inside its window.
export function hotTableBonus(game, stake, netPnl, now = Date.now()) {
  if (!(netPnl > 0) || !(stake > 0)) return 0;
  const w = hotTableAt(now);
  if (!w || w.name !== game) return 0;
  return Math.max(0, Math.min(stake, (isMoney(stake) ? roundMoney(netPnl * HOT_BONUS) : Math.floor(netPnl * HOT_BONUS))));
}
