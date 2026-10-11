// AI opponents for Hold'em. Each bot estimates its equity by dealing out the unknown cards a
// few dozen times, then weighs that against the price of calling and its own temperament.
import { evaluate, legalActions, potTotal, RANK_VALUE } from './holdem.mjs';

// tight: how much better than the price a hand must be; aggro: how often it bets its edge;
// bluff: how often it fires without one.
export const BOT_STYLES = {
  ROCK: { tight: 0.08, aggro: 0.35, bluff: 0.03, label: '타이트' },
  SHARK: { tight: 0.03, aggro: 0.7, bluff: 0.12, label: '공격형' },
  STATION: { tight: -0.06, aggro: 0.2, bluff: 0.04, label: '콜링' },
  MANIAC: { tight: -0.02, aggro: 0.85, bluff: 0.25, label: '루즈' }
};

export const BOT_NAMES = ['NOVA', 'REX', 'LUNA', 'ODIN', 'MIKA', 'JAX', 'SORA', 'VERA', 'KAI', 'IRIS', 'DUKE', 'ZION'];

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = Object.keys(RANK_VALUE);

export function equity(hole, board, opponents, iterations = 90, rand = Math.random) {
  if (opponents < 1) return 1;
  const used = new Set([...hole, ...board].map(c => c.r + c.s));
  const rest = [];
  for (const s of SUITS) for (const r of RANKS) if (!used.has(r + s)) rest.push({ r, s });
  let score = 0;
  const need = 5 - board.length;
  for (let it = 0; it < iterations; it++) {
    // Partial shuffle: only as many cards as this run-out needs.
    const take = need + opponents * 2;
    for (let k = 0; k < take; k++) { const j = k + Math.floor(rand() * (rest.length - k)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
    const full = [...board, ...rest.slice(0, need)];
    const mine = evaluate([...hole, ...full]).score;
    let best = 0, ties = 0, lost = false;
    for (let o = 0; o < opponents; o++) {
      const s = evaluate([rest[need + o * 2], rest[need + o * 2 + 1], ...full]).score;
      if (s > mine) { lost = true; break; }
      if (s === mine) ties++;
      best = Math.max(best, s);
    }
    if (!lost) score += ties ? 1 / (ties + 1) : 1;
  }
  return score / iterations;
}

// Quick preflop read (so bots don't need to simulate before the flop): 0 = trash, 1 = aces.
export function preflopStrength([a, b]) {
  const hi = Math.max(RANK_VALUE[a.r], RANK_VALUE[b.r]), lo = Math.min(RANK_VALUE[a.r], RANK_VALUE[b.r]);
  let pts = hi === 14 ? 10 : hi === 13 ? 8 : hi === 12 ? 7 : hi === 11 ? 6 : hi / 2;
  if (hi === lo) pts = Math.max(5, pts * 2);
  if (a.s === b.s) pts += 2;
  const gap = hi - lo - 1;
  if (hi !== lo) pts -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (hi !== lo && gap <= 1 && hi < 12) pts += 1;
  return Math.max(0, Math.min(1, pts / 20));
}

const roundTo = (x, step) => Math.max(step, Math.round(x / step) * step);

export function decide(table, i, rand = Math.random) {
  const legal = legalActions(table, i);
  if (!legal) throw new Error('NOT_YOUR_TURN');
  const h = table.hand;
  const seat = table.seats[i], me = h.players[i];
  const style = BOT_STYLES[seat.style] || BOT_STYLES.SHARK;
  const opponents = h.players.filter((p, j) => p && j !== i && !p.folded).length;
  const pot = potTotal(table);
  const bb = table.bigBlind;
  const priceOdds = legal.toCall / (pot + legal.toCall || 1);

  let eq;
  if (h.street === 'PREFLOP') {
    const s = preflopStrength(me.cards);
    // Map hand quality onto a rough equity against this many opponents.
    eq = Math.min(0.95, (1 / (opponents + 1)) * (0.45 + s * 1.9));
  } else eq = equity(me.cards, h.board, Math.min(opponents, 4), 90, rand);
  const fair = 1 / (opponents + 1);
  const edge = eq - fair; // how much better than an average hand at this table
  const noise = (rand() - 0.5) * 0.06;

  const raiseTo = factor => {
    const target = legal.currentBet + Math.max(legal.minRaiseTo - legal.currentBet, (pot + legal.toCall) * factor);
    const to = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, roundTo(target, Math.max(1, Math.floor(bb / 2)))));
    return to >= legal.maxRaiseTo ? { type: 'ALL_IN' } : { type: 'RAISE', amount: to };
  };
  const strong = edge + noise > 0.22 - style.tight;
  const monster = eq > 0.8 || (h.street === 'PREFLOP' && preflopStrength(me.cards) > 0.85);

  if (legal.canCheck) {
    if (legal.canRaise && (strong || monster) && rand() < style.aggro + (monster ? 0.2 : 0)) return raiseTo(monster ? 0.75 : 0.5 + rand() * 0.25);
    if (legal.canRaise && rand() < style.bluff && opponents <= 2) return raiseTo(0.4);
    return { type: 'CHECK' };
  }
  // Facing a bet.
  const commitment = legal.toCall / (seat.stack + me.bet || 1);
  if (legal.canRaise && monster && rand() < style.aggro) return raiseTo(0.8);
  if (legal.canRaise && strong && rand() < style.aggro * 0.45) return raiseTo(0.6);
  const need = priceOdds + style.tight + (commitment > 0.5 ? 0.06 : 0) + noise;
  if (eq >= need) return { type: 'CALL' };
  if (legal.canRaise && rand() < style.bluff * 0.3 && commitment < 0.2) return raiseTo(0.6);
  return { type: 'FOLD' };
}
