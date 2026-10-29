// RP 시즌 (2026-10-29, 한서 "Rp시즌 오늘부터 진행해", "오늘 전부 전환"): RP is the tier and opens the
// floors (three times apart from 1천만), the bank lends no more, pay is the same for everyone, and
// money sits in a wallet that buys each table's chips (lib/cashier.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser, floorRefusal, tableBase, netWorth } from '../lib/state.mjs';
import { addLedger, floorsFor, settleHouseGame } from '../lib/economy.mjs';
import { rankView, rankStandings, settleFinishedRankSeason, monthBoundary } from '../lib/rank-season.mjs';
import { noteRp, rpView, rpPointsNow } from '../lib/rank-points.mjs';
import { dailyStatus, claimDaily, supportStatus, claimSupport, WELFARE_STEPS, WELFARE_BELOW, PAY_MIN } from '../lib/engagement.mjs';
import { buyIn, cashOut, sweepChips, buyInRange, cashierView } from '../lib/cashier.mjs';
import { buyItem } from '../lib/shop.mjs';
import { borrow, fileBankruptcy, bankView } from '../lib/bank.mjs';
import { shopView } from '../lib/shop.mjs';
import { FLOORS, STAKE_TIERS, stakeTierFor } from '../lib/constants.mjs';

const OCT = Date.parse('2026-10-29T12:00:00+09:00');
const NOV1 = Date.parse('2026-11-01T00:30:00+09:00');
const NOV = Date.parse('2026-11-10T12:00:00+09:00');
const DEC1 = Date.parse('2026-12-01T00:30:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };
const player = (state, id, name) => { const u = newUser(state, id, name); return u; };
const giveRp = (u, points, now) => { noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: 10_000_000 }, now); u.rp.points = points; u.rp.peak = points; };

test('the RP season starts 2026-10-29: tier, board, floors, pay and the bank all switch in October', () => {
  const state = defaultState();
  const a = player(state, 'a', 'AAA'), b = player(state, 'b', 'BBB');
  at(OCT, () => {
    addLedger(state, a, { type: 'ADMIN_GRANT', amount: 500e9 }); // rich but no RP
    giveRp(b, 520, OCT);
  });
  const rows = at(OCT, () => rankStandings(state));
  assert.deepEqual(rows.map(r => r.id), ['b'], 'only players with RP rank, by RP');
  assert.equal(rows[0].tier, 'platinum');
  const view = at(OCT, () => rankView(state, b));
  assert.equal(view.mode, 'rp');
  assert.equal(view.carry, true, 'October ends by dropping RP, not by a chip reset');
  assert.equal(view.rp, 520);
  assert.deepEqual(view.next, { id: 'platinum', division: 'III', need: 30 }, 'next step is the next division');
  assert.equal(view.division, 'IV');
  at(OCT, () => {
    assert.equal(floorRefusal(a, FLOORS[1]), 'FLOOR_RP_LOCKED', 'chips no longer open floors');
    assert.equal(floorRefusal(b, FLOORS[3]), null);
    assert.equal(bankView(a).closed, true);
    assert.equal(rpView(b).era, true);
    assert.equal(rpView(b).floors, true);
  });
});

test('November: RP opens the floors, with no pass and nothing outgrown', () => {
  const state = defaultState();
  const u = player(state, 'u', 'UUU');
  at(NOV, () => {
    assert.equal(floorRefusal(u, FLOORS[0]), null);
    assert.equal(floorRefusal(u, FLOORS[1]), 'FLOOR_RP_LOCKED');
    assert.equal(tableBase(u), FLOORS[0].minBet);
    giveRp(u, 210, NOV); // 실버: the High Limit
    assert.equal(floorRefusal(u, FLOORS[0]), null, 'lower floors stay open');
    assert.equal(floorRefusal(u, FLOORS[1]), null);
    assert.equal(floorRefusal(u, FLOORS[2]), 'FLOOR_RP_LOCKED');
    assert.equal(tableBase(u), FLOORS[1].minBet);
    const floors = floorsFor(u);
    assert.deepEqual(floors.slice(0, 3).map(f => f.open), [true, true, false]);
    assert.equal(floors[2].rpNeed, 350);
    assert.equal(floors[2].rpRemaining, 140);
    assert.ok(floors.every(f => !f.outgrown && f.passed));
    assert.equal(shopView(u).era, true);
    giveRp(u, 1490, NOV);
    assert.equal(floorRefusal(u, FLOORS.at(-1)), 'FLOOR_RP_LOCKED');
    giveRp(u, 1500, NOV);
    assert.equal(floorRefusal(u, FLOORS.at(-1)), null, '그랜드마스터 opens the top floor');
  });
});

