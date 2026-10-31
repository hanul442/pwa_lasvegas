// 뽀찌: a chip tossed to the dealer (한서 2026-10-29 "딜러한테 뽀찌주는거 추가해줘"). It only
// leaves the player's chips: no odds, payouts, RP or game result change, and it is not counted as
// a lost hand. While seated the table stack is account.available, so the tip comes off the stack
// in front of the player.
import { addLedger } from './economy.mjs';
import { FLOORS, isTableMoney, tableUnitOf } from './constants.mjs';
import { dayOf } from './loss-tally.mjs';

// House tables with a dealer. Hwatu, slots and horses have none; at the poker tables the chips
// in play are the seat's stack (lib/holdem-session.mjs), so a tip there has to come off that
// stack, which is not built yet.
export const TIP_GAMES = new Set(['blackjack', 'baccarat', 'roulette', 'dice']);
// One chip at a time, and a double tap does not throw two.
export const TIP_GAP_MS = 900;
// The biggest single tip: one smallest chip of the highest table.
const TIP_MAX = Math.max(...FLOORS.map(f => f.minBet));

export function tipDealer(state, user, { game, amount }, now = Date.now()) {
  const g = String(game || '');
  if (!TIP_GAMES.has(g)) throw new Error('NO_DEALER_HERE');
  const value = Number(amount);
  if (!isTableMoney(value) || value <= 0 || value > TIP_MAX) throw new Error('BET_NOT_IN_UNITS');
  // Whole chips of the table the player sits at.
  if (user.account.seat?.floor && value % tableUnitOf(user.account.seat.floor) !== 0) throw new Error('BET_NOT_IN_UNITS');
  if (user.account.available < value) throw new Error('INSUFFICIENT_BANKROLL');
  const tips = (user.tips ||= { total: 0, count: 0, lastAt: 0 });
  if (now - (tips.lastAt || 0) < TIP_GAP_MS) throw new Error('TIP_TOO_FAST');
  const tx = addLedger(state, user, { type: 'DEALER_TIP', amount: -value, referenceType: 'DEALER_TIP', metadata: { game: g } });
  tips.total += value; tips.count += 1; tips.lastAt = now;
  // The day's tips sit beside its wins and losses (lib/loss-tally.mjs), not inside them.
  if (user.today?.day === dayOf(now)) user.today.tips = (user.today.tips || 0) + value;
  return { amount: value, total: tips.total, count: tips.count, txId: tx.id };
}
