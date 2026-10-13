// Three-reel slot with one payline and a progressive jackpot shared by the whole floor.
// The VEGAS star is wild; three stars take the jackpot. Each spin feeds 2% of its stake
// into the pot. Base game returns about 90.7% (see tests), the pot adds the rest.
// 라이트닝 mode: the server strikes 1–3 of the nine cells in the window with 2×–50× before the
// reels stop, and a paying line through struck cells is multiplied (see LIGHTNING_* below).
import crypto from 'node:crypto';
import { id } from './state.mjs';
import { floorMoney } from './constants.mjs';

export const SLOT_SYMBOLS = ['STAR', 'SEVEN', 'BAR3', 'BAR2', 'BAR1', 'S', 'H', 'D', 'C'];
// Stops per symbol on each 64-stop reel.
export const REEL_WEIGHTS = { STAR: 2, SEVEN: 3, BAR3: 5, BAR2: 7, BAR1: 9, S: 9, H: 9, D: 10, C: 10 };
// Symbols spread along the reel (smooth weighted round-robin) so neighbours rarely repeat.
function reelStrip(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const current = Object.fromEntries(Object.keys(weights).map(k => [k, 0]));
  const out = [];
  for (let i = 0; i < total; i++) {
    for (const k in weights) current[k] += weights[k];
    const pick = Object.keys(weights).reduce((a, b) => (current[b] > current[a] ? b : a));
    current[pick] -= total;
    out.push(pick);
  }
  return out;
}
export const STRIP = reelStrip(REEL_WEIGHTS);
export const STOPS = STRIP.length;

const LINE = { SEVEN: 80, BAR3: 40, BAR2: 20, BAR1: 10, S: 6, H: 6, D: 6, C: 6, ANY_BAR: 4, COLOR: 2, TWO_STARS: 10, ONE_STAR: 1 };
// The lightning table's own pays, about a quarter of the plain ones, since a struck line pays
// several times over. A lone star pays nothing here. Wild stars still double or triple a line.
export const LIGHTNING_LINE = { SEVEN: 20, BAR3: 10, BAR2: 5, BAR1: 3, S: 2, H: 2, D: 2, C: 2, ANY_BAR: 1, COLOR: 1, TWO_STARS: 3, ONE_STAR: 0 };
export const JACKPOT_SEED = 5_000_000_000;
export const JACKPOT_RATE = 0.02;
// Three stars pay at most this many times the bet out of the pot, so a small spin can't empty it.
export const JACKPOT_STAKE_CAP = 10_000;
export const STAR_LINE = 500;

const isBar = s => s.startsWith('BAR');
const isSuit = s => s.length === 1;
const isRed = s => s === 'H' || s === 'D';

// Multiplier on the stake for a line (gross return), and a short name for it. Three stars pay
// STAR_LINE and the pot on either table; `lightning` only swaps in the lightning pay table.
export function slotLine(reels, { lightning = false } = {}) {
  const pay = lightning ? LIGHTNING_LINE : LINE;
  const stars = reels.filter(s => s === 'STAR').length;
  if (stars === 3) return { mult: STAR_LINE, name: 'JACKPOT', jackpot: true };
  const rest = reels.filter(s => s !== 'STAR');
  const wild = stars === 2 ? 3 : stars === 1 ? 2 : 1;
  if (rest.every(s => s === rest[0])) return { mult: pay[rest[0]] * wild, name: rest[0] };
  if (rest.every(isBar)) return { mult: pay.ANY_BAR * (stars ? 2 : 1), name: 'ANY_BAR' };
  if (rest.every(isSuit) && (rest.every(isRed) || rest.every(s => !isRed(s)))) return { mult: pay.COLOR * (stars ? 2 : 1), name: rest.every(isRed) ? 'ALL_RED' : 'ALL_BLACK' };
  if (stars === 2) return { mult: pay.TWO_STARS, name: 'TWO_STARS' };
  if (stars === 1 && pay.ONE_STAR) return { mult: pay.ONE_STAR, name: 'ONE_STAR' };
  return { mult: 0, name: null };
}

