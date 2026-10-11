// One-time move to the 1천만 원 economy (bets from 1천만 to 10조, a 10억 start). Players below
// the new starting bankroll are topped up to it through the ledger; the floors they had opened
// stay open, and floors are rechecked against the chips each player holds.
import { INITIAL_BANKROLL } from './constants.mjs';
import { addLedger } from './economy.mjs';
import { recalcUnlocks } from './state.mjs';
import { JACKPOT_SEED, jackpotPool } from './slots.mjs';

export const ECONOMY_VERSION = 2;

export const economyCurrent = state => (state.meta?.economy ?? 1) >= ECONOMY_VERSION;

export function upgradeEconomy(state) {
  if (economyCurrent(state)) return false;
  for (const user of Object.values(state.users)) {
    const total = user.account.available + user.account.locked;
    if (total < INITIAL_BANKROLL) {
      addLedger(state, user, { type: 'ADMIN_GRANT', amount: INITIAL_BANKROLL - total, referenceType: 'ECONOMY_UPGRADE', metadata: { note: '최소 베팅 1천만 원 개편' } });
    } else {
      user.account.progressionValue = total;
      recalcUnlocks(user);
    }
  }
  const pool = jackpotPool(state);
  pool.pool = Math.max(pool.pool, JACKPOT_SEED);
  state.meta = { ...(state.meta || {}), economy: ECONOMY_VERSION };
  return true;
}
