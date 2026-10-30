// 상점: cosmetic skins for the tables. Every purchase is a PURCHASE ledger row (chips go to the
// house). Skins are what lets a player in, though: each floor above the Gold Room opens only once
// they buy one of that floor's skins (lib/cosmetics.mjs). The pass lasts the month: after the
// season reset a skin already owned is bought again as that floor's pass.
// 사치품 (luxury assets) were retired on 2026-10-29 (한서); owners got the price back in chips
// (lib/economy-upgrade.mjs refundLuxury).
import { addLedger } from './economy.mjs';
import { ACHIEVEMENTS } from './achievements.mjs';
import { isMoney, FLOORS } from './constants.mjs';
import { SLOTS, COSMETICS, PASS_ITEMS } from './cosmetics.mjs';
import { hasFloorPass, floorOpen } from './state.mjs';
import { rpEra, rpTierStart } from './rank-points.mjs';
import { monthBoundary } from './rank-tier.mjs';
import { drawFromWallet } from './cashier.mjs';

// Skins, one slot each, and the floor passes among them: lib/cosmetics.mjs.
export { SLOTS, COSMETICS, PASS_ITEMS };

const ITEMS = new Map(COSMETICS.map(x => [x.id, { ...x, kind: 'cosmetic' }]));
for (const x of ITEMS.values()) if (!isMoney(x.price) && x.price !== 0) throw new Error(`SHOP_PRICE_NOT_IN_UNITS:${x.id}`);

export const itemById = itemId => ITEMS.get(String(itemId || '')) || null;

function cosmetics(user) {
  const c = user.cosmetics && typeof user.cosmetics === 'object' ? user.cosmetics : {};
  c.owned = Array.isArray(c.owned) ? c.owned : [];
  c.equipped = { cardBack: null, felt: null, chips: null, frame: null, ...(c.equipped || {}) };
  user.cosmetics = c;
  return c;
}

const achievementDone = (user, achievementId) => {
  const a = ACHIEVEMENTS.find(x => x.id === achievementId);
  return Boolean(a) && a.value(user) >= a.target;
};

// Whether `user` may wear a skin: free ones always, achievement ones once it is done, bought ones after buying.
export function ownsCosmetic(user, item) {
  if (!item || item.kind !== 'cosmetic') return false;
  if (item.price === 0 && !item.achievement) return true;
  if (item.achievement && achievementDone(user, item.achievement)) return true;
  return cosmetics(user).owned.includes(item.id);
}

// Replays a purchase retried with the same idempotency key instead of running it twice.
const LOG_LIMIT = 20;
function shopCommand(user, key, kind, itemId, run) {
  const log = Array.isArray(user.shopLog) ? user.shopLog : (user.shopLog = []);
  if (key) {
    const seen = log.find(x => x.key === key);
    if (seen) {
      if (seen.kind !== kind || seen.itemId !== itemId) throw new Error('IDEMPOTENCY_CONFLICT');
      return { ...seen.result, replayed: true };
    }
  }
  const result = run();
  if (key) { log.push({ key, kind, itemId, result }); if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT); }
  return { ...result, replayed: false };
}

export function buyItem(state, user, itemId, { key = null } = {}) {
  const item = itemById(itemId);
  if (!item) throw new Error('ITEM_NOT_FOUND');
  return shopCommand(user, key, 'buy', item.id, () => {
    const passFloor = item.kind === 'cosmetic' && item.floor ? FLOORS.find(f => f.slug === item.floor) : null;
    const renew = Boolean(passFloor) && ownsCosmetic(user, item) && !hasFloorPass(user, passFloor);
    if (!renew && ownsCosmetic(user, item)) throw new Error('ITEM_ALREADY_OWNED');
    if (item.achievement || item.price === 0) throw new Error('ITEM_NOT_FOR_SALE');
    if (item.season && item.season !== monthBoundary().id) throw new Error('ITEM_SEASON_OVER');
    if (user.account.available + Math.max(0, user.account.wallet || 0) < item.price) throw new Error('INSUFFICIENT_BANKROLL');
    drawFromWallet(state, user, item.price);
    addLedger(state, user, { type: 'PURCHASE', amount: -item.price, referenceType: 'SHOP', referenceId: item.id, metadata: { item: item.id, kind: item.kind, name: item.name, ...(renew ? { renew: true } : {}) } });
    if (!renew) cosmetics(user).owned.push(item.id);
    if (passFloor && !hasFloorPass(user, passFloor)) {
      user.account.floorPasses = [...(Array.isArray(user.account.floorPasses) ? user.account.floorPasses : []), passFloor.slug];
      return { itemId: item.id, kind: item.kind, price: item.price, pass: item.floor, ...(renew ? { renew: true } : {}) };
    }
    return { itemId: item.id, kind: item.kind, price: item.price };
  });
}

