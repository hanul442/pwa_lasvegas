// Three-reel slot with one payline and a progressive jackpot shared by the whole floor.
// The VEGAS star is wild; three stars take the jackpot. Each spin feeds 3% of its stake
// into the pot. A FREE coin showing anywhere on all three reels plays 10 free spins at
// double pay, settled in the same round. With them the game returns about 97% on either
// table (see tests), the pot adds the rest.
// 라이트닝 mode: the server strikes 1–3 of the nine cells in the window with 2×–50× before the
// reels stop, and a paying line through struck cells is multiplied (see LIGHTNING_* below).
import crypto from 'node:crypto';
import { id } from './state.mjs';
import { floorMoney, ceilMoney, fairMoney } from './constants.mjs';

export const SLOT_SYMBOLS = ['STAR', 'SEVEN', 'BAR3', 'BAR2', 'BAR1', 'S', 'H', 'D', 'C', 'FREE'];
// Stops per symbol on each 64-stop reel.
export const REEL_WEIGHTS = { STAR: 2, SEVEN: 3, BAR3: 5, BAR2: 7, BAR1: 9, S: 9, H: 8, D: 9, C: 9, FREE: 3 };
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

export const LINE = { SEVEN: 100, BAR3: 50, BAR2: 25, BAR1: 10, S: 6, H: 6, D: 6, C: 6, ANY_BAR: 4, COLOR: 2, TWO_STARS: 10, ONE_STAR: 1 };
// The lightning table's own pays, about a quarter of the plain ones, since a struck line pays
// several times over. A lone star pays nothing here. Wild stars still double or triple a line.
export const LIGHTNING_LINE = { SEVEN: 30, BAR3: 14, BAR2: 6, BAR1: 3, S: 2, H: 2, D: 2, C: 2, ANY_BAR: 1, COLOR: 1, TWO_STARS: 3, ONE_STAR: 0 };
// Each floor has its own pot (2026-10-24 review: one pot shared by every floor let a Gold Room
// max bet take a pot that Vault spins had fed). A pot starts at 500 of its floor's top bets (50억 in
// the Gold Room) and every spin adds 0.5% of its bet, so the machine stays near 99% even when the
// pot is full.
export const JACKPOT_SEED_TIMES = 500;
export const JACKPOT_SEED = 5_000_000_000;
export const jackpotSeed = maxBet => (maxBet > 0 ? ceilMoney(JACKPOT_SEED_TIMES * maxBet) : JACKPOT_SEED);
export const JACKPOT_RATE = 0.005;
// Three stars pay at most this many times the bet out of the pot, so a small spin can't empty it.
export const JACKPOT_STAKE_CAP = 10_000;
export const STAR_LINE = 500;
// 프리 스핀: FREE on every reel's window (any row) plays FREE_SPINS more spins of the same bet
// and mode for nothing, every win times FREE_SPIN_MULT. Hitting it again inside adds another
// FREE_SPINS, up to FREE_SPIN_CAP in one round.
export const FREE_SPINS = 10;
export const FREE_SPIN_MULT = 2;
export const FREE_SPIN_CAP = 50;

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
  // The FREE coin is a scatter, not a line symbol: on the line it only ever sits beside stars.
  if (!rest.includes('FREE') && rest.every(s => s === rest[0])) return { mult: pay[rest[0]] * wild, name: rest[0] };
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

// ---------- 5줄 ----------
// The 5-line game splits the bet evenly over five lines through the 3×3 window: the payline, the
// rows above and below it, and the two diagonals (rows per reel). Every line is three
// independent reel positions with the same chances as the payline, and lightning strikes fall
// on any cell alike, so each line returns what the 1-line game returns: the machine's return is
// unchanged, only the swing is smaller (more small wins, a smaller top). The pot is only ever won
// on the payline (line 0); three stars on another line pay the 500× line without it.
export const SLOT_LINES = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
export const LINE_COUNTS = [1, 5];
// The window's symbols, [row][reel], row 0 above the payline.
export const windowOf = stops => [0, 1, 2].map(row => stops.map(stop => STRIP[(stop + row - 1 + STOPS) % STOPS]));
// The sum of the strikes on one line's cells, or 1 if none falls on it.
export function lineBoost(strikes, rows) {
  const on = (strikes || []).filter(s => rows[s.reel] === s.row);
  return on.length ? on.reduce((a, s) => a + s.multiplier, 0) : 1;
}

// The pot of the floor whose top bet is `maxBet` (the old shared pot when none is given).
export function jackpotPool(state, maxBet) {
  if (!state.jackpot || typeof state.jackpot !== 'object') state.jackpot = { pool: JACKPOT_SEED, lastWin: null };
  if (!maxBet) return state.jackpot;
  const floors = state.jackpot.floors ||= {};
  return floors[maxBet] ||= { pool: jackpotSeed(maxBet), lastWin: null };
}
// What the lounge shows: each floor's pot by its top bet.
export function jackpotView(state, maxBets) {
  return Object.fromEntries(maxBets.map(m => [m, state.jackpot?.floors?.[m]?.pool ?? jackpotSeed(m)]));
}

// How many reels show the FREE coin in their window: the stop on the payline and one either side.
export function scatterReels(stops) {
  return stops.filter(stop => [stop - 1, stop, stop + 1].some(k => STRIP[(k + STOPS) % STOPS] === 'FREE')).length;
}