// ---------- 라이트닝 ----------
// Before the reels stop, 1 to 3 distinct cells of the 3×3 window are struck, each with a
// multiplier. A cell is { reel: 0–2, row: 0–2 }: row 0 above the payline, 1 on it, 2 below.
// Only struck cells on the payline (row 1) count, and since the one line runs through all three
// payline cells, every paying line is boosted by the SUM of the payline strikes (2× and 5× on
// the line make 7×) — adding keeps the top end sane where multiplying would reach 125,000×.
// Three stars are never boosted: the 500× line and the pot pay the same on either table.
// With these weights a line is struck about half the time and the lightning table returns about
// 91.6% against the plain table's 90.7% (tests/slots.test.mjs works both out exactly).
export const SLOT_LIGHTNING_MULTIPLIERS = [[2, 45], [3, 25], [5, 15], [10, 9], [25, 4], [50, 2]];
export const SLOT_LIGHTNING_STRIKE_COUNTS = [[1, 50], [2, 30], [3, 20]];
const CELLS = 9;
function weighted(table, rand) {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let r = rand(total);
  for (const [v, w] of table) { if (r < w) return v; r -= w; }
  return table[table.length - 1][0];
}
export function rollSlotLightning(rand = n => crypto.randomInt(0, n)) {
  const count = weighted(SLOT_LIGHTNING_STRIKE_COUNTS, rand);
  const picked = new Set();
  while (picked.size < count) picked.add(rand(CELLS));
  return [...picked].sort((a, b) => a - b).map(c => ({ reel: c % 3, row: Math.floor(c / 3), multiplier: weighted(SLOT_LIGHTNING_MULTIPLIERS, rand) }));
}
// `lightning` is falsy (the plain table), true (roll the strikes now) or strikes already rolled.
export function slotStrikes(lightning, rand) {
  if (!lightning) return null;
  const strikes = lightning === true ? rollSlotLightning(rand) : lightning;
  const allowed = new Set(SLOT_LIGHTNING_MULTIPLIERS.map(([m]) => m));
  if (!Array.isArray(strikes) || strikes.length < 1 || strikes.length > 3) throw new Error('INVALID_LIGHTNING');
  const seen = new Set();
  for (const s of strikes) {
    const ok = [0, 1, 2].includes(s?.reel) && [0, 1, 2].includes(s?.row) && allowed.has(s?.multiplier);
    if (!ok || seen.has(s.row * 3 + s.reel)) throw new Error('INVALID_LIGHTNING');
    seen.add(s.row * 3 + s.reel);
  }
  return strikes.map(s => ({ reel: s.reel, row: s.row, multiplier: s.multiplier }));
}
// What the strikes multiply a paying line by: the sum of those on the payline, or 1 if none is.
export function lightningBoost(strikes) {
  const onLine = (strikes || []).filter(s => s.row === 1);
  return onLine.length ? onLine.reduce((a, s) => a + s.multiplier, 0) : 1;
}

export function jackpotPool(state) {
  if (!state.jackpot || typeof state.jackpot !== 'object') state.jackpot = { pool: JACKPOT_SEED, lastWin: null };
  return state.jackpot;
}

// stopsOverride: three stop indexes for tests. lightning: falsy, true, or strikes already rolled.
// The strikes are settled before the stops are drawn; the reels never depend on them.
export function spinSlots(state, { stake, maxBet, rand = n => crypto.randomInt(0, n), stopsOverride = null, lightning = null }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  const strikes = slotStrikes(lightning, rand);
  const jp = jackpotPool(state);
  const stops = stopsOverride || [rand(STOPS), rand(STOPS), rand(STOPS)];
  const reels = stops.map(i => STRIP[i]);
  const line = slotLine(reels, { lightning: Boolean(strikes) });
  // A paying line through struck payline cells is multiplied; the jackpot line never is.
  const boost = strikes && line.mult > 0 && !line.jackpot ? lightningBoost(strikes) : 1;
  const mult = line.mult * boost;
  let jackpot = 0;
  jp.pool += Math.floor(stake * JACKPOT_RATE);
  if (line.jackpot) {
    // The pot pays in proportion to the bet: a table-maximum bet takes its share of the pot,
    // and no spin takes more than ten thousand times what it bet.
    const share = Math.min(1, stake / Math.max(1, maxBet));
    jackpot = Math.min(floorMoney(jp.pool * share), stake * JACKPOT_STAKE_CAP);
    jp.pool = Math.max(JACKPOT_SEED, jp.pool - jackpot);
    jp.lastWin = { amount: jackpot, at: new Date().toISOString() };
  }
  const gross = stake * mult + jackpot;
  return {
    id: id('slot'), game: 'Slots', stake, stops, reels, line: line.name, mult, jackpot,
    ...(strikes ? { lightning: strikes, lineMult: line.mult, ...(boost > 1 ? { boost } : {}) } : {}),
    netPnl: gross - stake, pool: jp.pool
  };
}
