import test from 'node:test';
import assert from 'node:assert/strict';
import { activeHybridSeason, buildSeasonPerformanceFromLedger, canonicalActiveSeasonBoundary, normalizeHybridSeason } from '../lib/seasons.mjs';

test('normalizes explicit hybrid season without changing bankroll semantics', () => {
  const season = normalizeHybridSeason({
    id: 'season-1', name: 'Founders Cup', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z',
    performanceByUser: { hanseo: { profit: 120, wagered: 400, wins: 3 } }
  });
  assert.deepEqual(season, {
    id: 'season-1', name: 'Founders Cup', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z',
    bankrollCarriesOver: true, performanceResets: true,
    performanceByUser: { hanseo: { profit: 120, wagered: 400, wins: 3 } }
  });
});

test('derives season performance from canonical ledger events only', () => {
  const season = { id:'s', name:'S', startsAt:'2026-09-01T00:00:00.000Z', endsAt:'2026-10-01T00:00:00.000Z', performanceByUser:{} };
  const state = { ledger: [
    { type:'GAME_WIN', userId:'hanseo', createdAt:'2026-09-02T00:00:00.000Z', rawPnlDelta: 120, metadata:{stake: 500} },
    { type:'GAME_LOSS', userId:'hanseo', createdAt:'2026-09-03T00:00:00.000Z', rawPnlDelta: -40, metadata:{stake: 200} },
    { type:'GAME_PUSH', userId:'hanseo', createdAt:'2026-10-01T00:00:00.000Z', rawPnlDelta: 0, metadata:{stake: 999} },
    { type:'AUTO_RECHARGE', userId:'hanseo', createdAt:'2026-09-04T00:00:00.000Z', rawPnlDelta: 10000, metadata:{} }
  ] };
  assert.deepEqual(buildSeasonPerformanceFromLedger(state, season), { hanseo:{ profit:80, wagered:700, wins:1 } });
});

test('active season prefers canonical ledger-derived metrics over stale embedded metrics', () => {
  const state = { meta:{activeSeason:{id:'s',name:'S',startsAt:'2026-09-01',endsAt:'2026-10-01',performanceByUser:{hanseo:{profit:999,wagered:999,wins:9}}}}, ledger:[{type:'GAME_WIN',userId:'hanseo',createdAt:'2026-09-02',rawPnlDelta:10,metadata:{stake:50}}], users:{hanseo:{id:'hanseo'}} };
  assert.deepEqual(activeHybridSeason(state).performanceByUser, {hanseo:{profit:10,wagered:50,wins:1}});
});

test('canonical boundary source takes precedence over legacy activeSeason', () => {
  const state = {
    meta: {
      activeSeasonBoundary: { id:'canonical', name:'Canonical', startsAt:'2026-09-10', endsAt:'2026-10-10' },
      activeSeason: { id:'legacy', name:'Legacy', startsAt:'2026-09-01', endsAt:'2026-10-01', performanceByUser:{ hanseo:{profit:999,wagered:999,wins:9} } }
    }
  };
  assert.deepEqual(canonicalActiveSeasonBoundary(state), { id:'canonical', name:'Canonical', startsAt:'2026-09-10', endsAt:'2026-10-10' });
  assert.equal(activeHybridSeason(state), null);
});

test('malformed canonical boundary fails closed instead of falling back to legacy season', () => {
  const state = {
    meta: {
      activeSeasonBoundary: { id:'bad', name:'Bad', startsAt:'2026-10-01', endsAt:'2026-09-01' },
      activeSeason: { id:'legacy', name:'Legacy', startsAt:'2026-09-01', endsAt:'2026-10-01', performanceByUser:{ hanseo:{profit:1,wagered:2,wins:1} } }
    }
  };
  assert.equal(canonicalActiveSeasonBoundary(state), null);
  assert.equal(activeHybridSeason(state), null);
});

test('does not synthesize a season when canonical source is absent', () => {
  assert.equal(activeHybridSeason({ meta: { version: 1 } }), null);
});

test('rejects malformed or unsafe season data fail-closed', () => {
  assert.equal(normalizeHybridSeason({ id: 'x', name: 'bad', startsAt: '2026-10-01', endsAt: '2026-09-01', performanceByUser: {} }), null);
  assert.equal(normalizeHybridSeason({ id: 'x', name: 'bad', startsAt: '2026-09-01', endsAt: '2026-10-01', performanceByUser: { hanseo: { profit: -1, wagered: 0, wins: 0 } } }), null);
});