test('floors are three times apart, 1천만 to 300억, and a table takes every bet up to ten times its smallest', () => {
  assert.deepEqual(FLOORS.map(f => f.minBet), [1e7, 3e7, 1e8, 3e8, 1e9, 3e9, 1e10, 3e10]);
  assert.ok(FLOORS.every(f => f.maxBet === f.minBet * 10));
  assert.equal(stakeTierFor(1e8).slug, 'salon-prive');
  assert.equal(stakeTierFor(99_000_000).slug, 'high-limit');
  assert.deepEqual(FLOORS[0].stakeTiers, ['gold-room', 'high-limit', 'salon-prive']);
  for (let i = 1; i < STAKE_TIERS.length; i++) assert.equal(STAKE_TIERS[i].minBet, STAKE_TIERS[i - 1].maxBet + 1);
});

test('pay and 구제금융 are the same on every floor, and the bank lends no more', () => {
  const state = defaultState();
  const low = player(state, 'low', 'LOW'), high = player(state, 'high', 'HIGH');
  at(NOV, () => {
    giveRp(high, 990, NOV);
    assert.equal(dailyStatus(low).reward, dailyStatus(high).reward);
    assert.equal(dailyStatus(high).reward, PAY_MIN.daily);
    claimDaily(state, high);
    const w = supportStatus(low).welfare;
    assert.equal(w.below, WELFARE_BELOW);
    assert.equal(w.perDay, WELFARE_STEPS.length);
    assert.equal(claimSupport(state, low, 'welfare').amount, WELFARE_STEPS[0]);
    assert.equal(bankView(low).closed, true);
    assert.throws(() => borrow(state, low, { lender: 'first', amount: 1e7, days: 7 }), /BANK_CLOSED/);
    assert.throws(() => fileBankruptcy(state, low), /BANK_CLOSED/);
  });
});

test('the cashier: chips nobody sits with go to the wallet, a buy-in buys a table stack, getting up cashes it back', () => {
  const state = defaultState();
  const u = player(state, 'u', 'UUU');
  at(OCT, () => {
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 5e9 });
    const worth = netWorth(u);
    sweepChips(state);
    assert.equal(u.account.available, 0);
    assert.equal(u.account.wallet, 5e9);
    assert.equal(netWorth(u), worth, 'moving money never changes what a player is worth');
    const range = buyInRange(u, FLOORS[0]);
    assert.deepEqual([range.min, range.max, range.default], [2e8, 1e9, 5e8]);
    assert.throws(() => buyIn(state, u, { floor: 'gold-room', amount: 1e8 }), /BUY_IN_OUT_OF_RANGE/);
    assert.throws(() => buyIn(state, u, { floor: 'high-limit', amount: 1e9 }), /FLOOR_RP_LOCKED/);
    buyIn(state, u, { floor: 'gold-room', amount: 5e8 });
    assert.equal(u.account.available, 5e8);
    assert.equal(u.account.wallet, 45e8);
    sweepChips(state);
    assert.equal(u.account.available, 5e8, 'a seated player keeps the stack');
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 1e8 }); // a win at the table
    assert.equal(cashOut(state, u).amount, 6e8);
    assert.equal(u.account.available, 0);
    assert.equal(u.account.wallet, 51e8);
    assert.equal(cashierView(u).seat, null);
    // The shop takes wallet money.
    buyItem(state, u, 'felt-navy');
    assert.ok(u.account.wallet < 51e8);
    assert.equal(u.account.available, 0);
    // A wallet with money in it is not broke.
    assert.equal(supportStatus(u).welfare.qualified, false);
  });
});

test('October and November are one season: 11/1 closes nothing, 12/1 closes it by RP and keeps the chips', () => {
  const state = defaultState();
  const a = player(state, 'a', 'AAA'), b = player(state, 'b', 'BBB');
  at(OCT, () => {
    settleFinishedRankSeason(state);
    addLedger(state, a, { type: 'ADMIN_GRANT', amount: 900e9 });
    giveRp(a, 120, OCT);
    giveRp(b, 950, OCT);
    a.loans = [{ id: 'l1', balance: 5e8 }];
  });
  assert.equal(at(NOV1, () => settleFinishedRankSeason(state)), null, '11/1 is mid-season');
  const season = monthBoundary(NOV);
  assert.equal(season.id, 'rank-2026-10');
  assert.equal(season.name, '10~11월 시즌');
  assert.equal(season.endsAt, new Date(DEC1 - 30 * 60_000).toISOString(), 'closes 12/1 00:00 KST');
  assert.equal(at(NOV, () => rpPointsNow(b)), 950, 'RP carries on through November');
  noteRp(b, { game: 'Baccarat', stake: 1e7, netPnl: 1e7 }, NOV);
  assert.ok(b.rp.points > 950 && b.rp.season === 'rank-2026-10');
  b.rp.points = 950;
  const closed = at(DEC1, () => settleFinishedRankSeason(state));
  assert.equal(closed.id, 'rank-2026-10');
  assert.equal(closed.mode, 'rp');
  assert.deepEqual(closed.podium.map(p => [p.userId, p.tier, p.rp]), [['b', 'diamond', 950], ['a', 'bronze', 120]]);
  assert.equal(b.badges[0].tier, 'diamond');
  assert.equal(b.rankHistory[0].rp, 950);
  assert.equal(a.account.available, 900e9, 'no chip reset');
  assert.deepEqual(a.loans, [], 'old loans are written off');
  assert.equal(b.rank.reset.mode, 'rp');
  assert.equal(b.rank.reset.carry, 350);
  assert.equal(at(DEC1, () => rpPointsNow(b)), 350, '다이아몬드 950 → 골드 350');
  assert.equal(at(DEC1, () => rankView(state, b)).tier, 'gold');
  assert.equal(at(DEC1, () => rpPointsNow(a)), 0);
  assert.equal(monthBoundary(DEC1).id, 'rank-2026-12', 'from December, one month a season again');
  assert.equal(monthBoundary(Date.parse('2027-01-01T00:30:00+09:00') - 86_400_000).endsAt, '2026-12-31T15:00:00.000Z');
});

