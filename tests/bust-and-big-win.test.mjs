// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
// 파산·큰 승리 연출 (2026-10-27): the day's loss tally behind the bust receipt, and the big-win bar
// measured in the table's minimum bet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { publicUser } from '../lib/state.mjs';
import { settleHouseGame } from '../lib/economy.mjs';
import { noteDay, todayView, dayOf } from '../lib/loss-tally.mjs';
import { bigWinLevel, namedWinCounts } from '../public/js/bigwin.js';
import { bustDay, bustLines, stingFor } from '../public/js/bust.js';

test('every settled round adds to the day: won, lost, peak and the losing run', () => {
  const s = defaultState(), u = s.users.hanseo; // 10억
  settleHouseGame(s, u, { game: 'Blackjack', stake: 100_000_000, netPnl: 300_000_000, roundId: 'a' });
  settleHouseGame(s, u, { game: 'Blackjack', stake: 200_000_000, netPnl: -200_000_000, roundId: 'b' });
  settleHouseGame(s, u, { game: 'Blackjack', stake: 100_000_000, netPnl: -100_000_000, roundId: 'c' });
  const d = publicUser(u).today;
  assert.equal(d.rounds, 3);
  assert.equal(d.won, 300_000_000);
  assert.equal(d.lost, 300_000_000);
  assert.equal(d.net, 0);
  assert.equal(d.start, 1_000_000_000);
  assert.equal(d.peak, 1_300_000_000);
  assert.equal(d.losingRun, 2);
  assert.equal(d.losses, 2);
  assert.equal(d.worst, 200_000_000);
  assert.equal(d.high, 300_000_000);
});

test('the tally starts over when the day turns in Seoul', () => {
  const u = {};
  const yesterday = Date.parse('2026-10-26T14:00:00Z'); // 23:00 KST
  noteDay(u, { netPnl: -5, balance: 10 }, yesterday);
  assert.equal(u.today.day, '2026-10-26');
  const today = Date.parse('2026-10-26T15:30:00Z'); // 00:30 KST
  assert.equal(todayView(u, today), null);
  noteDay(u, { netPnl: 4, balance: 14 }, today);
  assert.equal(u.today.day, dayOf(today));
  assert.equal(u.today.rounds, 1);
  assert.equal(u.today.lost, 0);
});

test('a bust carries the whole day: the peak it fell from and every way the money went', () => {
  const s = defaultState(), u = s.users.hanseo;
  settleHouseGame(s, u, { game: 'Baccarat', stake: 500_000_000, netPnl: 500_000_000, roundId: 'w' }); // 15억
  settleHouseGame(s, u, { game: 'Baccarat', stake: 1_500_000_000, netPnl: -1_500_000_000, roundId: 'x' }); // 0
  const bust = u.bankruptcies[0];
  assert.equal(bust.sessionLoss, 1_500_000_000);
  assert.equal(bust.stake, 1_500_000_000);
  assert.equal(bust.today.peak, 1_500_000_000);
  assert.equal(bust.today.busts, 1);
  assert.equal(bust.busts, 1);
  const d = bustDay(bust);
  assert.equal(d.peak, 1_500_000_000);
  const { rows, total } = bustLines(bust);
  assert.deepEqual(rows.map(r => r[0]), ['마지막 한 판', '오늘 잃은 돈 · 1판', '오늘 딴 돈']);
  assert.deepEqual(total, ['최고점에서 날린 돈', '-15억']);
  assert.match(stingFor(bust), /오늘 한때 \+5억원까지 벌고 있었어요/);
});

test('an old bust record without the day still shows its last hand', () => {
  const bust = { id: 'bust_old', sessionLoss: 300_000_000, game: 'Blackjack' };
  assert.equal(bustDay(bust).peak, 300_000_000);
  assert.deepEqual(bustLines(bust).rows, [['마지막 한 판', '-3억']]);
  assert.ok(stingFor(bust).length > 0);
});

test('the big-win bar rises with the table: 25 minimums and double the stake', () => {
  const min = 100_000_000; // a 1억 table
  assert.equal(bigWinLevel(10 * min, 10 * min, min), 0, 'even money at max bet is not big');
  assert.equal(bigWinLevel(15 * min, 10 * min, min), 0, 'a max-bet blackjack is not big by amount');
  assert.equal(bigWinLevel(35 * min, min, min), 1, 'a straight-up on the minimum is');
  assert.equal(bigWinLevel(30 * min, 30 * min, min), 0, 'a full felt that only doubles is not');
  assert.equal(bigWinLevel(100 * min, 10 * min, min), 2);
  assert.equal(bigWinLevel(350 * min, 10 * min, min), 3);
  assert.equal(bigWinLevel(5 * 100_000_000, 100_000_000, 10_000_000_000), 0, '5억 at a 100억 table no longer stops the table');
  assert.equal(namedWinCounts(1.5 * min, min), false, 'a minimum-bet blackjack stays a banner');
  assert.equal(namedWinCounts(15 * min, min), true);
});

import { thinCurve, CURVE_MAX, monthView } from '../lib/loss-tally.mjs';
import { chartPoints } from '../public/js/day-chart.js';

test('the day keeps its chip curve, per-game net and the month', () => {
  const s = defaultState(), u = s.users.hanseo;
  settleHouseGame(s, u, { game: 'Blackjack', stake: 100_000_000, netPnl: 100_000_000, roundId: 'g1' });
  settleHouseGame(s, u, { game: 'Roulette', stake: 100_000_000, netPnl: -100_000_000, roundId: 'g2' });
  settleHouseGame(s, u, { game: 'Roulette', stake: 100_000_000, netPnl: -100_000_000, roundId: 'g3' });
  const d = publicUser(u).today;
  assert.deepEqual(d.curve.map(p => p[1]), [1_000_000_000, 1_100_000_000, 1_000_000_000, 900_000_000]);
  assert.deepEqual(d.games, { Blackjack: { net: 100_000_000, rounds: 1 }, Roulette: { net: -200_000_000, rounds: 2 } });
  assert.equal(d.winningRun, 0);
  const m = publicUser(u).month;
  assert.equal(m.lost, 200_000_000);
  assert.equal(m.net, -100_000_000);
  assert.equal(m.rounds, 3);
  const c = chartPoints(d.curve);
  assert.equal(c.top, 1);
});

test('a long day thins its curve but keeps the high and the latest point', () => {
  let curve = [];
  for (let i = 0; i < CURVE_MAX + 1; i++) curve = thinCurve([...curve, [i, i === 41 ? 999 : i]]);
  assert.ok(curve.length <= CURVE_MAX);
  assert.ok(curve.some(p => p[1] === 999));
  assert.equal(curve.at(-1)[0], CURVE_MAX);
});

test('a bust carries the month and keeps only its own curve', () => {
  const s = defaultState(), u = s.users.hanseo;
  settleHouseGame(s, u, { game: 'Baccarat', stake: 1_000_000_000, netPnl: -1_000_000_000, roundId: 'b1' });
  u.account.available = 500_000_000;
  settleHouseGame(s, u, { game: 'Baccarat', stake: 500_000_000, netPnl: -500_000_000, roundId: 'b2' });
  const [latest, first] = u.bankruptcies;
  assert.equal(latest.month.busts, 2);
  assert.equal(latest.busts, 2);
  assert.ok(Array.isArray(latest.today.curve));
  assert.equal(first.today.curve, undefined);
  const rows = bustLines(latest).rows.map(r => r[0]);
  assert.ok(rows.includes('파산'));
  assert.ok(monthView(u).busts === 2);
});
