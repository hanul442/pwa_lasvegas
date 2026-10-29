// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser, netWorth } from '../lib/state.mjs';
import { COSMETICS, buyItem, equipItem, shopView, itemById } from '../lib/shop.mjs';
import { refundLuxury, upgradeEconomy, economyCurrent } from '../lib/economy-upgrade.mjs';
import { addLedger, floorsFor } from '../lib/economy.mjs';
import { supportStatus, claimSupport } from '../lib/engagement.mjs';
import { buildRankingSnapshot } from '../lib/rankings.mjs';
import { handleApi } from '../lib/api.mjs';
import { isMoney } from '../lib/constants.mjs';

const 억 = 100_000_000;

// The chain check from scripts/verify-ledger.mjs, run on an in-memory state.
function verifyLedger(state) {
  for (const user of Object.values(state.users)) {
    let available = 0, locked = 0;
    for (const tx of state.ledger.filter(x => x.userId === user.id)) {
      assert.equal(tx.availableBefore, available, `chain broken for ${user.id} at ${tx.type}`);
      assert.equal(tx.lockedBefore ?? locked, locked);
      available = tx.availableAfter; locked = tx.lockedAfter ?? locked;
    }
    assert.equal(available, user.account.available, `ledger and wallet disagree for ${user.id}`);
    assert.equal(locked, user.account.locked);
  }
}

function rich(amount = 3_000 * 억) {
  const state = defaultState();
  const u = newUser(state, 'rich', 'RICH');
  addLedger(state, u, { type: 'ADMIN_GRANT', amount, referenceType: 'TEST' });
  return { state, u };
}

test('every skin price is in 100만s, and 사치품 are gone from the catalog', () => {
  for (const x of COSMETICS) assert.ok(x.price === 0 || isMoney(x.price), x.id);
  for (const id of ['watch-steel', 'yacht', 'casino']) assert.equal(itemById(id), null, id);
  const { state, u } = rich();
  assert.throws(() => buyItem(state, u, 'yacht'), /ITEM_NOT_FOUND/);
  assert.equal('luxury' in shopView(u), false);
});

test('a skin purchase is a PURCHASE debit; one the wallet cannot cover is refused and changes nothing', () => {
  const { state, u } = rich(20 * 억);
  const felt = itemById('felt-navy');
  buyItem(state, u, 'felt-navy');
  const tx = state.ledger.at(-1);
  assert.equal(tx.type, 'PURCHASE');
  assert.equal(tx.amount, -felt.price);
  assert.equal(u.account.qualifiedPnl, 0, 'shopping is not a loss at the tables');
  const s2 = defaultState(), p = newUser(s2, 'p', 'P');
  const rows = s2.ledger.length;
  assert.throws(() => buyItem(s2, p, 'felt-navy'), /INSUFFICIENT_BANKROLL/);
  assert.equal(s2.ledger.length, rows);
  verifyLedger(state);
});

test('a retried buy with the same key runs once', () => {
  const { state, u } = rich();
  const first = buyItem(state, u, 'felt-navy', { key: 'shop-key-0001' });
  const again = buyItem(state, u, 'felt-navy', { key: 'shop-key-0001' });
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.equal(state.ledger.filter(x => x.type === 'PURCHASE').length, 1);
});

test('retiring 사치품 pays back exactly what each owner paid, once, and clears the feed', () => {
  const { state, u } = rich(5 * 억);
  const v = newUser(state, 'v', 'V');
  u.luxury = [{ id: 'yacht', price: 1_000 * 억, boughtAt: 'x' }, { id: 'watch-steel', price: 10 * 억, boughtAt: 'x' }];
  v.luxury = [];
  state.feed = [{ id: 'f1', type: 'LUXURY', actorId: 'rich', name: '나만의 카지노' }, { id: 'f2', type: 'JACKPOT', actorId: 'rich' }];
  delete state.meta.luxuryRefund;
  assert.equal(economyCurrent(state), false);
  upgradeEconomy(state);
  assert.equal(economyCurrent(state), true);
  assert.equal(u.account.available, 5 * 억 + 1_010 * 억);
  const row = state.ledger.at(-1);
  assert.equal(row.type, 'LUXURY_REFUND');
  assert.equal(row.amount, 1_010 * 억);
  assert.deepEqual(row.metadata, { items: ['yacht', 'watch-steel'], count: 2 });
  assert.equal('luxury' in u, false);
  assert.equal(state.ledger.filter(x => x.userId === 'v' && x.type === 'LUXURY_REFUND').length, 0, 'nothing owned, nothing paid');
  assert.ok(!state.feed.some(f => f.type === 'LUXURY'));
  assert.ok(state.feed.some(f => f.id === 'f2'), 'other news stays');
  const rows = state.ledger.length;
  upgradeEconomy(state);
  refundLuxury(state);
  assert.equal(state.ledger.length, rows, 'a second run pays nothing');
  verifyLedger(state);
});

