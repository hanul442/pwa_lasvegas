// 더블 오어 낫띵 (묻고 더블로 가): right after a winning blackjack or baccarat hand the person may
// stake the whole win on the colour of one card from a fresh deck. Red or black, even money, no
// house edge. A won gamble can be pressed again, up to three times in a row, each time staking
// everything it has built up; a lost one gives the win back.
import crypto from 'node:crypto';
import { id } from './state.mjs';

export const DOUBLE_GAME = 'Double';
export const DOUBLE_FROM = new Set(['Blackjack', 'Baccarat']);
export const DOUBLE_MAX_STEPS = 3;
export const DOUBLE_WINDOW_MS = 30 * 60 * 1000;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const isRed = suit => suit === '♥' || suit === '♦';

// What `round` lets its owner press now: { stake, step }, or null when nothing is on offer.
export function doubleOffer(round, userId, now = Date.now()) {
  if (!round || round.userId !== userId || round.status !== 'SETTLED' || round.doubledBy) return null;
  if (now - Date.parse(round.settledAt || round.createdAt || 0) > DOUBLE_WINDOW_MS) return null;
  if (round.game === DOUBLE_GAME) {
    if (round.netPnl <= 0 || round.step >= DOUBLE_MAX_STEPS) return null;
    return { stake: round.stake * 2, step: round.step + 1 };
  }
  if (!DOUBLE_FROM.has(round.game) || !(round.netPnl > 0)) return null;
  return { stake: round.netPnl, step: 1 };
}

// The gamble itself, as a settled round. `randInt(n)` draws 0..n-1.
export function playDouble(parent, userId, pick, randInt = n => crypto.randomInt(0, n)) {
  if (pick !== 'RED' && pick !== 'BLACK') throw new Error('INVALID_PICK');
  const offer = doubleOffer(parent, userId);
  if (!offer) throw new Error('DOUBLE_NOT_OFFERED');
  const card = { r: RANKS[randInt(13)], s: SUITS[randInt(4)] };
  const won = (pick === 'RED') === isRed(card.s);
  const now = new Date().toISOString();
  return {
    id: id('dbl'), game: DOUBLE_GAME, userId, parent: parent.id, origin: parent.origin || parent.game, floor: parent.floor ?? null,
    step: offer.step, stake: offer.stake, pick, card: `${card.r}${card.s}`, color: isRed(card.s) ? 'RED' : 'BLACK', won,
    netPnl: won ? offer.stake : -offer.stake, status: 'SETTLED', createdAt: now, settledAt: now
  };
}

export function doublePublic(round) {
  const next = doubleOffer(round, round.userId);
  return { id: round.id, parent: round.parent, origin: round.origin, step: round.step, stake: round.stake, pick: round.pick, card: round.card, color: round.color, won: round.won, netPnl: round.netPnl, next: next ? next.stake : null };
}
