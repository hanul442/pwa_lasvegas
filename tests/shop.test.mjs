import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser, netWorth } from '../lib/state.mjs';
import { LUXURY, COSMETICS, SELL_RATE, buyItem, sellItem, equipItem, shopView, itemById } from '../lib/shop.mjs';
import { addLedger, floorsFor } from '../lib/economy.mjs';
import { borrow, bankruptcyStatus, fileBankruptcy } from '../lib/bank.mjs';
import { supportStatus } from '../lib/engagement.mjs';
import { newsFor } from '../lib/news.mjs';
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

test('the catalog climbs from 1억 to over 1조, every price in 100만s', () => {
  assert.equal(LUXURY[0].price, 억);
  assert.ok(LUXURY.at(-1).price >= 10_000 * 억);
  for (let k = 1; k < LUXURY.length; k++) assert.ok(LUXURY[k].price > LUXURY[k - 1].price, `${LUXURY[k].id} is dearer than the one before`);
  for (const x of [...LUXURY, ...COSMETICS]) assert.ok(x.price === 0 || isMoney(x.price), x.id);
  for (const g of ['시계', '슈퍼카', '요트', '아파트', '빌딩', '전용기', '섬', '카지노']) assert.ok(LUXURY.some(x => x.group === g), g);
});

test('buying is a PURCHASE debit and selling back pays 70% of the price, both on the ledger', () => {
  const { state, u } = rich();
  const before = u.account.available;
  const apt = itemById('apt-gangnam');
  const bought = buyItem(state, u, 'apt-gangnam');
  assert.equal(bought.price, apt.price);
  assert.equal(u.account.available, before - apt.price);
  const tx = state.ledger.at(-1);
  assert.equal(tx.type, 'PURCHASE');
  assert.equal(tx.amount, -apt.price);
  assert.equal(tx.referenceType, 'SHOP');
  assert.equal(u.account.qualifiedPnl, 0, 'shopping is not a loss at the tables');
  assert.deepEqual(u.luxury.map(x => x.id), ['apt-gangnam']);
  assert.throws(() => buyItem(state, u, 'apt-gangnam'), /ITEM_ALREADY_OWNED/);

  const sold = sellItem(state, u, 'apt-gangnam');
  assert.equal(SELL_RATE, 0.7);
  assert.equal(sold.amount, 105 * 억);
  assert.equal(state.ledger.at(-1).type, 'RESALE');
  assert.equal(u.account.available, before - apt.price + 105 * 억);
  assert.deepEqual(u.luxury, []);
  assert.throws(() => sellItem(state, u, 'apt-gangnam'), /ITEM_NOT_OWNED/);
  assert.throws(() => sellItem(state, u, 'felt-navy'), /ITEM_NOT_SELLABLE/);
  verifyLedger(state);
});

test('a purchase the wallet cannot cover is refused and changes nothing', () => {
  const { state, u } = rich(2 * 억);
  const rows = state.ledger.length;
  assert.throws(() => buyItem(state, u, 'car-gt'), /INSUFFICIENT_BANKROLL/);
  assert.equal(u.account.available, 2 * 억);
  assert.equal(state.ledger.length, rows);
  assert.deepEqual(u.luxury ?? [], []);
  assert.throws(() => buyItem(state, u, 'nope'), /ITEM_NOT_FOUND/);
  // Chips on a table can't pay for anything.
  addLedger(state, u, { type: 'BET_LOCK', amount: -2 * 억, lockedDelta: 2 * 억, referenceType: 'GAME_ROUND', referenceId: 'r' });
  assert.throws(() => buyItem(state, u, 'watch-steel'), /INSUFFICIENT_BANKROLL/);
  verifyLedger(state);
});

test('a retried buy with the same key runs once', () => {
  const { state, u } = rich();
  const first = buyItem(state, u, 'yacht', { key: 'shop-key-0001' });
  const again = buyItem(state, u, 'yacht', { key: 'shop-key-0001' });
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.equal(state.ledger.filter(x => x.type === 'PURCHASE').length, 1);
  assert.throws(() => sellItem(state, u, 'yacht', { key: 'shop-key-0001' }), /IDEMPOTENCY_CONFLICT/);
});

