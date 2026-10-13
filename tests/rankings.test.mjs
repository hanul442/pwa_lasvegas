import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { buildRankingSnapshot } from '../lib/rankings.mjs';

// Two signed-up players beside HANSEO, with zero's demo numbers on 'ace' so the boards have a clear order.
function withPlayers() {
  const state = defaultState();
  const base = state.users.hanseo;
  const add = (id, account) => { state.users[id] = { ...structuredClone(base), id, nickname: id.toUpperCase(), isAdmin: false, account: { ...structuredClone(base.account), ...account } }; };
  add('ace', { ...structuredClone(state.users.zero.account) });
  add('bee', { ...structuredClone(state.users.min.account) });
  return state;
}

test('the demo AI regulars never show on a board', () => {
  const state = defaultState();
  const snapshot = buildRankingSnapshot(state);
  for (const board of [snapshot.wealth, snapshot.profit, snapshot.highRoller]) {
    assert.deepEqual(board.map(r => r.id), ['hanseo']);
  }
  assert.equal(snapshot.records.wealth.userId, 'hanseo');
  // Once people sign up, only signed-in profiles count: an unclaimed seed profile drops out too.
  state.auth = { accounts: { ace: { userId: 'ace' } }, sessions: {} };
  state.users.ace = { ...structuredClone(state.users.hanseo), id: 'ace', nickname: 'ACE' };
  assert.deepEqual(buildRankingSnapshot(state).wealth.map(r => r.id), ['ace']);
});

test('all-time rankings preserve canonical wealth/profit/high-roller semantics', () => {
  const snapshot = buildRankingSnapshot(withPlayers());
  assert.equal(snapshot.wealth[0].id, 'ace');
  assert.equal(snapshot.profit[0].id, 'ace');
  assert.equal(snapshot.highRoller[0].id, 'ace');
  assert.equal(snapshot.season, null);
});

test('VIP records include only users who unlocked the top floor', () => {
  const state = withPlayers();
  state.users.ace.account.unlockedFloors = [...state.users.ace.account.unlockedFloors, 'penthouse'];
  const snapshot = buildRankingSnapshot(state);
  assert.equal(snapshot.records.vip.wealth.userId, 'ace');
  assert.ok(snapshot.wealth.find(row => row.id === 'bee'));
  assert.equal(snapshot.records.vip.profit.userId, 'ace');
});

test('hybrid season resets performance metrics without resetting bankroll', () => {
  const state = withPlayers();
  const season = {
    id: 's1', name: 'Neon Crown I', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-09-30T23:59:59.999Z',
    performanceByUser: {
      hanseo: { profit: 40_000_000, wagered: 80_000_000, wins: 9 },
      ace: { profit: 5_000_000, wagered: 500_000_000, wins: 4 },
      bee: { profit: 20_000_000, wagered: 90_000_000, wins: 7 },
      zero: { profit: 90_000_000, wagered: 900_000_000, wins: 20 }
    }
  };
  const snapshot = buildRankingSnapshot(state, season);
  assert.equal(snapshot.season.bankrollCarriesOver, true);
  assert.equal(snapshot.season.performanceResets, true);
  assert.equal(snapshot.season.profit[0].id, 'hanseo');
  assert.equal(snapshot.season.highRoller[0].id, 'ace');
  assert.equal(snapshot.season.wins.find(r => r.id === 'zero'), undefined);
  assert.equal(snapshot.wealth[0].id, 'ace');
});

test('ranking order is deterministic on ties', () => {
  const state = withPlayers();
  state.users.hanseo.account.available = 200_000_000;
  state.users.bee.account.available = 200_000_000;
  state.users.hanseo.account.peakBankroll = 200_000_000;
  state.users.bee.account.peakBankroll = 200_000_000;
  const rows = buildRankingSnapshot(state).wealth.filter(row => ['hanseo', 'bee'].includes(row.id));
  assert.deepEqual(rows.map(row => row.nickname), ['BEE', 'HANSEO']);
});

test('each bet answers with the top 50 of every board plus the player\'s own row, once', async () => {
  const { rankingsFor } = await import('../lib/rankings.mjs');
  const state = defaultState();
  const base = state.users.hanseo;
  for (let i = 0; i < 80; i++) state.users[`p${i}`] = { ...structuredClone(base), id: `p${i}`, nickname: `p${i}`, account: { ...structuredClone(base.account), available: 1e12 + i } };
  state.users.hanseo.account.available = 0;
  const view = rankingsFor(buildRankingSnapshot(state), 'hanseo');
  assert.equal(view.wealth, undefined);
  assert.equal(view.allTime.wealth.length, 51);
  const me = view.allTime.wealth.at(-1);
  assert.equal(me.id, 'hanseo');
  assert.equal(me.rank, buildRankingSnapshot(state).wealth.find(r => r.id === 'hanseo').rank);
});
