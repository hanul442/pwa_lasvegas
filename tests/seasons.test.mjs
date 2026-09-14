import test from 'node:test';
import assert from 'node:assert/strict';
import { activeHybridSeason, normalizeHybridSeason } from '../lib/seasons.mjs';

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

test('does not synthesize a season when canonical source is absent', () => {
  assert.equal(activeHybridSeason({ meta: { version: 1 } }), null);
});

test('rejects malformed or unsafe season data fail-closed', () => {
  assert.equal(normalizeHybridSeason({ id: 'x', name: 'bad', startsAt: '2026-10-01', endsAt: '2026-09-01', performanceByUser: {} }), null);
  assert.equal(normalizeHybridSeason({ id: 'x', name: 'bad', startsAt: '2026-09-01', endsAt: '2026-10-01', performanceByUser: { hanseo: { profit: -1, wagered: 0, wins: 0 } } }), null);
});
