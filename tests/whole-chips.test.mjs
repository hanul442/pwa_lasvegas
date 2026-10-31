// A table never shows part of a chip (한서 2026-10-31: "최소하고 소슷점있는거뭐냐", "소숫점으로 거는거
// 하지말랫지"). One chip is a hundredth of the floor's smallest bet, and every amount at a table is
// a whole number of chips on every floor: blinds, antes, buy-ins, bets, payouts, tournament blinds
// and prizes, and the stack itself. RP is whole points too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOORS, MONEY_UNIT, chipValueOf, tableUnitOf, tableGrain, payout } from '../lib/constants.mjs';
import { HOLDEM_BLINDS, royaleBlinds, ROYALE, createHoldemSession, dealNextHand, heroAction } from '../lib/holdem-session.mjs';
import { SEVEN_ANTES, MIN_ANTES, createSevenSession, dealNextHand as dealSeven, heroAction as sevenAction } from '../lib/sevenpoker-session.mjs';
import { legalActions } from '../lib/holdem.mjs';
import { legalActions as sevenLegal } from '../lib/sevenpoker.mjs';
import { TOURNEY, tourneyBlinds, tourneyPayouts } from '../lib/holdem-tourney.mjs';
import { defaultState, newUser } from '../lib/state.mjs';
import { lockBet, settleLockedHouseGame, addLedger } from '../lib/economy.mjs';
import { buyInRange, sweepChips } from '../lib/cashier.mjs';
import { validateStakeAgainstFloor, inTableUnits } from '../lib/stakes.mjs';
import { rpForRound } from '../lib/rank-points.mjs';
import { chipCount, chipValueFor, tableUnitFor, holdemBlindsFor, setTableUnits, formatCH, formatMoney } from '../public/js/money.js';

function seededRand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const whole = (floor, x) => x % chipValueOf(floor) === 0;
const inUnit = (floor, x) => x % tableUnitOf(floor) === 0 && x % tableGrain() === 0;

test('every floor: one chip is a hundredth of the smallest bet, and a table moves one chip at a time', () => {
  for (const f of FLOORS) {
    assert.equal(chipValueOf(f), f.minBet / 100, f.slug);
    assert.ok(Number.isSafeInteger(chipValueOf(f)), f.slug);
    assert.equal(tableUnitOf(f), chipValueOf(f), f.slug);
    // The client reads the same numbers (public/js/money.js).
    assert.equal(chipValueFor(f.minBet), chipValueOf(f), f.slug);
    assert.equal(tableUnitFor(f.minBet), tableUnitOf(f), f.slug);
  }
});

test('Hold\'em blinds are 10/20칩 and the 7포커 ante 10칩 on every floor, the minimum buy-in 100칩', () => {
  for (const f of FLOORS) {
    const b = HOLDEM_BLINDS[f.slug], chip = chipValueOf(f);
    assert.deepEqual(b, { small: 10 * chip, big: 20 * chip }, f.slug);
    assert.ok(inUnit(f, b.small) && inUnit(f, b.big), f.slug);
    assert.deepEqual(holdemBlindsFor(f.minBet), b, `${f.slug}: client and server agree`);
    assert.equal(SEVEN_ANTES[f.slug], 10 * chip, f.slug);
    assert.equal(SEVEN_ANTES[f.slug] * MIN_ANTES, f.minBet, f.slug);
    assert.equal(b.big * 5, f.minBet, f.slug);
  }
});

test('tournament and event blinds climb in whole chips; prizes split in whole chips', () => {
  for (const f of FLOORS) {
    const unit = tableUnitOf(f), base = HOLDEM_BLINDS[f.slug].big;
    for (let level = 0; level < TOURNEY.ladder.length + 1; level++) {
      const b = tourneyBlinds(base, level, unit);
      assert.ok(inUnit(f, b.small) && inUnit(f, b.big), `${f.slug} level ${level}: ${b.small}/${b.big}`);
      const r = royaleBlinds(f.maxBet, level, ROYALE, unit);
      assert.ok(inUnit(f, r.small) && inUnit(f, r.big), `${f.slug} royale level ${level}`);
    }
    for (const people of [2, 3, 4, 5, 6, 7]) {
      for (const k of [1, 3, 7]) {
        const prize = people * k * 37 * unit;
        const pay = tourneyPayouts(prize, people, unit);
        assert.equal(pay.reduce((a, x) => a + x, 0), prize);
        assert.ok(pay.every(x => inUnit(f, x)), `${f.slug}: ${pay}`);
      }
    }
  }
});

