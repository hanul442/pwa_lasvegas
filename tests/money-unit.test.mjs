// Every amount moves in whole 100만s (한서's call): bets, payouts, blinds, raises, split pots,
// loans and handouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MONEY_UNIT, payout } from '../lib/constants.mjs';
import { defaultState, newUser } from '../lib/state.mjs';
import { validateStakeAgainstFloor } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { settleHouseGame, rechargeStatus } from '../lib/economy.mjs';
import { HOLDEM_BLINDS, createHoldemSession, dealNextHand, heroAction } from '../lib/holdem-session.mjs';
import { createTable, startHand, legalActions, applyAction } from '../lib/holdem.mjs';
import { startSeotda, seotdaOptions } from '../lib/seotda.mjs';
import { borrow, repay } from '../lib/bank.mjs';

const U = MONEY_UNIT;
const units = x => x % U === 0;
function seededRand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('a bet between 100만s is refused at every table', () => {
  const state = defaultState();
  const u = newUser(state, 'unit', 'UNIT');
  u.account.available = 50_000_000;
  const gold = FLOORS[0];
  assert.doesNotThrow(() => validateStakeAgainstFloor(u, gold, 3_000_000));
  assert.throws(() => validateStakeAgainstFloor(u, gold, 1_500_000), /BET_NOT_IN_UNITS/);
});

test('payouts between 100만s round to the nearest 100만, halves to the player', () => {
  assert.equal(payout(1_000_000, 1_500_000), 2_000_000, 'blackjack 3:2 on 100만');
  assert.equal(payout(3_000_000, 4_500_000), 5_000_000);
  assert.equal(payout(10_000_000, 15_000_000), 15_000_000);
  // A settlement that still lands between units is rounded, and a loss never passes the stake.
  const state = defaultState();
  const u = newUser(state, 'unit', 'UNIT');
  u.account.available = 50_000_000;
  settleHouseGame(state, u, { game: 'Slots', stake: 1_000_000, netPnl: 1_400_000, roundId: 'r1' });
  assert.equal(u.account.available, 51_000_000);
  settleHouseGame(state, u, { game: 'Slots', stake: 1_000_000, netPnl: -1_000_000, roundId: 'r2' });
  assert.equal(u.account.available, 50_000_000);
});

test("Hold'em blinds are whole 100만s, and stacks stay in 100만s hand after hand", () => {
  assert.deepEqual(HOLDEM_BLINDS['gold-room'], { small: 1_000_000, big: 2_000_000 });
  assert.deepEqual(HOLDEM_BLINDS['high-limit'], { small: 1_000_000, big: 2_000_000 });
  assert.deepEqual(HOLDEM_BLINDS['salon-prive'], { small: 5_000_000, big: 10_000_000 });
  for (const t of Object.values(HOLDEM_BLINDS)) assert.ok(units(t.small) && units(t.big));
  for (let seed = 1; seed <= 12; seed++) {
    const rand = seededRand(seed);
    const s = createHoldemSession({ userId: 'u1', nickname: '나', buyIn: 10_000_000, tier: 'gold-room', floor: 'gold-room', opponents: 5 }, rand);
    for (let hand = 0; hand < 15 && s.table.seats[0].stack > 0; hand++) {
      dealNextHand(s, rand);
      let guard = 0;
      while (s.table.hand && !s.table.hand.over && ++guard < 50) {
        const legal = legalActions(s.table, 0);
        heroAction(s, legal.canCheck ? { type: 'CHECK' } : { type: 'CALL' }, rand);
      }
      assert.ok(s.table.seats.every(x => units(x.stack)), `seed ${seed} hand ${hand}: ${s.table.seats.map(x => x.stack)}`);
    }
  }
});

test("a Hold'em raise between 100만s is refused unless it is all in", () => {
  const seats = [0, 1, 2].map(i => ({ id: `p${i}`, name: `p${i}`, kind: 'human', stack: 50_000_000 }));
  const t = createTable({ seats, smallBlind: 1_000_000, bigBlind: 2_000_000, unit: U });
  startHand(t);
  const i = t.hand.toAct, legal = legalActions(t, i);
  assert.throws(() => applyAction(t, i, { type: 'RAISE', amount: legal.minRaiseTo + 500_000 }), /INVALID_RAISE/);
  assert.doesNotThrow(() => applyAction(t, i, { type: 'RAISE', amount: legal.minRaiseTo + U }));
});

test('섯다 raises move in at least 100만', () => {
  const round = startSeotda({ stake: 1_000_000, seats: [{ name: 'a' }, { name: 'b' }], rng: () => 0, first: 0 });
  for (const o of seotdaOptions(round, round.turn)) assert.ok(units(o.cost), `${o.action} ${o.cost}`);
});

test('loans are borrowed and repaid in 100만s, except paying off the last won', () => {
  const state = defaultState();
  const u = newUser(state, 'unit', 'UNIT');
  const now = Date.parse('2026-10-14T03:00:00Z');
  assert.throws(() => borrow(state, u, { lender: 'shark', amount: 1_500_000, days: 7 }, now), /AMOUNT_NOT_IN_UNITS/);
  const loan = borrow(state, u, { lender: 'shark', amount: 10_000_000, days: 7 }, now);
  assert.throws(() => repay(state, u, { loanId: loan.id, amount: 2_500_000 }, now), /AMOUNT_NOT_IN_UNITS/);
  repay(state, u, { loanId: loan.id, amount: 3_000_000 }, now);
  assert.equal(loan.balance, 7_000_000);
  loan.balance = 6_999_999; // an old loan from before 100만 units
  assert.equal(repay(state, u, { loanId: loan.id }, now).closed, true);
});

test('the top-up rounds up to a whole 100만', () => {
  const state = defaultState();
  const u = newUser(state, 'unit', 'UNIT');
  u.account.available = 1_234_567;
  assert.ok(units(rechargeStatus(u).amount));
});
