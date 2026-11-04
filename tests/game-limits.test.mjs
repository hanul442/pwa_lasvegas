// 게임별 차등 (2026-11-04, 한서): poker moves RP hand by hand, games of pure chance move it less,
// each game has its own buy-in, and each bet type its own least and most.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { addLedger, lockBet, settleLockedHouseGame, notePokerHandRp } from '../lib/economy.mjs';
import { rpForRound, rpOf, promoRoundResult, rpBetCap } from '../lib/rank-points.mjs';
import { buyIn, buyInRange, sweepChips } from '../lib/cashier.mjs';
import { betTypeRange, checkBetTypes, BUY_IN_BY_GAME, buyInRangeOf } from '../lib/bet-limits.mjs';
import { FLOORS } from '../lib/constants.mjs';

const NOV = Date.parse('2026-11-10T12:00:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };
const HALL = FLOORS[0], MIN = HALL.minBet;
// A silver player (500 RP) plays the Club, where a win and a loss of one bet are ±10.
const S = FLOORS[1].minBet, SILVER = 500;

test('단순 베팅 게임: slots move RP three tenths, roulette, sic bo and the races half, both ways', () => {
  const s = S;
  assert.equal(rpForRound({ game: 'Blackjack', stake: s, netPnl: s, points: SILVER }), 10);
  assert.equal(rpForRound({ game: 'Blackjack', stake: s, netPnl: -s, points: SILVER }), -10);
  assert.equal(rpForRound({ game: 'Slots', stake: s, netPnl: s, points: SILVER }), 3);
  assert.equal(rpForRound({ game: 'Slots', stake: s, netPnl: -s, points: SILVER }), -3);
  for (const game of ['Roulette', 'Sic Bo', 'Horse Racing']) {
    assert.equal(rpForRound({ game, stake: s, netPnl: s, points: SILVER }), 5, game);
    assert.equal(rpForRound({ game, stake: s, netPnl: -s, points: SILVER }), -5, game);
  }
});

test('홀덤: each hand moves RP as it ends, small pots wait for a whole point, and getting up adds only the rest', () => {
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  at(NOV, () => {
    rpOf(u, NOV); u.rp.points = SILVER; u.rp.peak = SILVER;
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 100 * S });
    const session = {};
    assert.equal(notePokerHandRp(state, u, session, { game: "Hold'em", stake: S, net: 2 * S }), 20, 'won two smallest bets: +20 right away');
    assert.equal(u.rp.points, 520);
    assert.equal(notePokerHandRp(state, u, session, { game: "Hold'em", stake: S, net: S / 20 }), 0, 'half a point waits');
    assert.equal(notePokerHandRp(state, u, session, { game: "Hold'em", stake: S, net: S / 20 }), 1, 'the second half makes one');
    assert.equal(notePokerHandRp(state, u, session, { game: "Hold'em", stake: S, net: -S }), -10);
    assert.equal(u.rp.points, 511);
    assert.equal(session.rpNet, S + S / 10);
    // Getting up mid-hand lost a smallest bet more than the hands counted: only that is new RP.
    const buy = 50 * S, net = session.rpNet - S;
    lockBet(state, u, { stake: buy, game: "Hold'em", roundId: 'h1' });
    settleLockedHouseGame(state, u, { game: "Hold'em", stake: buy, netPnl: net, roundId: 'h1', rpStake: S, rpNet: net - session.rpNet });
    assert.equal(u.rp.points, 501);
    // A stand-up after a finished hand adds nothing.
    const rounds = u.rp.rounds;
    lockBet(state, u, { stake: buy, game: "Hold'em", roundId: 'h2' });
    settleLockedHouseGame(state, u, { game: "Hold'em", stake: buy, netPnl: S, roundId: 'h2', rpStake: S, rpNet: 0 });
    assert.equal(u.rp.points, 501);
    assert.equal(u.rp.rounds, rounds);
  });
});

test('홀덤: a single hand counts for a 승급전 only when it won or lost most of a smallest bet', () => {
  assert.equal(promoRoundResult({ game: "Hold'em", stake: 100, netPnl: 15, hand: true }), null, 'stole the blinds');
  assert.equal(promoRoundResult({ game: "Hold'em", stake: 100, netPnl: -10, hand: true }), null, 'folded the big blind');
  assert.equal(promoRoundResult({ game: "Hold'em", stake: 100, netPnl: 90, hand: true }), 'win');
  assert.equal(promoRoundResult({ game: "Hold'em", stake: 100, netPnl: -120, hand: true }), 'loss');
});

