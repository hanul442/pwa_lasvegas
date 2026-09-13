import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingSurfaceModel } from '../public/rankings-ui.js';

test('ranking UI prefers canonical all-time snapshot while preserving legacy fallback', () => {
  const canonical = { allTime: { wealth: [{ id: 'a' }], profit: [], highRoller: [] }, season: null, records: { vip: null } };
  const model = rankingSurfaceModel(canonical, 'allTime');
  assert.equal(model.allTime.wealth[0].id, 'a');
  assert.equal(model.seasonAvailable, false);

  const legacy = rankingSurfaceModel({ wealth: [{ id: 'legacy' }], profit: [], highRoller: [] }, 'allTime');
  assert.equal(legacy.allTime.wealth[0].id, 'legacy');
});

test('season view fails closed until canonical season data exists', () => {
  const model = rankingSurfaceModel({ allTime: { wealth: [], profit: [], highRoller: [] }, season: null, records: { vip: null } }, 'season');
  assert.equal(model.view, 'allTime');
  assert.equal(model.seasonAvailable, false);
});

test('VIP records are exposed without inventing missing record data', () => {
  const vip = { wealth: { userId: 'zero', nickname: 'ZERO', value: 1_000_000_000 }, profit: null };
  const model = rankingSurfaceModel({ allTime: { wealth: [], profit: [], highRoller: [] }, season: null, records: { vip } }, 'vip');
  assert.equal(model.view, 'vip');
  assert.equal(model.vipAvailable, true);
  assert.equal(model.vip.wealth.userId, 'zero');
  assert.equal(model.vip.profit, null);
});