test('solo Hold\'em and 7포커: every stack stays whole chips hand after hand, on every floor', () => {
  for (const f of FLOORS) {
    for (let seed = 1; seed <= 3; seed++) {
      const rand = seededRand(seed * 31 + f.minBet % 97);
      const buyIn = f.minBet * (1 + (seed % 3)) + 3 * tableUnitOf(f);
      const s = createHoldemSession({ userId: 'u', nickname: '나', buyIn, tier: f.slug, floor: f.slug, opponents: 5 }, rand);
      for (let hand = 0; hand < 6 && s.table.seats[0].stack > 0 && s.status === 'SEATED'; hand++) {
        dealNextHand(s, rand);
        let guard = 0;
        while (s.table.hand && !s.table.hand.over && ++guard < 60) {
          const l = legalActions(s.table, 0);
          // Raise now and then so bet sizes other than the blinds show up.
          const act = rand() < 0.3 && l.canRaise ? { type: 'RAISE', amount: l.minRaiseTo } : l.canCheck ? { type: 'CHECK' } : { type: 'CALL' };
          heroAction(s, act, rand);
        }
        assert.ok(s.table.seats.every(x => whole(f, x.stack) && inUnit(f, x.stack)), `${f.slug} seed ${seed} hand ${hand}: ${s.table.seats.map(x => x.stack / chipValueOf(f))}`);
      }
      const seven = createSevenSession({ userId: 'u', nickname: '나', buyIn, tier: f.slug, floor: f.slug, opponents: 3 }, rand);
      for (let hand = 0; hand < 4 && seven.table.seats[0].stack > 0 && seven.status === 'SEATED'; hand++) {
        dealSeven(seven, rand);
        let guard = 0;
        while (seven.table.hand && !seven.table.hand.over && ++guard < 60) {
          const l = sevenLegal(seven.table, 0);
          if (!l) break;
          if (l.phase === 'CHOOSE') sevenAction(seven, { type: 'OPEN', index: 0 }, rand);
          else sevenAction(seven, l.canCheck ? { type: 'CHECK' } : { type: 'CALL' }, rand);
        }
        assert.ok(seven.table.seats.every(x => inUnit(f, x.stack)), `${f.slug} 7포커 seed ${seed}: ${seven.table.seats.map(x => x.stack / chipValueOf(f))}`);
      }
    }
  }
});

function seatedAt(floor, chips) {
  const state = defaultState();
  const user = newUser(state, 'chips', 'CHIPS');
  user.account.available = chips;
  user.account.wallet = 1_000 * floor.minBet + 1_234_000_000;
  user.account.locked = 0;
  user.account.seat = { floor: floor.slug, at: new Date().toISOString() };
  return { state, user };
}

test('payouts between chips settle to whole chips (banker 5%, 3:2, horse odds, slot lines)', () => {
  for (const f of FLOORS) {
    const { state, user } = seatedAt(f, 50 * f.minBet);
    const unit = tableUnitOf(f);
    for (let k = 0; k < 60; k++) {
      const stake = unit * (1 + (k % 23));
      const id = `r-${f.slug}-${k}`;
      lockBet(state, user, { stake, game: 'Baccarat', roundId: id });
      // An engine's raw net, often between chips: the commission, 3:2, a 2.45배 horse, a loss.
      const raw = [stake * 0.95, stake * 1.5, Math.floor(stake * 1.45), -stake, 0, Math.round(stake * 0.37)][k % 6];
      const tx = settleLockedHouseGame(state, user, { game: 'Baccarat', stake, netPnl: raw, roundId: id });
      assert.ok(inUnit(f, tx.amount), `${f.slug}: paid ${tx.amount / chipValueOf(f)} chips`);
      assert.ok(inUnit(f, user.account.available), `${f.slug}: stack ${user.account.available / chipValueOf(f)} chips`);
    }
  }
});

