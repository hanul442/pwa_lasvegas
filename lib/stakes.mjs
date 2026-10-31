import { stakeTierFor, tableUnitOf } from './constants.mjs';
import { floorRefusal } from './state.mjs';
import { eventById, eventFloor, eventEntry } from './events.mjs';
import { rpEra, rpBetCap, rpPointsNow } from './rank-points.mjs';
import { FLOORS } from './constants.mjs';

// From the RP season bets come from chips bought at the table (lib/cashier.mjs): short of chips with
// money still in the wallet, the player is sent to buy in rather than told they're broke.
export const shortOfChips = user => (rpEra() && (user?.account?.wallet || 0) > 0 ? 'BUY_IN_REQUIRED' : 'INSUFFICIENT_BANKROLL');
// The most this player may put on one spot at a house table on this floor (lib/rank-points.mjs rpBetCap).
export const betCapFor = (user, floor) => (rpEra() ? rpBetCap(rpPointsNow(user), FLOORS.findIndex(f => f.slug === floor.slug)) || floor.maxBet : floor.maxBet);
export function checkBetCap(user, floor, stakes) {
  const cap = betCapFor(user, floor);
  if ([].concat(stakes).some(s => s > cap)) throw new Error(cap < floor.maxBet ? 'BET_OVER_DIVISION_CAP' : 'BET_OUTSIDE_TABLE_LIMIT');
}
// A bet is whole chips of the floor (and whole 100만s): lib/constants.mjs tableUnitOf.
export const inTableUnits = (floor, stake) => Number.isSafeInteger(stake) && stake % tableUnitOf(floor) === 0;
function checkChips(user, need) {
  if (user.account.available >= need) return;
  throw new Error(shortOfChips(user));
}

export function validateStakeAgainstFloor(user, floor, stake) {
  if (!user?.account || !floor) throw new Error('INVALID_STAKE_CONTEXT');
  const refusal = floorRefusal(user, floor);
  if (refusal) throw new Error(refusal);
  if (!Number.isSafeInteger(stake) || stake < floor.minBet || stake > floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  if (!inTableUnits(floor, stake)) throw new Error('BET_NOT_IN_UNITS');
  checkBetCap(user, floor, stake);
  const tier = stakeTierFor(stake);
  if (!tier || !Array.isArray(floor.stakeTiers) || !floor.stakeTiers.includes(tier.slug)) throw new Error('STAKE_TIER_NOT_ALLOWED');
  checkChips(user, stake);
  return { floor, tier };
}

// A friends' room: the stake must fit the floor's table limits and the host's chips, but the floor
// itself needn't be open to them. Friends with different fortunes play wherever one of them sets up.
// New accounts too: 한서 wants friends on any floor to play together (2026-10-31).
export function validateRoomStake(user, floor, stake) {
  if (!user?.account || !floor) throw new Error('INVALID_STAKE_CONTEXT');
  if (!Number.isSafeInteger(stake) || stake < floor.minBet || stake > floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  if (!inTableUnits(floor, stake)) throw new Error('BET_NOT_IN_UNITS');
  const tier = stakeTierFor(stake);
  if (!tier || !Array.isArray(floor.stakeTiers) || !floor.stakeTiers.includes(tier.slug)) throw new Error('STAKE_TIER_NOT_ALLOWED');
  checkChips(user, stake);
  return { floor, tier };
}

// Event tables (lib/events.mjs): only the event's floor, and only for players holding its entry.
export function validateEventStake(user, floor, stake, event) {
  if (!user?.account || !floor) throw new Error('INVALID_STAKE_CONTEXT');
  const ev = typeof event === 'string' ? eventById(event) : event;
  if (floor.slug !== eventFloor(ev)) throw new Error('EVENT_FLOOR_ONLY');
  if (user.account.available < eventEntry(ev)) throw new Error(rpEra() && user.account.available + (user.account.wallet || 0) >= eventEntry(ev) ? 'BUY_IN_REQUIRED' : 'EVENT_ENTRY_REQUIRED');
  if (!Number.isSafeInteger(stake) || stake < floor.minBet || stake > floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  if (!inTableUnits(floor, stake)) throw new Error('BET_NOT_IN_UNITS');
  checkChips(user, stake);
  return { floor, tier: stakeTierFor(stake) };
}
