// Three-reel slot with one payline and a progressive jackpot shared by the whole floor.
// The VEGAS star is wild; three stars take the jackpot. Each spin feeds 2% of its stake
// into the pot. Base game returns about 90.7% (see tests), the pot adds the rest.
import crypto from 'node:crypto';
import { id } from './state.mjs';

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

const LINE = { SEVEN: 80, BAR3: 40, BAR2: 20, BAR1: 10, S: 6, H: 6, D: 6, C: 6 };
export const JACKPOT_SEED = 5_000_000_000;
export const JACKPOT_RATE = 0.02;
export const STAR_LINE = 500;

const isBar = s => s.startsWith('BAR');
const isSuit = s => s.length === 1;
const isRed = s => s === 'H' || s === 'D';

// Multiplier on the stake for a line (gross return), and a short name for it.
export function slotLine(reels) {
  const stars = reels.filter(s => s === 'STAR').length;
  if (stars === 3) return { mult: STAR_LINE, name: 'JACKPOT', jackpot: true };
  const rest = reels.filter(s => s !== 'STAR');
  const wild = stars === 2 ? 3 : stars === 1 ? 2 : 1;
  if (rest.every(s => s === rest[0])) return { mult: LINE[rest[0]] * wild, name: rest[0] };
  if (rest.every(isBar)) return { mult: 4 * (stars ? 2 : 1), name: 'ANY_BAR' };
  if (rest.every(isSuit) && (rest.every(isRed) || rest.every(s => !isRed(s)))) return { mult: 2 * (stars ? 2 : 1), name: rest.every(isRed) ? 'ALL_RED' : 'ALL_BLACK' };
  if (stars === 2) return { mult: 10, name: 'TWO_STARS' };
  if (stars === 1) return { mult: 1, name: 'ONE_STAR' };
  return { mult: 0, name: null };
}

export function jackpotPool(state) {
  if (!state.jackpot || typeof state.jackpot !== 'object') state.jackpot = { pool: JACKPOT_SEED, lastWin: null };
  return state.jackpot;
}

// stopsOverride: three stop indexes for tests.
export function spinSlots(state, { stake, maxBet, rand = n => crypto.randomInt(0, n), stopsOverride = null }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  const jp = jackpotPool(state);
  const stops = stopsOverride || [rand(STOPS), rand(STOPS), rand(STOPS)];
  const reels = stops.map(i => STRIP[i]);
  const line = slotLine(reels);
  let jackpot = 0;
  jp.pool += Math.floor(stake * JACKPOT_RATE);
  if (line.jackpot) {
    // The pot pays in proportion to the bet: a table-maximum bet takes all of it.
    const share = Math.min(1, stake / Math.max(1, maxBet));
    jackpot = Math.floor(jp.pool * share);
    jp.pool = Math.max(JACKPOT_SEED, jp.pool - jackpot);
    jp.lastWin = { amount: jackpot, at: new Date().toISOString() };
  }
  const gross = stake * line.mult + jackpot;
  return { id: id('slot'), game: 'Slots', stake, stops, reels, line: line.name, mult: line.mult, jackpot, netPnl: gross - stake, pool: jp.pool };
}
