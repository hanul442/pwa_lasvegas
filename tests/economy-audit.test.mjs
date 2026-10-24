// The holes the 2026-10-19 economy audit closed (한서 "3번빼고 다 진행").
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser, netWorth, tableBase, rewardBase, loanBase, hasFloorPass } from '../lib/state.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { addLedger, lockBet, settleLockedHouseGame } from '../lib/economy.mjs';
import { lenderOffer, LENDERS, borrow, loanFreezeAt } from '../lib/bank.mjs';
import { settleFinishedRankSeason, rankView } from '../lib/rank-season.mjs';
import { claimAchievement, achievementsView } from '../lib/achievements.mjs';
import { onRoundSettled, missionsStatus, claimMission, MISSIONS } from '../lib/engagement.mjs';
import { validateRoomStake } from '../lib/stakes.mjs';
import { buyItem } from '../lib/shop.mjs';
import { grantSeasonPasses } from '../lib/economy-upgrade.mjs';

const 억 = 100_000_000, 조 = 10_000 * 억;
const floor = slug => FLOORS.find(f => f.slug === slug);
const OCT_14 = Date.parse('2026-10-14T03:00:00Z');
const NOV_1 = Date.parse('2026-11-01T00:00:00+09:00') + 60_000;
const grant = (state, u, amount) => addLedger(state, u, { type: 'ADMIN_GRANT', amount, referenceType: 'TEST' });

test('chips on a table when the season closes go to the house as they come off it', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-31T14:00:00Z') });
  const state = defaultState(); state.meta.rankSince = 'rank-2026-10';
  const u = newUser(state, 'p', 'P');
  grant(state, u, 10 * 억);
  lockBet(state, u, { stake: 8 * 억, game: "Hold'em", roundId: 'sat-through-midnight' });
  t.mock.timers.setTime(NOV_1);
  settleFinishedRankSeason(state, NOV_1);
  assert.equal(u.account.available, 0);
  assert.equal(u.account.seasonOwed, 8 * 억);
  assert.equal(netWorth(u), 0, 'the chips still on the table are owed back');
  assert.equal(rankView(state, u, NOV_1).peak, 0);
  // The new month's pay is the player's own; only what comes back from the old table is taken.
  grant(state, u, 1 * 억);
  settleLockedHouseGame(state, u, { game: "Hold'em", stake: 8 * 억, netPnl: 4 * 억, roundId: 'sat-through-midnight' });
  assert.equal(u.account.available, 1 * 억 + 4 * 억, 'the win made after midnight stays, the old stake goes');
  assert.equal(u.account.seasonOwed, 0);
  assert.ok(state.ledger.some(x => x.userId === 'p' && x.type === 'SEASON_RESET' && x.amount === -8 * 억 && x.metadata.fromTable));
});

test('a stake that is lost after the reset settles what was owed', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-31T14:00:00Z') });
  const state = defaultState(); state.meta.rankSince = 'rank-2026-10';
  const u = newUser(state, 'p', 'P');
  grant(state, u, 10 * 억);
  lockBet(state, u, { stake: 8 * 억, game: "Hold'em", roundId: 'r' });
  t.mock.timers.setTime(NOV_1);
  settleFinishedRankSeason(state, NOV_1);
  settleLockedHouseGame(state, u, { game: "Hold'em", stake: 8 * 억, netPnl: -8 * 억, roundId: 'r' });
  assert.equal(u.account.seasonOwed, 0);
  assert.equal(state.ledger.some(x => x.userId === 'p' && x.metadata?.fromTable), false, 'nothing came back to take');
});

test('no new loans in a month\'s last three days, and the rank counts only debt-free worth', t => {
  const state = defaultState(), u = newUser(state, 'p', 'P');
  const shark = LENDERS.find(l => l.slug === 'shark');
  assert.equal(loanFreezeAt(OCT_14), null);
  const late = Date.parse('2026-10-29T01:00:00+09:00');
  assert.ok(loanFreezeAt(late));
  assert.match(lenderOffer(u, shark, late).reason, /월말/);
  assert.equal(lenderOffer(u, shark, Date.parse('2026-11-02T01:00:00+09:00')).eligible, true);

  t.mock.timers.enable({ apis: ['Date'], now: OCT_14 });
  grant(state, u, 2 * 억);
  const peakBefore = u.rank.peak;
  borrow(state, u, { lender: 'shark', amount: 5 * 억, days: 1 }, OCT_14);
  grant(state, u, 50 * 억); // a big win made with borrowed chips
  assert.equal(u.rank.peak, peakBefore, 'nothing counts while the loan is open');
  assert.equal(rankView(state, u, OCT_14).peak, peakBefore);
});