// One spin of the reels at `stake`, paying `pay` times its line. The base spin and each free
// spin go through here; only the base spin feeds the pot, but any of them can take it.
function playReels(state, { stake, maxBet, rand, stops, lightning, pay = 1, lines = 1 }) {
  if (lines !== 1) return playLines(state, { stake, maxBet, rand, stops, lightning, pay, lines });
  const strikes = slotStrikes(lightning, rand);
  const jp = jackpotPool(state, maxBet);
  stops = stops || [rand(STOPS), rand(STOPS), rand(STOPS)];
  const reels = stops.map(i => STRIP[i]);
  const line = slotLine(reels, { lightning: Boolean(strikes) });
  // A paying line through struck payline cells is multiplied; the jackpot line never is.
  const boost = strikes && line.mult > 0 && !line.jackpot ? lightningBoost(strikes) : 1;
  const mult = line.mult * boost * pay;
  let jackpot = 0;
  if (line.jackpot) {
    // The pot pays in proportion to the bet: a table-maximum bet takes its share of the pot,
    // and no spin takes more than ten thousand times what it bet.
    const share = Math.min(1, stake / Math.max(1, maxBet));
    jackpot = Math.min(floorMoney(jp.pool * share), stake * JACKPOT_STAKE_CAP);
    jp.pool = Math.max(jackpotSeed(maxBet), jp.pool - jackpot);
    jp.lastWin = { amount: jackpot, at: new Date().toISOString() };
  }
  return {
    stops, reels, line: line.name, mult, jackpot, scatter: scatterReels(stops),
    ...(strikes ? { lightning: strikes, lineMult: line.mult, ...(boost > 1 ? { boost } : {}) } : {})
  };
}

// The pot share a three-star payline takes, as above.
function takePot(jp, stake, maxBet) {
  const share = Math.min(1, stake / Math.max(1, maxBet));
  const won = Math.min(floorMoney(jp.pool * share), stake * JACKPOT_STAKE_CAP);
  jp.pool = Math.max(jackpotSeed(maxBet), jp.pool - won);
  jp.lastWin = { amount: won, at: new Date().toISOString() };
  return won;
}
// One 5-line spin. `mult` is the whole spin's return on the whole stake (it can be fractional:
// each line carries a fifth of the bet); `wins` lists every paying line.
function playLines(state, { stake, maxBet, rand, stops, lightning, pay, lines }) {
  const strikes = slotStrikes(lightning, rand);
  const jp = jackpotPool(state, maxBet);
  stops = stops || [rand(STOPS), rand(STOPS), rand(STOPS)];
  const win = windowOf(stops);
  const wins = [];
  let jackpot = 0;
  SLOT_LINES.slice(0, lines).forEach((rows, k) => {
    const line = slotLine(rows.map((row, reel) => win[row][reel]), { lightning: Boolean(strikes) });
    if (!(line.mult > 0)) return;
    const boost = strikes && !line.jackpot ? lineBoost(strikes, rows) : 1;
    if (line.jackpot && k === 0) jackpot = takePot(jp, stake, maxBet);
    wins.push({ line: k, name: line.name, mult: line.mult * boost * pay, ...(boost > 1 ? { boost } : {}) });
  });
  const best = wins.reduce((a, w) => (!a || w.mult > a.mult ? w : a), null);
  return {
    stops, reels: stops.map(i => STRIP[i]), lines, line: best?.name ?? null, mult: wins.reduce((a, w) => a + w.mult, 0) / lines, jackpot, wins, scatter: scatterReels(stops),
    ...(strikes ? { lightning: strikes } : {})
  };
}
// What a spin pays back on `stake` beside its pot share: whole 100만s, a part unit rounded at
// random so the average is exact (a 5-line win can land between units).
const spinWin = (stake, spin, rand) => (spin.lines > 1 ? fairMoney(stake * spin.mult, () => rand(1_000_000) / 1_000_000) : stake * spin.mult) + spin.jackpot;

// stopsOverride: three stop indexes for tests. lightning: falsy, true, or strikes already rolled
// for the base spin (free spins always roll their own). The strikes are settled before the stops
// are drawn; the reels never depend on them.
export function spinSlots(state, { stake, maxBet, rand = n => crypto.randomInt(0, n), stopsOverride = null, lightning = null, lines = 1 }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (!LINE_COUNTS.includes(lines)) throw new Error('INVALID_LINES');
  const strikes = slotStrikes(lightning, rand);
  const jp = jackpotPool(state, maxBet);
  jp.pool += Math.floor(stake * JACKPOT_RATE);
  const { scatter, ...base } = playReels(state, { stake, maxBet, rand, stops: stopsOverride, lightning: strikes, lines });
  if (lines > 1) base.win = spinWin(stake, base, rand) - base.jackpot;
  let gross = lines > 1 ? base.win + base.jackpot : stake * base.mult + base.jackpot;
  let freeSpins = null;
  if (scatter === 3) {
    // Played out here, in the same round: one settle, one ledger row, nothing left open.
    const spins = [];
    let awarded = FREE_SPINS;
    while (spins.length < awarded) {
      const { scatter: again, ...spin } = playReels(state, { stake, maxBet, rand, lightning: lightning ? true : null, pay: FREE_SPIN_MULT, lines });
      if (again === 3 && awarded < FREE_SPIN_CAP) { awarded = Math.min(FREE_SPIN_CAP, awarded + FREE_SPINS); spin.retrigger = true; }
      if (lines > 1) spin.win = spinWin(stake, spin, rand) - spin.jackpot;
      spins.push(spin);
    }
    const win = spins.reduce((a, x) => a + (lines > 1 ? x.win : stake * x.mult) + x.jackpot, 0);
    gross += win;
    freeSpins = { awarded, multiplier: FREE_SPIN_MULT, win, spins };
  }
  const jackpot = base.jackpot + (freeSpins ? freeSpins.spins.reduce((a, x) => a + x.jackpot, 0) : 0);
  return {
    id: id('slot'), game: 'Slots', stake, ...base, jackpot,
    ...(freeSpins ? { freeSpins } : {}),
    netPnl: gross - stake, pool: jp.pool
  };
}
