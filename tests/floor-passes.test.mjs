import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser, floorOpen, hasFloorPass, tableBase } from '../lib/state.mjs';
import { buyItem, equipItem, shopView } from '../lib/shop.mjs';
import { COSMETICS, PASS_ITEMS, SLOTS } from '../lib/cosmetics.mjs';
import { addLedger, floorsFor } from '../lib/economy.mjs';
import { validateStakeAgainstFloor } from '../lib/stakes.mjs';
import { upgradeEconomy, economyCurrent } from '../lib/economy-upgrade.mjs';
import { FLOORS, isMoney } from '../lib/constants.mjs';

const 억 = 100_000_000;
const floor = slug => FLOORS.find(f => f.slug === slug);

function player(amount) {
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: amount - u.account.available, referenceType: 'TEST' });
  return { state, u };
}

test('every floor above the Gold Room has a skin in each slot, priced one to three of its smallest bets', () => {
  assert.deepEqual(Object.keys(PASS_ITEMS), FLOORS.slice(1).map(f => f.slug));
  for (const f of FLOORS.slice(1)) {
    const items = COSMETICS.filter(x => x.floor === f.slug);
    assert.deepEqual(items.map(x => x.slot).sort(), [...SLOTS].sort(), f.slug);
    for (const x of items) {
      assert.ok(isMoney(x.price), x.id);
      assert.ok(x.price >= f.minBet && x.price <= f.minBet * 3, x.id);
    }
  }
  assert.equal(new Set(COSMETICS.map(x => x.id)).size, COSMETICS.length, 'ids are unique');
});

test('reaching a floor by net worth is not enough: one of its skins opens it', () => {
  const { state, u } = player(3 * 억);
  const high = floor('high-limit');
  assert.ok(u.account.unlockedFloors.includes('high-limit'), 'reached by net worth');
  assert.equal(hasFloorPass(u, high), false);
  assert.throws(() => validateStakeAgainstFloor(u, high, high.minBet), /FLOOR_PASS_REQUIRED/);
  // Past the Gold Room's 1억 ceiling, the Gold Room stays open until the next floor can be entered.
  assert.equal(floorOpen(u, floor('gold-room')), true);
  assert.equal(tableBase(u), floor('gold-room').minBet);
  const view = floorsFor(u).find(f => f.slug === 'high-limit');
  assert.equal(view.unlocked, true);
  assert.equal(view.passed, false);
  assert.equal(view.open, false);
  assert.equal(view.outgrown, false);
  assert.equal(shopView(u).passes.find(p => p.slug === 'high-limit').passed, false);

  const bought = buyItem(state, u, 'felt-forest');
  assert.equal(bought.pass, 'high-limit', 'the first skin of a floor says it opened the floor');
  assert.equal(u.account.available, 3 * 억 - COSMETICS.find(x => x.id === 'felt-forest').price);
  assert.equal(buyItem(state, u, 'chips-onyx').pass, undefined, 'a second one opens nothing new');
  assert.doesNotThrow(() => validateStakeAgainstFloor(u, high, high.minBet));
  assert.equal(floorOpen(u, floor('gold-room')), false, 'now the Gold Room is outgrown');
  assert.equal(floorsFor(u).find(f => f.slug === 'gold-room').outgrown, true);
  assert.equal(tableBase(u), high.minBet);
  equipItem(u, 'felt', 'felt-forest');
  assert.equal(u.cosmetics.equipped.felt, 'felt-forest');
});

test('a skin bought before the floor is reached waits for the net worth', () => {
  const { state, u } = player(2_500_0000);
  buyItem(state, u, 'felt-forest');
  const high = floor('high-limit');
  assert.equal(hasFloorPass(u, high), true);
  assert.throws(() => validateStakeAgainstFloor(u, high, high.minBet), /FLOOR_LOCKED/);
  equipItem(u, 'felt', 'felt-forest');
  assert.equal(shopView(u).equipped.felt, 'felt-forest');
});

test('floors players had reached before passes stay theirs; later players buy in', () => {
  const state = defaultState();
  const u = newUser(state, 'old', 'OLD');
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: 20 * 억, referenceType: 'TEST' });
  delete state.meta.floorPasses; // a world saved before floor passes
  assert.equal(economyCurrent(state), false);
  assert.equal(upgradeEconomy(state), true);
  assert.equal(economyCurrent(state), true);
  assert.deepEqual(u.account.floorPasses, ['high-limit', 'salon-prive']);
  assert.equal(floorOpen(u, floor('salon-prive')), true);
  assert.equal(upgradeEconomy(state), false, 'once');

  const fresh = newUser(state, 'new', 'NEW');
  addLedger(state, fresh, { type: 'ADMIN_GRANT', amount: 20 * 억, referenceType: 'TEST' });
  assert.equal(fresh.account.floorPasses, undefined);
  assert.equal(floorOpen(fresh, floor('salon-prive')), false);
  assert.equal(floorOpen(fresh, floor('gold-room')), true, 'still has a table to sit at');
  // A pass for Salon Privé alone does not skip High Limit's.
  buyItem(state, fresh, 'back-navy');
  assert.equal(floorOpen(fresh, floor('salon-prive')), true);
  assert.equal(floorOpen(fresh, floor('high-limit')), false);
  assert.equal(floorOpen(fresh, floor('gold-room')), true, 'the Gold Room stays open while High Limit is closed');
});