test('skins: free and earned ones need no purchase, bought ones do, and only owned ones go on', () => {
  const { state, u } = rich(20 * 억);
  assert.throws(() => equipItem(u, 'felt', 'felt-navy'), /ITEM_NOT_OWNED/);
  assert.throws(() => buyItem(state, u, 'back-ivory'), /ITEM_NOT_FOR_SALE/, 'earned with an achievement, not sold');
  assert.throws(() => equipItem(u, 'cardBack', 'back-ivory'), /ITEM_NOT_OWNED/);
  assert.throws(() => equipItem(u, 'felt', 'back-lacquer'), /INVALID_SLOT/);
  assert.throws(() => equipItem(u, 'hat', null), /INVALID_SLOT/);
  assert.deepEqual(equipItem(u, 'cardBack', 'back-lacquer'), { slot: 'cardBack', itemId: null }, 'the house back is the empty slot');
  assert.equal(shopView(u).cosmetics.find(x => x.id === 'back-lacquer').equipped, true);

  buyItem(state, u, 'felt-navy');
  assert.equal(state.ledger.at(-1).type, 'PURCHASE');
  assert.equal(u.account.available, 20 * 억 - itemById('felt-navy').price);
  assert.equal(itemById('felt-navy').price, 억, 'the Salon Privé felt costs one of its 1억 bets');
  equipItem(u, 'felt', 'felt-navy');
  assert.equal(u.cosmetics.equipped.felt, 'felt-navy');
  assert.throws(() => buyItem(state, u, 'felt-navy'), /ITEM_ALREADY_OWNED/);
  equipItem(u, 'felt', null);
  assert.equal(u.cosmetics.equipped.felt, null);

  // The first win unlocks the ivory back.
  u.stats.Blackjack = { rounds: 1, wins: 1 };
  equipItem(u, 'cardBack', 'back-ivory');
  const view = shopView(u);
  assert.equal(view.cosmetics.find(x => x.id === 'back-ivory').equipped, true);
  assert.equal(view.cosmetics.find(x => x.id === 'back-ivory').achievementLabel, '첫 승리');
  verifyLedger(state);
});

test('the shop over the API: skins only, buy, equip, the refund notice and error codes', async () => {
  let state = defaultState();
  addLedger(state, state.users.hanseo, { type: 'ADMIN_GRANT', amount: 10 * 억, referenceType: 'TEST' });
  state.users.hanseo.luxury = [{ id: 'car-gt', price: 100 * 억, boughtAt: 'x' }];
  delete state.meta.luxuryRefund;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, key) => handleApi({ method, header: n => ({ 'x-player-id': 'hanseo', 'x-idempotency-key': key })[n], body: async () => body ?? {} }, new URL(`http://x${path}`), store, {});

  const s = (await call('GET', '/api/state')).data;
  const start = s.user.account.available;
  assert.equal(state.ledger.find(x => x.userId === 'hanseo' && x.type === 'LUXURY_REFUND').amount, 100 * 억, 'the car came back as chips');
  assert.equal(s.latestRefund.amount, 100 * 억);
  assert.equal(s.latestRefund.count, 1);
  assert.equal('luxury' in s.shop, false);
  assert.equal('luxury' in s.user, false);
  assert.equal('assets' in s.user, false);
  assert.deepEqual(Object.keys(s.shop.cosmetics[0]).sort(), ['achievement', 'achievementLabel', 'blurb', 'equipped', 'floor', 'house', 'id', 'name', 'owned', 'price', 'renewable', 'slot'].sort());
  assert.deepEqual(s.shop.equipped, { cardBack: null, felt: null, chips: null, frame: null });
  const row = buildRankingSnapshot(state).wealth.find(r => r.id === 'hanseo');
  assert.equal('showcase' in row, false);

  const felt = await call('POST', '/api/shop/buy', { itemId: 'felt-navy' }, 'buy-key-00000003');
  assert.equal(felt.status, 200, JSON.stringify(felt.data));
  assert.equal(felt.data.state.user.account.available, start - itemById('felt-navy').price);
  const replay = await call('POST', '/api/shop/buy', { itemId: 'felt-navy' }, 'buy-key-00000003');
  assert.equal(replay.data.replayed, true);
  const on = await call('POST', '/api/shop/equip', { slot: 'felt', itemId: 'felt-navy' });
  assert.equal(on.data.state.user.cosmetics.equipped.felt, 'felt-navy');
  const notMine = await call('POST', '/api/shop/equip', { slot: 'chips', itemId: 'chips-onyx' });
  assert.equal(notMine.status, 409);
  assert.equal(notMine.data.error, 'ITEM_NOT_OWNED');
  const badSlot = await call('POST', '/api/shop/equip', { slot: 'wallpaper', itemId: null });
  assert.equal(badSlot.data.error, 'INVALID_SLOT');
  const gone = await call('POST', '/api/shop/sell', { itemId: 'car-gt' }, 'sell-key-0000001');
  assert.equal(gone.status, 404, 'selling back is gone with the 사치품');
  const missing = await call('POST', '/api/shop/buy', { itemId: 'yacht' }, 'buy-key-00000004');
  assert.equal(missing.status, 404);
  verifyLedger(state);
});

test('out of chips pays the bailout whatever else the player owns (한서)', () => {
  const state = defaultState(), u = newUser(state, 'rich', 'RICH');
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: 200 * 억, referenceType: 'TEST' });
  buyItem(state, u, 'felt-forest');
  assert.equal(supportStatus(u).welfare.qualified, false, 'still has chips');
  addLedger(state, u, { type: 'ADMIN_DEDUCT', amount: -u.account.available, referenceType: 'TEST' });
  assert.equal(supportStatus(u).welfare.qualified, true, 'a felt does not block it');
  assert.equal(claimSupport(state, u, 'welfare').amount, 100 * 억);
  verifyLedger(state);
});