// Puts on a skin the player owns, or (itemId null) goes back to the house look for that slot.
export function equipItem(user, slot, itemId) {
  if (!SLOTS.includes(slot)) throw new Error('INVALID_SLOT');
  const c = cosmetics(user);
  if (itemId === null || itemId === undefined || itemId === '') { c.equipped[slot] = null; return { slot, itemId: null }; }
  const item = itemById(itemId);
  if (!item || item.kind !== 'cosmetic') throw new Error('ITEM_NOT_FOUND');
  if (item.slot !== slot) throw new Error('INVALID_SLOT');
  if (!ownsCosmetic(user, item)) throw new Error('ITEM_NOT_OWNED');
  c.equipped[slot] = item.house ? null : item.id;
  return { slot, itemId: c.equipped[slot] };
}

// What a player has on, for the client to apply: only skins they still own (an achievement
// skin stays on once earned, since achievements never undo).
export function equippedOf(user) {
  const c = cosmetics(user), out = {};
  for (const slot of SLOTS) { const item = itemById(c.equipped[slot]); out[slot] = item && ownsCosmetic(user, item) ? item.id : null; }
  return out;
}

// The shop for this player: every skin with whether they own it, and the floor passes.
export function shopView(user) {
  const equipped = equippedOf(user);
  const achievementLabel = id => ACHIEVEMENTS.find(a => a.id === id)?.label ?? null;
  const season = monthBoundary();
  return {
    // 시즌 한정: this season's set, and old ones only for those who own them.
    season: { id: season.id, name: season.name, endsAt: season.endsAt },
    cosmetics: COSMETICS.filter(x => !x.season || x.season === season.id || ownsCosmetic(user, itemById(x.id))).map(x => {
      const item = itemById(x.id);
      const owned = ownsCosmetic(user, item), floor = x.floor ? FLOORS.find(f => f.slug === x.floor) : null;
      return { id: x.id, slot: x.slot, name: x.name, blurb: x.blurb, price: x.price, house: Boolean(x.house), achievement: x.achievement ?? null, achievementLabel: x.achievement ? achievementLabel(x.achievement) : null, floor: x.floor ?? null, season: x.season ?? null, onSale: !x.season || x.season === season.id, owned, renewable: Boolean(floor) && owned && !hasFloorPass(user, floor), equipped: x.house ? equipped[x.slot] === null : equipped[x.slot] === x.id };
    }),
    // Each floor's pass: whether this player holds it, has reached the floor, and sits there now.
    // The RP era asks for no pass: the RP tier opens the floors (lib/state.mjs), and the skins
    // are only skins (still grouped by floor, with the RP that opens each one).
    era: rpEra(),
    passes: FLOORS.filter(f => COSMETICS.some(x => x.floor === f.slug)).map(f => ({ slug: f.slug, name: f.name, minBet: f.minBet, threshold: f.threshold, rpNeed: rpTierStart(FLOORS.indexOf(f) + 1), items: PASS_ITEMS[f.slug], passed: hasFloorPass(user, f), unlocked: rpEra() ? floorOpen(user, f) : user.account.unlockedFloors.includes(f.slug), open: floorOpen(user, f) })),
    equipped
  };
}
