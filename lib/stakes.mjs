import { stakeTierFor, isMoney } from './constants.mjs';
import { floorRefusal, newAccountRoomRefusal } from './state.mjs';
import { eventById, eventFloor, eventEntry } from './events.mjs';

export function validateStakeAgainstFloor(user, floor, stake) {
  if (!user?.account || !floor) throw new Error('INVALID_STAKE_CONTEXT');
  const refusal = floorRefusal(user, floor);
  if (refusal) throw new Error(refusal);
  if (!Number.isSafeInteger(stake) || stake < floor.minBet || stake > floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  if (!isMoney(stake)) throw new Error('BET_NOT_IN_UNITS');
  const tier = stakeTierFor(stake);
  if (!tier || !Array.isArray(floor.stakeTiers) || !floor.stakeTiers.includes(tier.slug)) throw new Error('STAKE_TIER_NOT_ALLOWED');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  return { floor, tier };
}

// A friends' room: the stake must fit the floor's table limits and the host's chips, but the floor
// itself needn't be open to them. Friends with different fortunes play wherever one of them sets up.
// An account younger than a week is held to the High Limit and below (lib/state.mjs).
export function validateRoomStake(user, floor, stake) {
  if (!user?.account || !floor) throw new Error('INVALID_STAKE_CONTEXT');
  const young = newAccountRoomRefusal(user, floor);
  if (young) throw new Error(young);
  if (!Number.isSafeInteger(stake) || stake < floor.minBet || stake > floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  if (!isMoney(stake)) throw new Error('BET_NOT_IN_UNITS');
  const tier = stakeTierFor(stake);
  if (!tier || !Array.isArray(floor.stakeTiers) || !floor.stakeTiers.includes(tier.slug)) throw new Error('STAKE_TIER_NOT_ALLOWED');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  return { floor, tier };
}

// Event tables (lib/events.mjs): only the event's floor, and only for players holding its entry.
export function validateEventStake(user, floor, stake, event) {
  if (!user?.account || !floor) throw new Error('INVALID_STAKE_CONTEXT');
  const ev = typeof event === 'string' ? eventById(event) : event;
  if (floor.slug !== eventFloor(ev)) throw new Error('EVENT_FLOOR_ONLY');
  if (user.account.available < eventEntry(ev)) throw new Error('EVENT_ENTRY_REQUIRED');
  if (!Number.isSafeInteger(stake) || stake < floor.minBet || stake > floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  if (!isMoney(stake)) throw new Error('BET_NOT_IN_UNITS');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  return { floor, tier: stakeTierFor(stake) };
}