test('베팅 방법별 한도: longer odds hold less, outside even money asks for more, never above the division cap', () => {
  const f = FLOORS[2];
  const full = r => betTypeRange(f, f.maxBet, ...r);
  assert.deepEqual(full(['Roulette', 'RED']), { min: 2 * f.minBet, max: f.maxBet });
  assert.deepEqual(full(['Roulette', 'NUMBER', 17]), { min: 0, max: 2 * f.minBet });
  assert.deepEqual(full(['Roulette', 'DOZEN', 1]), { min: 0, max: 6 * f.minBet });
  assert.deepEqual(full(['Sic Bo', 'TOTAL', 10]), { min: 0, max: 3 * f.minBet });
  assert.deepEqual(full(['Sic Bo', 'TOTAL', 4]), { min: 0, max: 2 * f.minBet });
  assert.deepEqual(full(['Baccarat', 'TIE']), { min: 0, max: 3 * f.minBet });
  assert.deepEqual(full(['Baccarat', 'BANKER']), { min: f.minBet, max: f.maxBet });
  assert.deepEqual(full(['Horse Racing', 'WIN']), { min: f.minBet, max: 5 * f.minBet });
  assert.deepEqual(full(['Slots', 'LINE']), { min: f.minBet, max: 5 * f.minBet });
  // A division V player on this floor bets at most 4 smallest bets: red stops there too.
  const cap = 4 * f.minBet;
  assert.equal(betTypeRange(f, cap, 'Roulette', 'RED').max, cap);
  assert.equal(betTypeRange(f, cap, 'Roulette', 'DOZEN').max, cap);
  assert.throws(() => checkBetTypes(f, f.maxBet, 'Roulette', [{ betType: 'NUMBER', target: 7, stake: 3 * f.minBet }]), /BET_TYPE_OVER_LIMIT/);
  assert.throws(() => checkBetTypes(f, f.maxBet, 'Roulette', [{ betType: 'RED', stake: f.minBet }]), /BET_TYPE_UNDER_MIN/);
  checkBetTypes(f, f.maxBet, 'Roulette', [{ betType: 'RED', stake: 2 * f.minBet }, { betType: 'NUMBER', target: 7, stake: f.minBet / 100 }]);
  // Every limit is whole chips (a chip is a hundredth of the smallest bet): no part of one anywhere.
  for (const fl of FLOORS) for (const game of ['Roulette', 'Sic Bo', 'Baccarat', 'Horse Racing', 'Slots']) {
    for (const bt of ['RED', 'NUMBER', 'DOZEN', 'TOTAL', 'TIE', 'BANKER', 'WIN', 'PLACE', 'EXACTA', 'LINE', 'BIG', 'ANY_TRIPLE']) {
      const r = betTypeRange(fl, rpBetCap(1100, FLOORS.indexOf(fl)), game, bt, 10);
      assert.ok(Number.isSafeInteger(r.min / (fl.minBet / 100)) && Number.isSafeInteger(r.max / (fl.minBet / 100)), `${fl.slug} ${game} ${bt}`);
    }
  }
});

test('게임별 바이인: each game sits down with its own number of smallest bets', () => {
  assert.deepEqual(BUY_IN_BY_GAME.slots, { min: 10, max: 100, default: 20 });
  assert.deepEqual(BUY_IN_BY_GAME.poker, { min: 50, max: 300, default: 100 });
  const rich = { wallet: 1000 * MIN, min: MIN, unit: MIN / 100 };
  assert.deepEqual(((({ min, max, default: d }) => [min, max, d])(buyInRangeOf({ ...rich, game: 'slots' }))), [10 * MIN, 100 * MIN, 20 * MIN]);
  assert.deepEqual(((({ min, max, default: d }) => [min, max, d])(buyInRangeOf({ ...rich, game: 'roulette' }))), [10 * MIN, 200 * MIN, 30 * MIN]);
  assert.deepEqual(((({ min, max, default: d }) => [min, max, d])(buyInRangeOf({ ...rich, game: 'poker' }))), [50 * MIN, 300 * MIN, 100 * MIN]);
  assert.deepEqual(((({ min, max, default: d }) => [min, max, d])(buyInRangeOf({ ...rich }))), [20 * MIN, 300 * MIN, 50 * MIN], 'no game: as before');
  const state = defaultState();
  const u = newUser(state, 'b', 'B');
  at(NOV, () => {
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 1000 * MIN });
    sweepChips(state);
    assert.equal(buyInRange(u, HALL, 'slots').max, 100 * MIN);
    assert.throws(() => buyIn(state, u, { floor: HALL.slug, amount: 150 * MIN, game: 'slots' }), /BUY_IN_OUT_OF_RANGE/);
    assert.throws(() => buyIn(state, u, { floor: HALL.slug, amount: 20 * MIN, game: 'poker' }), /BUY_IN_OUT_OF_RANGE/);
    buyIn(state, u, { floor: HALL.slug, amount: 60 * MIN, game: 'slots' });
    assert.equal(u.account.seat.game, 'slots');
    // A top-up stops at the game's most.
    assert.equal(buyInRange(u, HALL, 'slots').max, 40 * MIN);
    assert.throws(() => buyIn(state, u, { floor: HALL.slug, amount: 50 * MIN, game: 'slots' }), /BUY_IN_OUT_OF_RANGE/);
  });
});