test('a seated stack with part of a chip (pay landing mid-table) sends that part to the wallet', () => {
  const f = FLOORS.find(x => x.slug === 'high-limit');
  const { state, user } = seatedAt(f, 100 * f.minBet);
  const before = user.account.available + user.account.wallet;
  addLedger(state, user, { type: 'DAILY_PAY', amount: 1_000_000 }); // 100만 = 3.3 chips at the 클럽
  sweepChips(state);
  assert.ok(inUnit(f, user.account.available), `${user.account.available / chipValueOf(f)} chips`);
  assert.equal(user.account.available + user.account.wallet, before + 1_000_000, 'nothing is lost');
});

test('buy-ins are offered and taken in whole chips; a bet between chips is refused', () => {
  for (const f of FLOORS) {
    const { user } = seatedAt(f, 0);
    user.account.seat = null;
    const r = buyInRange(user, f);
    for (const x of [r.min, r.max, r.default]) assert.ok(inUnit(f, x), `${f.slug}: ${x / chipValueOf(f)} chips`);
    assert.ok(inTableUnits(f, f.minBet + tableUnitOf(f)), f.slug);
    if (chipValueOf(f) > MONEY_UNIT) assert.equal(inTableUnits(f, f.minBet + MONEY_UNIT), false, `${f.slug}: 100만 more is part of a chip`);
  }
  // At the floor itself (the 홀 is open to everyone): a bet that is part of a chip off is refused.
  const hall = FLOORS[0], { user } = seatedAt(hall, 50 * hall.minBet);
  assert.throws(() => validateStakeAgainstFloor(user, hall, hall.minBet + 50_000), /BET_NOT_IN_UNITS/);
  assert.ok(validateStakeAgainstFloor(user, hall, hall.minBet + tableUnitOf(hall)));
});

test('chip counts on screen never have a decimal point', () => {
  for (const f of FLOORS) {
    setTableUnits(true, chipValueFor(f.minBet));
    for (const v of [1, 99_999, 1_000_000, 2_000_000, 4_000_000, 20_000_000, 3_333_333, f.minBet / 3, f.minBet * 0.95, f.maxBet, -1_000_000, 0]) {
      for (const text of [chipCount(v), formatCH(v), formatMoney(v)]) assert.doesNotMatch(text, /\./, `${f.slug} ${v}: ${text}`);
    }
  }
  setTableUnits(false);
});

test('RP from a round is whole points', () => {
  const rand = seededRand(7);
  for (let k = 0; k < 500; k++) {
    const stake = FLOORS[k % FLOORS.length].minBet * (1 + (k % 9));
    const net = Math.round((rand() * 4 - 1.2) * stake);
    const rp = rpForRound({ stake, netPnl: net, points: Math.floor(rand() * 2500), game: k % 3 ? 'Blackjack' : 'Slots' });
    assert.ok(Number.isInteger(rp), `${stake} ${net}: ${rp}`);
  }
});

test('a win reads exactly what the bet earns: banker 95칩 on 100칩, 3:2 is 150칩, at every floor', () => {
  for (const f of FLOORS) {
    const chip = chipValueOf(f), { state, user } = seatedAt(f, 50 * f.minBet);
    for (const [k, [raw, want]] of [[100 * chip * 0.95, 95], [100 * chip * 1.5, 150], [110 * chip * 1.5, 165], [130 * chip * 0.95, 123.5]].entries()) {
      const id = `x-${f.slug}-${k}`, stake = (k === 2 ? 110 : k === 3 ? 130 : 100) * chip;
      lockBet(state, user, { stake, game: 'Baccarat', roundId: id });
      if (Number.isInteger(want)) assert.equal(payout(stake, raw, () => 0.5) % chip, 0, `${f.slug}: engine payout ${payout(stake, raw, () => 0.5) / chip}`);
      const tx = settleLockedHouseGame(state, user, { game: 'Baccarat', stake, netPnl: payout(stake, raw, () => 0.5), roundId: id });
      const won = (tx.amount - stake) / chip;
      if (Number.isInteger(want)) assert.equal(won, want, `${f.slug}: won ${won} chips, want ${want}`);
      else assert.ok(won === Math.floor(want) || won === Math.ceil(want), `${f.slug}: ${won}`);
    }
  }
});