test('losing the table stack with money in the wallet is not a bust; a top-up fills the seat back up', () => {
  const state = defaultState();
  const u = player(state, 'u', 'UUU');
  at(OCT, () => {
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 5e9 });
    // Chips held without a seat count as wallet money for the next buy-in.
    assert.deepEqual([buyInRange(u, FLOORS[0]).wallet, buyInRange(u, FLOORS[0]).inHand], [5e9, 0]);
    sweepChips(state);
    buyIn(state, u, { floor: 'gold-room', amount: 2e8 });
    settleHouseGame(state, u, { game: 'Baccarat', stake: 2e8, netPnl: -2e8, roundId: 'r1' });
    assert.equal(u.account.available, 0);
    assert.equal(u.bankruptcies.length, 0, 'the wallet still holds 48억');
    // A top-up from the seat: from one smallest bet up to a 100-bet stack.
    buyIn(state, u, { floor: 'gold-room', amount: 3e8 });
    let r = buyInRange(u, FLOORS[0]);
    assert.deepEqual([r.inHand, r.min, r.max], [3e8, 1e7, 7e8]);
    buyIn(state, u, { floor: 'gold-room', amount: 1e7 });
    assert.equal(u.account.available, 31e7);
    buyIn(state, u, { floor: 'gold-room', amount: 69e7 });
    assert.throws(() => buyIn(state, u, { floor: 'gold-room', amount: 1e7 }), /BUY_IN_STACK_FULL/);
    // Everything gone, wallet included: that is a bust.
    cashOut(state, u);
    u.account.wallet = 1e7; u.account.seat = null;
    buyIn(state, u, { floor: 'gold-room', amount: 1e7 });
    settleHouseGame(state, u, { game: 'Baccarat', stake: 1e7, netPnl: -1e7, roundId: 'r2' });
    assert.equal(u.bankruptcies.length, 1);
  });
});

test('the RP season over the API: buy in, play, a locked floor, cash out, the closed bank', async () => {
  const { handleApi } = await import('../lib/api.mjs');
  let state = defaultState();
  addLedger(state, state.users.hanseo, { type: 'ADMIN_GRANT', amount: 10e9, referenceType: 'TEST' });
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  let n = 0;
  const call = (method, path, body) => handleApi({ method, header: h => ({ 'x-player-id': 'hanseo', 'x-idempotency-key': `rp-season-key-${String(++n).padStart(4, '0')}` })[h], body: async () => body ?? {} }, new URL(`http://x${path}`), store, {});
  const s = (await call('GET', '/api/state')).data;
  assert.equal(s.rankSeason.mode, 'rp');
  assert.equal(s.bank.closed, true);
  assert.equal(s.cashier.on, true);
  assert.deepEqual(s.floors.filter(f => f.open).map(f => f.slug), ['gold-room']);
  const short = await call('POST', '/api/baccarat/play', { stake: 1e7, betType: 'PLAYER', floor: 'gold-room' });
  assert.equal(short.data.error, 'BUY_IN_REQUIRED', 'the first change swept the chips into the wallet');
  const bought = await call('POST', '/api/cashier/buyin', { floor: 'gold-room', amount: 5e8 });
  assert.equal(bought.status, 200, JSON.stringify(bought.data));
  assert.equal(bought.data.state.user.account.available, 5e8);
  assert.equal(bought.data.state.cashier.wallet, s.user.account.available + s.user.account.wallet - 5e8);
  const ok = await call('POST', '/api/baccarat/play', { stake: 1e7, betType: 'PLAYER', floor: 'gold-room' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const locked = await call('POST', '/api/baccarat/play', { stake: 3e7, betType: 'PLAYER', floor: 'high-limit' });
  assert.equal(locked.data.error, 'FLOOR_RP_LOCKED');
  const out = await call('POST', '/api/cashier/cashout');
  assert.equal(out.data.state.user.account.available, 0);
  assert.equal(out.data.state.cashier.wallet, out.data.state.user.account.wallet);
  assert.equal(netWorth(state.users.hanseo), state.users.hanseo.account.wallet);
  const loan = await call('POST', '/api/bank/borrow', { lender: 'first', amount: 1e7, days: 7 });
  assert.equal(loan.data.error, 'BANK_CLOSED');
});
