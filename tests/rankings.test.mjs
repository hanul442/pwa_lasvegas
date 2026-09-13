import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { buildRankingSnapshot } from '../lib/rankings.mjs';

test('all-time rankings preserve canonical wealth/profit/high-roller semantics', () => {
  const state = defaultState();
  const snapshot = buildRankingSnapshot(state);
  assert.equal(snapshot.wealth[0].id, 'zero');
  assert.equal(snapshot.profit[0].id, 'zero');
  assert.equal(snapshot.highRoller[0].id, 'zero');
  assert.equal(snapshot.season, null);
});

test('VIP records include only users who unlocked the top floor', () => {
  const state = defaultState();
  const snapshot = buildRankingSnapshot(state);
  assert.equal(snapshot.records.vip.wealth.userId, 'zero');
  assert.ok(snapshot.wealth.find(row => row.id === 'min'));
  assert.equal(snapshot.records.vip.profit.userId, 'zero');
});

test('hybrid season resets performance metrics without resetting bankroll', () => {
  const state = defaultState();
  const season = {
    id: 's1', name: 'Neon Crown I', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-30T23:59:59.999Z',
    performanceByUser: {
      hanseo: { profit: 40_000_000, wagered: 80_000_000, wins: 9 },
      zero: { profit: 5_000_000, wagered: 500_000_000, wins: 4 },
      min: { profit: 20_000_000, wagered: 90_000_000, wins: 7 }
    }
  };
  const snapshot = buildRankingSnapshot(state, season);
  assert.equal(snapshot.season.bankrollCarriesOver, true);
  assert.equal(snapshot.season.performanceResets, true);
  assert.equal(snapshot.season.profit[0].id, 'hanseo');
  assert.equal(snapshot.season.highRoller[0].id, 'zero');
  assert.equal(snapshot.wealth[0].id, 'zero');
});

test('ranking order is deterministic on ties', () => {
  const state = defaultState();
  state.users.hanseo.account.available = 200_000_000;
  state.users.min.account.available = 200_000_000;
  state.users.hanseo.account.peakBankroll = 200_000_000;
  state.users.min.account.peakBankroll = 200_000_000;
  const rows = buildRankingSnapshot(state).wealth.filter(row => ['hanseo','min'].includes(row.id));
  assert.deepEqual(rows.map(row => row.nickname), ['HANSEO','MIN']);
});
