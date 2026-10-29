// One-time moves between economies. v2 (PR #91) topped every account up to 10억 for the 1천만 원
// scale. v3 brings the bank and eleven floors from 10원 to 1천억: balances stay exactly as they
// are (한서's call), floors are reopened from each player's net worth on the new ladder, and
// everyone starts with 6등급 credit. v4 drops every floor under 100만 (한서's call): the same
// rebuild reopens each player's floors from their net worth on the shorter ladder, so anyone who
// sat below 100만 starts again in the Gold Room. Balances are untouched.
// Floor passes (lib/cosmetics.mjs) came after: every floor a player had already reached stays
// theirs without buying its skin, written once to account.floorPasses.
// 사치품 were retired on 2026-10-29 (한서): every piece still owned goes back to the house for
// exactly what was paid, as one LUXURY_REFUND row, and the feed forgets the purchases.
import { FLOORS } from './constants.mjs';
import { recalcUnlocks, netWorth } from './state.mjs';
import { JACKPOT_SEED, jackpotPool } from './slots.mjs';
import { passFloorOf } from './cosmetics.mjs';
import { addLedger } from './economy.mjs';

export const ECONOMY_VERSION = 4;

export const economyCurrent = state => (state.meta?.economy ?? 1) >= ECONOMY_VERSION && Boolean(state.meta?.floorPasses) && Boolean(state.meta?.seasonPasses) && Boolean(state.meta?.luxuryRefund);

export function grantFloorPasses(state) {
  for (const user of Object.values(state.users)) {
    user.account.floorPasses = [...new Set([...(user.account.floorPasses || []), ...user.account.unlockedFloors.filter(slug => slug !== FLOORS[0].slug)])];
  }
  state.meta = { ...(state.meta || {}), floorPasses: true };
}

// Passes became monthly (2026-10-19): a skin bought before then still opens its floor until the
// month ends, so it is written into account.floorPasses once; the season reset clears them all.
export function grantSeasonPasses(state) {
  for (const user of Object.values(state.users)) {
    const owned = Array.isArray(user.cosmetics?.owned) ? user.cosmetics.owned : [];
    const floors = owned.map(passFloorOf).filter(Boolean);
    if (floors.length) user.account.floorPasses = [...new Set([...(user.account.floorPasses || []), ...floors])];
  }
  state.meta = { ...(state.meta || {}), seasonPasses: true };
}

export function refundLuxury(state) {
  for (const user of Object.values(state.users)) {
    const owned = Array.isArray(user.luxury) ? user.luxury : [];
    const amount = owned.reduce((sum, x) => sum + (Number.isSafeInteger(x?.price) && x.price > 0 ? x.price : 0), 0);
    if (amount > 0) addLedger(state, user, { type: 'LUXURY_REFUND', amount, referenceType: 'SHOP', referenceId: 'luxury-retired', metadata: { items: owned.map(x => x.id), count: owned.length } });
    delete user.luxury;
  }
  if (Array.isArray(state.feed)) state.feed = state.feed.filter(f => f?.type !== 'LUXURY');
  state.meta = { ...(state.meta || {}), luxuryRefund: true };
}

const SLUGS = new Set(FLOORS.map(f => f.slug));

export function upgradeEconomy(state) {
  if (economyCurrent(state)) return false;
  if ((state.meta?.economy ?? 1) < ECONOMY_VERSION) upgradeFloors(state);
  if (!state.meta?.floorPasses) grantFloorPasses(state);
  if (!state.meta?.seasonPasses) grantSeasonPasses(state);
  if (!state.meta?.luxuryRefund) refundLuxury(state);
  return true;
}

function upgradeFloors(state) {
  for (const user of Object.values(state.users)) {
    user.account.unlockedFloors = [FLOORS[0].slug];
    user.account.progressionValue = netWorth(user);
    recalcUnlocks(user);
    user.account.unlockedFloors = user.account.unlockedFloors.filter(slug => SLUGS.has(slug));
    if (!user.credit) user.credit = { score: 500 };
  }
  const pool = jackpotPool(state);
  pool.pool = Math.max(pool.pool, JACKPOT_SEED);
  state.meta = { ...(state.meta || {}), economy: ECONOMY_VERSION };
}
