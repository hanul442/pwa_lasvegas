// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { addLedger, settleHouseGame } from '../lib/economy.mjs';
import { settleFinishedRankSeason, wrappedFor } from '../lib/rank-season.mjs';

const OCT = Date.parse('2026-10-24T03:00:00Z'), OCT2 = Date.parse('2026-10-25T03:00:00Z'), NOV = Date.parse('2026-11-01T00:30:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };
let n = 0;
const play = (state, u, game, stake, netPnl) => settleHouseGame(state, u, { game, stake, netPnl, roundId: `r${++n}` });

test('the month counts rounds, the favorite game, and the best and worst round', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  u.stats = {}; u.streak = { current: 0, best: 0 };
  at(OCT, () => {
    settleFinishedRankSeason(state);
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 20e9 });
    play(state, u, 'Blackjack', 1e8, 1e8);
    play(state, u, 'Blackjack', 1e8, 1e8);
    play(state, u, 'Blackjack', 2e8, -2e8);
    play(state, u, 'Roulette', 1e8, 35e8);
  });
  at(OCT2, () => play(state, u, 'Baccarat', 5e8, -5e8));
  const { live } = at(OCT2, () => wrappedFor(state, u));
  assert.equal(live.rounds, 5);
  assert.equal(live.wins, 3);
  assert.equal(live.days, 2);
  assert.equal(live.games[0].game, 'Blackjack');
  assert.equal(live.games[0].rounds, 3);
  assert.equal(live.best.game, 'Roulette');
  assert.equal(live.best.multiple, 35);
  assert.equal(live.worst.game, 'Baccarat');
  assert.equal(live.worst.pnl, -5e8);
  assert.equal(live.bestRun, 2);
  assert.equal(live.biggestBet.stake, 5e8);
  assert.equal(live.tier, 'gold');
  assert.equal(live.rank, 1);
  assert.ok(live.live);
  assert.equal(u.stats.Blackjack.rounds, 3, 'lifetime stats still count every round once');
});

test('October starts from the records a player already had, without counting them twice', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  u.stats = { Slots: { rounds: 40, wins: 10, losses: 30, pushes: 0, wagered: 4e9, pnl: -1e9, biggestWin: 3e9, biggestLoss: 2e8, biggestBet: 1e8 } };
  const before = at(OCT, () => wrappedFor(state, u)).live;
  assert.equal(before.rounds, 40, 'a player who has not played since still sees their October');
  assert.equal(before.days, null, 'days played are unknown for the seeded part');
  at(OCT, () => { addLedger(state, u, { type: 'ADMIN_GRANT', amount: 1e9 }); play(state, u, 'Slots', 1e8, 1e8); });
  const after = at(OCT, () => wrappedFor(state, u)).live;
  assert.equal(after.rounds, 41);
  assert.equal(after.best.pnl, 3e9);
  assert.equal(u.stats.Slots.rounds, 41);
});

test('the close freezes the month with its result, and it survives the reset', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  u.stats = {};
  at(OCT, () => {
    settleFinishedRankSeason(state);
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 20e9 });
    play(state, u, 'Blackjack', 1e8, 1e8);
  });
  at(NOV, () => settleFinishedRankSeason(state));
  const view = at(NOV, () => wrappedFor(state, u));
  assert.equal(view.live, null, 'November has no rounds yet');
  const oct = view.history[0];
  assert.equal(oct.season, 'rank-2026-10');
  assert.equal(oct.rounds, 1);
  assert.equal(oct.tier, 'gold');
  assert.equal(oct.rank, 1);
  assert.match(oct.name, /10월/);
  at(NOV, () => { addLedger(state, u, { type: 'ADMIN_GRANT', amount: 1e9 }); play(state, u, 'Roulette', 1e8, -1e8); });
  const nov = at(NOV, () => wrappedFor(state, u));
  assert.equal(nov.live.rounds, 1);
  assert.equal(nov.live.games[0].game, 'Roulette');
  assert.equal(nov.history[0].rounds, 1, 'October unchanged');
});

test('a November round before the close keeps October apart', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  u.stats = {};
  at(OCT, () => { settleFinishedRankSeason(state); addLedger(state, u, { type: 'ADMIN_GRANT', amount: 20e9 }); play(state, u, 'Blackjack', 1e8, 1e8); play(state, u, 'Blackjack', 1e8, 1e8); });
  at(NOV, () => play(state, u, 'Roulette', 1e8, 1e8));
  at(NOV, () => settleFinishedRankSeason(state));
  const view = at(NOV, () => wrappedFor(state, u));
  assert.equal(view.history[0].rounds, 2);
  assert.equal(view.live.rounds, 1);
});
