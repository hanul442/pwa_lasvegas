// RP 구멍 막기 (2026-10-30): 승급전 needs a real win, RP counts a win up to 3× its bet, and a
// friend's room can't decide a 승급전.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { lockBet, settleLockedHouseGame } from '../lib/economy.mjs';
import { rpForRound, rpOf, noteRp, promoRoundResult, RP_PAYOUT_CAP } from '../lib/rank-points.mjs';

const OCT = Date.parse('2026-10-29T12:00:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };

test('배당 상한: a win counts for RP up to 3× its bet, losses as before', () => {
  assert.equal(RP_PAYOUT_CAP, 3);
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 1_000_000 }), 10);
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 2_000_000 }), 20, 'a column bet');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 35_000_000 }), 30, 'straight-up: 35× counts as 3×');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 499_000_000 }), 30, 'lightning 499×');
  assert.equal(rpForRound({ stake: 10_000_000, netPnl: 50_000_000_000 }), 30, 'slot jackpot');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: -1_000_000 }), -7);
});

test('배당 상한: 100 lightning straight-ups no longer climb (they lose RP on average)', () => {
  // 1 in 37 hits; even at 499× each hit is +30 while each miss is −7.
  const ev = (1 / 37) * rpForRound({ stake: 1, netPnl: 499 }) + (36 / 37) * rpForRound({ stake: 1, netPnl: -1 });
  assert.ok(ev < -5, `EV per spin ${ev}`);
});

test('승급전: a roulette cover of 35 numbers is not a win; banker 0.95 and blackjack are', () => {
  assert.equal(promoRoundResult({ game: 'Roulette', stake: 35, netPnl: 1 }), null, '35-number cover hit: no win, no loss');
  assert.equal(promoRoundResult({ game: 'Roulette', stake: 35, netPnl: -35 }), 'loss');
  assert.equal(promoRoundResult({ game: 'Roulette', stake: 19, netPnl: 17 }), null, '19 numbers: just under');
  assert.equal(promoRoundResult({ game: 'Roulette', stake: 10, netPnl: 10 }), 'win', 'red');
  assert.equal(promoRoundResult({ game: 'Baccarat', stake: 100, netPnl: 95 }), 'win', 'banker');
  assert.equal(promoRoundResult({ game: 'Blackjack', stake: 100, netPnl: 150 }), 'win');
  assert.equal(promoRoundResult({ game: 'Matgo', stake: 100, netPnl: 30 }), 'win', 'a deposit game counts any win');
  assert.equal(promoRoundResult({ game: "Hold'em", stake: 100, netPnl: 5 }), 'win', 'a poker session counts any win');
  assert.equal(promoRoundResult({ game: 'Blackjack', stake: 100, netPnl: 100, room: true }), null, 'friend room');
  assert.equal(promoRoundResult({ game: 'Blackjack', stake: 100, netPnl: 0 }), null, 'push');
});

test('승급전: the covered wheel now fails the series instead of passing it 99%', () => {
  const u = newUser(defaultState(), 'p', 'P');
  at(OCT, () => { rpOf(u, OCT); u.rp.points = 85; u.rp.promo = { active: true, target: 'bronze', wins: 0, losses: 0, minStake: 10_000_000 }; });
  const stake = 35 * 1_000_000;
  for (let i = 0; i < 5; i++) noteRp(u, { game: 'Roulette', stake, netPnl: 1_000_000 }, OCT);
  assert.equal(u.rp.promo.wins, 0);
  assert.equal(u.rp.promo.active, true);
  noteRp(u, { game: 'Roulette', stake, netPnl: -stake }, OCT);
  noteRp(u, { game: 'Roulette', stake, netPnl: -stake }, OCT);
  assert.equal(u.rp.promo.result, 'lost');
});

test('친구방: a round settled with a room code moves RP (capped) but never the 승급전', () => {
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 10_000_000_000;
  at(OCT, () => {
    rpOf(u, OCT); u.rp.points = 85; u.rp.promo = { active: true, target: 'bronze', wins: 0, losses: 0, minStake: 10_000_000 };
    lockBet(state, u, { stake: 10_000_000, game: "Hold'em", roundId: 'room-1' });
    settleLockedHouseGame(state, u, { game: "Hold'em", stake: 10_000_000, netPnl: 50_000_000, roundId: 'room-1', details: { room: 'ABCD' } });
  });
  assert.equal(u.rp.promo.wins, 0, 'a friend dumping chips does not win my series');
  assert.equal(u.rp.last.delta, 30, '5× the buy-in counts as 3×');
  const v = newUser(state, 'v', 'V');
  v.account.available = 10_000_000_000;
  at(OCT, () => {
    rpOf(v, OCT); v.rp.points = 60; v.rp.promo = { active: true, target: 'bronze', wins: 0, losses: 0, minStake: 10_000_000 };
    lockBet(state, v, { stake: 10_000_000, game: "Hold'em", roundId: 'nightly-1' });
    settleLockedHouseGame(state, v, { game: "Hold'em", stake: 10_000_000, netPnl: 10_000_000, roundId: 'nightly-1', details: { room: 'NITE', nightly: 'n1' } });
  });
  assert.equal(v.rp.promo.wins, 1, 'the house nightly tournament still counts');
});
