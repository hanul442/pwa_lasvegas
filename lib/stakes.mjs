import { stakeTierFor } from './constants.mjs';
import { floorOpen } from './state.mjs';

export function validateStakeAgainstFloor(user, floor, stake) {
  if (!user?.account || !floor) throw new Error('INVALID_STAKE_CONTEXT');
  if (!user.account.unlockedFloors.includes(floor.slug)) throw new Error('FLOOR_LOCKED');
  if (!floorOpen(user, floor)) throw new Error('FLOOR_OUTGROWN');
  if (!Number.isSafeInteger(stake) || stake < floor.minBet || stake > floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const tier = stakeTierFor(stake);
  if (!tier || !Array.isArray(floor.stakeTiers) || !floor.stakeTiers.includes(tier.slug)) throw new Error('STAKE_TIER_NOT_ALLOWED');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  return { floor, tier };
}
