// RP 구멍 막기 (2026-10-30): 승급전 needs a real win, roulette and slots count a win up to 3× its
// bet for RP, and a friend's room can't decide a 승급전.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { lockBet, settleLockedHouseGame } from '../lib/economy.mjs';
import { rpForRound, rpOf, noteRp, promoRoundResult, RP_PAYOUT_CAP } from '../lib/rank-points.mjs';

const OCT = Date.parse('2026-10-29T12:00:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };

test('배당 상한: at roulette and slots a win counts for RP up to 3× its bet; other games count it all', () => {
  assert.equal(RP_PAYOUT_CAP, 3);
  assert.equal(rpForRound({ game: 'Roulette', stake: 1_000_000, netPnl: 1_000_000 }), 10);
  assert.equal(rpForRound({ game: 'Roulette', stake: 1_000_000, netPnl: 2_000_000 }), 20, 'a column bet');
  assert.equal(rpForRound({ game: 'Roulette', stake: 1_000_000, netPnl: 35_000_000 }), 30, 'straight-up: 35× counts as 3×');
  assert.equal(rpForRound({ game: 'Roulette', stake: 1_000_000, netPnl: 499_000_000 }), 30, 'lightning 499×');
  assert.equal(rpForRound({ game: 'Slots', stake: 10_000_000, netPnl: 50_000_000_000 }), 30, 'slot jackpot');
  assert.equal(rpForRound({ game: 'Roulette', stake: 1_000_000, netPnl: -1_000_000 }), -7);
  assert.equal(rpForRound({ game: 'Sic Bo', stake: 1_000_000, netPnl: 150_000_000 }), 1500, 'sic bo is not capped');
  assert.equal(rpForRound({ game: "Hold'em", stake: 1_000_000, netPnl: 5_000_000 }), 50, 'poker is not capped');
});

test('배당 상한: 100 lightning straight-ups no longer climb (they lose RP on average)', () => {
  // 1 in 37 hits; even at 499× each hit is +30 while each miss is −7.
  const ev = (1 / 37) * rpForRound({ game: 'Roulette', stake: 1, netPnl: 499 }) + (36 / 37) * rpForRound({ game: 'Roulette', stake: 1, netPnl: -1 });
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
  at(OCT, () => { rpOf(u, OCT); u.rp.points = 20; u.rp.promo = { active: true, target: 'bronze', wins: 0, losses: 0, minStake: 10_000_000 }; });
  const stake = 35 * 1_000_000;
  for (let i = 0; i < 5; i++) noteRp(u, { game: 'Roulette', stake, netPnl: 1_000_000 }, OCT);
  assert.equal(u.rp.promo.wins, 0);
  assert.equal(u.rp.promo.active, true);
  for (let i = 0; i < 3; i++) noteRp(u, { game: 'Roulette', stake, netPnl: -stake }, OCT);
  assert.equal(u.rp.promo.result, 'lost');
});

test('친구방: a round settled with a room code moves RP but never the 승급전', () => {
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 10_000_000_000;
  at(OCT, () => {
    rpOf(u, OCT); u.rp.points = 20; u.rp.promo = { active: true, target: 'bronze', wins: 0, losses: 0, minStake: 10_000_000 };
    lockBet(state, u, { stake: 10_000_000, game: "Hold'em", roundId: 'room-1' });
    settleLockedHouseGame(state, u, { game: "Hold'em", stake: 10_000_000, netPnl: 50_000_000, roundId: 'room-1', details: { room: 'ABCD' } });
  });
  assert.equal(u.rp.promo.wins, 0, 'a friend dumping chips does not win my series');
  assert.equal(u.rp.last.delta, 50, 'poker in a room is not capped');
  const v = newUser(state, 'v', 'V');
  v.account.available = 10_000_000_000;
  at(OCT, () => {
    rpOf(v, OCT); v.rp.points = 60; v.rp.promo = { active: true, target: 'bronze', wins: 0, losses: 0, minStake: 10_000_000 };
    lockBet(state, v, { stake: 10_000_000, game: "Hold'em", roundId: 'nightly-1' });
    settleLockedHouseGame(state, v, { game: "Hold'em", stake: 10_000_000, netPnl: 10_000_000, roundId: 'nightly-1', details: { room: 'NITE', nightly: 'n1' } });
  });
  assert.equal(v.rp.promo.wins, 1, 'the house nightly tournament still counts');
});

test('one-time repair: a big win in the capped window at a game no longer capped gets its RP back, once', async () => {
  const { repairRpCap } = await import('../lib/rp-cap-repair.mjs');
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 10_000_000_000;
  const T = Date.parse('2026-10-30T10:16:00Z');
  at(T, () => {
    rpOf(u, T); u.rp.points = 0;
    for (const [game, id, net] of [['Sic Bo', 's1', 100_000_000], ['Roulette', 'r1', 100_000_000]]) {
      lockBet(state, u, { stake: 1_000_000, game, roundId: id });
      settleLockedHouseGame(state, u, { game, stake: 1_000_000, netPnl: net, roundId: id });
    }
  });
  // Sic Bo now counts 1000 (uncapped). Pretend it was settled under the old cap: +30.
  u.rp.points = 60;
  const fixed = at(T, () => repairRpCap(state, T));
  assert.equal(fixed.length, 1, 'only the sic bo win, roulette stays capped');
  assert.equal(fixed[0].game, 'Sic Bo');
  assert.ok(u.rp.points > 60);
  assert.equal(repairRpCap(state, T).length, 0, 'runs once');
});

test('맞고·고스톱: RP is measured against the 10-point deposit, so a 54-point win is +54, not +10', () => {
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 10_000_000_000;
  const T = Date.parse('2026-10-31T07:40:00Z');
  at(T, () => {
    rpOf(u, T); u.rp.points = 0;
    lockBet(state, u, { stake: 10_000_000, game: 'Gostop', roundId: 'g1' });
    settleLockedHouseGame(state, u, { game: 'Gostop', stake: 10_000_000, netPnl: 54_000_000, roundId: 'g1', wagered: 54_000_000 });
  });
  assert.equal(u.rp.last.delta, 54);
  assert.equal(u.stats.Gostop.wagered, 54_000_000, 'the stats keep their own wager');
  at(T, () => {
    lockBet(state, u, { stake: 10_000_000, game: 'Matgo', roundId: 'm1' });
    settleLockedHouseGame(state, u, { game: 'Matgo', stake: 10_000_000, netPnl: -3_000_000, roundId: 'm1', wagered: 10_000_000 });
  });
  assert.equal(u.rp.last.delta, -2, 'a 3-point loss of a 10-point deposit: −3 × 0.75');
});

test('one-time 화투 repair: a big 맞고·고스톱 win this season gets the RP it was short, once', async () => {
  const { repairHwatuRp } = await import('../lib/rp-cap-repair.mjs');
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 10_000_000_000;
  const T = Date.parse('2026-10-31T07:40:00Z');
  at(T, () => {
    rpOf(u, T);
    lockBet(state, u, { stake: 10_000_000, game: 'Gostop', roundId: 'g1' });
    settleLockedHouseGame(state, u, { game: 'Gostop', stake: 10_000_000, netPnl: 54_000_000, roundId: 'g1', wagered: 54_000_000 });
  });
  u.rp.points = 10; // as the old rule left it
  const fixed = repairHwatuRp(state, T);
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].rp, 44);
  assert.equal(u.rp.points, 54);
  assert.equal(repairHwatuRp(state, T).length, 0, 'runs once');
});

test('홀덤·7포커: RP measures a cash session against 20× the floor minimum, not the buy-in', async () => {
  const { pokerRpStake, POKER_RP_BUYINS } = await import('../lib/rank-points.mjs');
  const { FLOORS } = await import('../lib/constants.mjs');
  const f = FLOORS[0];
  assert.equal(pokerRpStake(f.slug), f.minBet * POKER_RP_BUYINS);
  assert.equal(pokerRpStake('nowhere'), undefined);
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 100_000_000_000;
  const T = Date.parse('2026-10-31T07:40:00Z');
  at(T, () => {
    rpOf(u, T); u.rp.points = 0;
    const buyIn = f.minBet * 100;
    lockBet(state, u, { stake: buyIn, game: "Hold'em", roundId: 'h1' });
    settleLockedHouseGame(state, u, { game: "Hold'em", stake: buyIn, netPnl: f.minBet * 50, roundId: 'h1', rpStake: pokerRpStake(f.slug) });
  });
  assert.equal(u.rp.last.delta, 25, 'bought 100×, won 50× the minimum: +25 (was +5)');
});