test('assets never open floors: floors run on chips minus debt alone', () => {
  const { state, u } = rich(1_000 * 억);
  const floorsBefore = floorsFor(u).map(f => [f.slug, f.unlocked]);
  buyItem(state, u, 'building');
  assert.equal(u.account.available, 0);
  assert.equal(netWorth(u), 0, 'the building is not net worth');
  assert.equal(u.account.progressionValue, 0);
  assert.deepEqual(floorsFor(u).map(f => [f.slug, f.unlocked]), floorsBefore, 'floors already open stay open');
  // A newcomer handed a building opens nothing with it.
  const s2 = defaultState(), v = newUser(s2, 'v', 'V');
  v.luxury = [{ id: 'casino', price: itemById('casino').price, boughtAt: new Date().toISOString() }];
  addLedger(s2, v, { type: 'ADMIN_GRANT', amount: 1_000_000, referenceType: 'TEST' });
  assert.deepEqual(v.account.unlockedFloors, ['gold-room']);
  assert.equal(v.account.progressionValue, 1_000_000);
});

test('debt you could pay by selling luxury blocks bankruptcy, and filing repossesses it', () => {
  const state = defaultState(), u = newUser(state, 'b', 'B');
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: 3 * 억, referenceType: 'TEST' });
  borrow(state, u, { lender: 'shark', amount: 5 * 억, days: 1 });
  buyItem(state, u, 'car-gt');
  assert.equal(u.account.available, 0);
  assert.match(bankruptcyStatus(u).reason, /사치품/, '5.6억 back for the car covers 5억 of debt');
  assert.equal(supportStatus(u).welfare.qualified, false, 'no bailout while holding a car to sell');

  const v = newUser(state, 'c', 'C');
  borrow(state, v, { lender: 'shark', amount: 5 * 억, days: 1 });
  buyItem(state, v, 'watch-tourbillon');
  assert.equal(bankruptcyStatus(v).eligible, true, '3.5억 back for the watch cannot cover 5억 of debt');
  fileBankruptcy(state, v);
  assert.deepEqual(v.luxury, []);
  assert.deepEqual(state.ledger.find(tx => tx.userId === v.id && tx.type === 'DEBT_DISCHARGED').metadata.repossessed, ['watch-tourbillon']);
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
  assert.equal(itemById('felt-navy').price, 6_000 * 10_000, 'the Salon Privé felt is a fifth of the 3억 that opens the floor');
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

test('a top-shelf purchase makes the news for everyone else', () => {
  const { state, u } = rich(30_000 * 억);
  newUser(state, 'friend', 'FRIEND');
  const since = Date.now() - 1000;
  buyItem(state, u, 'yacht');
  assert.ok(!state.feed.some(f => f.type === 'LUXURY'), 'a yacht is not headline news');
  buyItem(state, u, 'casino');
  assert.equal(state.feed[0].type, 'LUXURY');
  const [item] = newsFor(state, 'friend', since);
  assert.equal(item.type, 'LUXURY');
  assert.match(item.body, /RICH님이 나만의 카지노를 2조/);
  assert.equal(item.push, true);
  assert.equal(newsFor(state, 'rich', since).length, 0, 'not news to the buyer');
  const row = buildRankingSnapshot(state).wealth.find(r => r.id === 'rich');
  assert.equal(row.assets, itemById('casino').price + itemById('yacht').price);
  assert.deepEqual(row.showcase, ['casino', 'yacht']);
});

