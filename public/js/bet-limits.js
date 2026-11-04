// 베팅 방법별 한도 (2026-11-04, 한서 "베팅 방법별 최대/최소 베팅 한도 차등화"): like a real casino,
// the longer the odds the smaller the most one spot may hold, and the even-money outside bets at
// roulette and sic bo ask for a bigger minimum than the inside ones. Limits are whole multiples of
// the floor's smallest bet, so every limit is a whole number of chips (100칩 steps). The top is
// also never above the player's division cap (lib/rank-points.mjs rpBetCap): the lower one wins.
// Shared by the server (lib/bet-limits.mjs re-exports it) and the felt (js/table.js zone limits).
const FULL = null; // up to the table's (or division's) top
const EVEN = { min: 1, max: FULL }, OUTSIDE = { min: 2, max: FULL };
// Inside and long-shot spots have no least of their own (one chip will do; the round as a whole
// still has to cover the table's smallest bet).
const TWO_TO_ONE = { min: 0, max: 6 }, MID = { min: 0, max: 3 }, LONG = { min: 0, max: 2 };
// Sic bo totals by what they pay: 6:1–12:1 is a middling shot, 17:1 and up a long one.
const sicboTotal = target => (target >= 7 && target <= 14 ? MID : LONG);
export const BET_LIMITS = {
  Roulette: { NUMBER: LONG, DOZEN: TWO_TO_ONE, COLUMN: TWO_TO_ONE, RED: OUTSIDE, BLACK: OUTSIDE, ODD: OUTSIDE, EVEN: OUTSIDE, LOW: OUTSIDE, HIGH: OUTSIDE },
  'Sic Bo': { SMALL: OUTSIDE, BIG: OUTSIDE, ODD: OUTSIDE, EVEN: OUTSIDE, SINGLE: TWO_TO_ONE, TOTAL: sicboTotal, ANY_TRIPLE: LONG },
  Baccarat: { PLAYER: EVEN, BANKER: EVEN, TIE: MID, PLAYER_PAIR: MID, BANKER_PAIR: MID },
  'Horse Racing': { PLACE: EVEN, WIN: { min: 1, max: 5 }, QUINELLA: LONG, EXACTA: LONG },
  Slots: { LINE: { min: 1, max: 5 } }
};
// The limit of one bet type, in smallest bets: { min, max } (max null = the table's top).
export function betTypeLimit(game, betType, target = null) {
  const g = BET_LIMITS[game];
  if (!g) return EVEN;
  const l = g[betType] ?? g.LINE ?? EVEN;
  return typeof l === 'function' ? l(target) : l;
}
// The same in money at this floor, under `cap` (the most this player may bet on a spot here).
export function betTypeRange(floor, cap, game, betType, target = null) {
  const l = betTypeLimit(game, betType, target), top = Math.min(cap ?? floor.maxBet, floor.maxBet);
  const max = l.max === FULL ? top : Math.min(top, l.max * floor.minBet);
  return { min: Math.min(max, l.min * floor.minBet), max };
}
// Every spot of a round inside its own limits, or a refusal.
export function checkBetTypes(floor, cap, game, bets) {
  for (const b of bets) {
    const r = betTypeRange(floor, cap, game, b.betType, b.target ?? null);
    if (b.stake > r.max) throw new Error('BET_TYPE_OVER_LIMIT');
    if (b.stake < r.min) throw new Error('BET_TYPE_UNDER_MIN');
  }
}

// 게임별 바이인 (2026-11-04, 한서 "게임별 바이인 금액 다르게 설정"): how many of the table's smallest
// bets one sits down with, by game. Slots and the races are a few quick spins; poker needs a deep
// stack; hwatu can lose past its deposit. Keys are the lobby's game ids (public/js/config.js).
export const BUY_IN_BY_GAME = {
  blackjack: { min: 20, max: 300, default: 50 },
  baccarat: { min: 20, max: 300, default: 50 },
  roulette: { min: 10, max: 200, default: 30 },
  dice: { min: 10, max: 200, default: 30 },
  slots: { min: 10, max: 100, default: 20 },
  horses: { min: 10, max: 100, default: 20 },
  poker: { min: 50, max: 300, default: 100 },
  sevenpoker: { min: 50, max: 300, default: 100 },
  matgo: { min: 30, max: 300, default: 50 },
  gostop: { min: 30, max: 300, default: 50 },
  seotda: { min: 30, max: 300, default: 50 }
};
export const BUY_IN_ANY = { min: 20, max: 300, default: 50 };
export const buyInLimits = game => BUY_IN_BY_GAME[game] || BUY_IN_ANY;
// The range one may buy now: `wallet` (money to spend), `inHand` (chips already held at this seat),
// `min` (the table's smallest bet), `unit` (one chip). With chips in hand it is a top-up: from one
// smallest bet up to what brings the stack to the game's most (all the money, when less).
// Whole chips, never part of one.
export function buyInRangeOf({ wallet, inHand = 0, min, unit = 1, game = null }) {
  const l = buyInLimits(game), floorTo = x => Math.floor(x / unit) * unit;
  const hi = Math.min(Math.max(0, l.max * min - inHand), wallet);
  const lo = Math.min(inHand > 0 ? min : l.min * min, hi);
  const def = Math.max(lo, Math.min(l.default * min - inHand, hi));
  return { min: floorTo(lo), max: floorTo(hi), default: floorTo(def), wallet, inHand, limits: l };
}
