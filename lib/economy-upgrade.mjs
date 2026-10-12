// One-time moves between economies. v2 (PR #91) topped every account up to 10억 for the 1천만 원
// scale. v3 brings the bank and eleven floors from 10원 to 1천억: balances stay exactly as they
// are (한서's call), floors are reopened from each player's net worth on the new ladder, and
// everyone starts with 6등급 credit.
import { FLOORS } from './constants.mjs';
import { recalcUnlocks, netWorth } from './state.mjs';
import { JACKPOT_SEED, jackpotPool } from './slots.mjs';

export const ECONOMY_VERSION = 3;

export const economyCurrent = state => (state.meta?.economy ?? 1) >= ECONOMY_VERSION;

const SLUGS = new Set(FLOORS.map(f => f.slug));

export function upgradeEconomy(state) {
  if (economyCurrent(state)) return false;
  for (const user of Object.values(state.users)) {
    user.account.unlockedFloors = ['corner'];
    user.account.progressionValue = netWorth(user);
    recalcUnlocks(user);
    user.account.unlockedFloors = user.account.unlockedFloors.filter(slug => SLUGS.has(slug));
    if (!user.credit) user.credit = { score: 500 };
  }
  const pool = jackpotPool(state);
  pool.pool = Math.max(pool.pool, JACKPOT_SEED);
  state.meta = { ...(state.meta || {}), economy: ECONOMY_VERSION };
  return true;
}