test('achievement and mission rewards pay the base of when they were done, not of when they are claimed', () => {
  const state = defaultState(), u = newUser(state, 'p', 'P');
  grant(state, u, 5_000 * 10_000); // 5천만: High Limit unlocked while the Gold Room is the base
  assert.equal(rewardBase(u), 1_000_000);
  assert.equal(achievementsView(u).find(a => a.id === 'floor-high-limit').reward, 20 * 1_000_000);
  // Then the player climbs to the Vault before claiming.
  u.account.floorPasses = FLOORS.slice(1).map(f => f.slug);
  grant(state, u, 2 * 조);
  assert.ok(tableBase(u) >= 100 * 억);
  assert.equal(claimAchievement(state, u, 'floor-high-limit').amount, 20 * 1_000_000);
  assert.equal(claimAchievement(state, u, 'floor-vault').amount, 60 * rewardBase(u), 'one reached up here pays up here');

  const v = newUser(state, 'q', 'Q');
  grant(state, v, 5 * 1_000_000);
  v.missions = { day: missionsStatus(v).day, items: [{ id: 'rounds-any', progress: 9, claimed: false }, { id: 'rounds-blackjack', progress: 0, claimed: false }, { id: 'rounds-slots', progress: 0, claimed: false }], games: [], swept: false };
  onRoundSettled(state, v, { game: 'Roulette', stake: 1_000_000, netPnl: -1_000_000 });
  v.account.floorPasses = ['high-limit', 'salon-prive'];
  grant(state, v, 200 * 억);
  assert.ok(rewardBase(v) > 1_000_000);
  const pays = MISSIONS.find(m => m.id === 'rounds-any').pays;
  assert.equal(claimMission(state, v, 'rounds-any').amount, pays * 1_000_000);
});

test('rewards stop growing at the Vault and loan limits at the Sky Lounge', () => {
  const state = defaultState(), u = newUser(state, 'p', 'P');
  u.account.floorPasses = FLOORS.slice(1).map(f => f.slug);
  grant(state, u, 2_000 * 조);
  assert.equal(tableBase(u), floor('olympus').minBet);
  assert.equal(rewardBase(u), floor('vault').minBet);
  assert.equal(loanBase(u), floor('sky-lounge').minBet);
  assert.equal(lenderOffer(u, LENDERS.find(l => l.slug === 'shark'), OCT_14).limit, 500 * floor('sky-lounge').minBet);
});

test('a new account uses friends\' rooms only up to the High Limit for its first week', () => {
  const state = defaultState(), u = newUser(state, 'p', 'P');
  grant(state, u, 100 * 억);
  assert.throws(() => validateRoomStake(u, floor('penthouse'), 10 * 억), /NEW_ACCOUNT_ROOM_LIMIT/);
  assert.doesNotThrow(() => validateRoomStake(u, floor('high-limit'), 5_000 * 10_000));
  u.createdAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
  assert.doesNotThrow(() => validateRoomStake(u, floor('penthouse'), 10 * 억));
});

test('a floor pass lasts the month: after the reset the owned skin is bought again to renew it', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T03:00:00Z') });
  const state = defaultState(); state.meta.rankSince = 'rank-2026-10';
  const u = newUser(state, 'p', 'P');
  grant(state, u, 1 * 억);
  const out = buyItem(state, u, 'felt-forest');
  assert.equal(out.pass, 'high-limit');
  assert.ok(hasFloorPass(u, floor('high-limit')));
  assert.throws(() => buyItem(state, u, 'felt-forest'), /ITEM_ALREADY_OWNED/, 'no second pass while one is held');
  t.mock.timers.setTime(NOV_1);
  settleFinishedRankSeason(state, NOV_1);
  assert.equal(hasFloorPass(u, floor('high-limit')), false, 'the reset ends this month\'s passes');
  assert.ok(u.cosmetics.owned.includes('felt-forest'), 'the skin itself stays');
  grant(state, u, 1 * 억);
  const renewed = buyItem(state, u, 'felt-forest');
  assert.equal(renewed.renew, true);
  assert.equal(u.account.available, 1 * 억 - renewed.price);
  assert.ok(hasFloorPass(u, floor('high-limit')));
  assert.equal(u.cosmetics.owned.filter(x => x === 'felt-forest').length, 1);
});

test('skins bought before passes became monthly keep their floor open until the month ends', () => {
  const state = defaultState(), u = newUser(state, 'p', 'P');
  u.cosmetics = { owned: ['felt-navy'], equipped: {} };
  u.account.floorPasses = [];
  grantSeasonPasses(state);
  assert.deepEqual(u.account.floorPasses, ['salon-prive']);
  assert.equal(state.meta.seasonPasses, true);
});