test('the shop over the API: state shape, buy, sell, equip and error codes', async () => {
  let state = defaultState();
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, key) => handleApi({ method, header: n => ({ 'x-player-id': 'hanseo', 'x-idempotency-key': key })[n], body: async () => body ?? {} }, new URL(`http://x${path}`), store, {});

  const s = (await call('GET', '/api/state')).data;
  assert.equal(s.shop.sellRate, 0.7);
  assert.equal(s.shop.assets, 0);
  assert.equal(s.shop.luxury.length, LUXURY.length);
  assert.deepEqual(Object.keys(s.shop.luxury[0]).sort(), ['blurb', 'boughtAt', 'group', 'headline', 'icon', 'id', 'name', 'owned', 'paid', 'price', 'resale'].sort());
  assert.deepEqual(Object.keys(s.shop.cosmetics[0]).sort(), ['achievement', 'achievementLabel', 'blurb', 'equipped', 'floor', 'house', 'id', 'name', 'owned', 'price', 'slot'].sort());
  assert.deepEqual(s.shop.equipped, { cardBack: null, felt: null, chips: null, frame: null });
  assert.deepEqual(s.user.cosmetics, { owned: [], equipped: { cardBack: null, felt: null, chips: null, frame: null } });
  assert.deepEqual(s.user.luxury, []);
  assert.equal(s.user.assets, 0);
  assert.ok(s.users.every(x => Array.isArray(x.luxury) && Number.isFinite(x.assets)), 'everyone else sees each player’s assets');

  const buy = await call('POST', '/api/shop/buy', { itemId: 'car-hyper' }, 'buy-key-00000001');
  assert.equal(buy.status, 409);
  assert.equal(buy.data.error, 'INSUFFICIENT_BANKROLL');
  const watch = await call('POST', '/api/shop/buy', { itemId: 'watch-tourbillon' }, 'buy-key-00000002');
  assert.equal(watch.status, 200, JSON.stringify(watch.data));
  assert.equal(watch.data.state.user.account.available, 5 * 억);
  assert.equal(watch.data.state.shop.assets, 5 * 억);
  assert.equal(watch.data.state.user.assets, 5 * 억);
  assert.equal(watch.data.state.shop.luxury.find(x => x.id === 'watch-tourbillon').owned, true);
  const replay = await call('POST', '/api/shop/buy', { itemId: 'watch-tourbillon' }, 'buy-key-00000002');
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.state.user.account.available, 5 * 억);

  const felt = await call('POST', '/api/shop/buy', { itemId: 'felt-navy' }, 'buy-key-00000003');
  assert.equal(felt.status, 200);
  assert.equal(felt.data.state.user.account.available, 5 * 억 - itemById('felt-navy').price);
  const on = await call('POST', '/api/shop/equip', { slot: 'felt', itemId: 'felt-navy' });
  assert.equal(on.data.state.user.cosmetics.equipped.felt, 'felt-navy');
  assert.equal(on.data.state.shop.equipped.felt, 'felt-navy');
  const notMine = await call('POST', '/api/shop/equip', { slot: 'chips', itemId: 'chips-onyx' });
  assert.equal(notMine.status, 409);
  assert.equal(notMine.data.error, 'ITEM_NOT_OWNED');
  const badSlot = await call('POST', '/api/shop/equip', { slot: 'wallpaper', itemId: null });
  assert.equal(badSlot.data.error, 'INVALID_SLOT');
  const off = await call('POST', '/api/shop/equip', { slot: 'felt', itemId: null });
  assert.equal(off.data.state.user.cosmetics.equipped.felt, null);
  assert.equal(off.data.state.shop.cosmetics.find(x => x.id === 'felt-house').equipped, true);

  const sell = await call('POST', '/api/shop/sell', { itemId: 'watch-tourbillon' }, 'sell-key-0000001');
  assert.equal(sell.status, 200);
  assert.equal(sell.data.sale.amount, 3.5 * 억);
  assert.equal(sell.data.state.user.account.available, 8.5 * 억 - itemById('felt-navy').price);
  assert.equal(sell.data.state.shop.assets, 0);
  const missing = await call('POST', '/api/shop/sell', { itemId: 'nope' }, 'sell-key-0000002');
  assert.equal(missing.status, 404);
  verifyLedger(state);
});
