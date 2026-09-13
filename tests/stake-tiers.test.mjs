import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOORS, STAKE_TIERS, stakeTierFor } from '../lib/constants.mjs';

test('stake tiers are contiguous for approved chip bands', () => {
  assert.equal(STAKE_TIERS.length, 4);
  assert.equal(stakeTierFor(100_000)?.slug, 'low');
  assert.equal(stakeTierFor(999_999)?.slug, 'low');
  assert.equal(stakeTierFor(1_000_000)?.slug, 'mid');
  assert.equal(stakeTierFor(9_999_999)?.slug, 'mid');
  assert.equal(stakeTierFor(10_000_000)?.slug, 'high');
  assert.equal(stakeTierFor(49_999_999)?.slug, 'high');
  assert.equal(stakeTierFor(50_000_000)?.slug, 'vip');
  assert.equal(stakeTierFor(10_000_000_000)?.slug, 'vip');
});

test('every floor exposes at least one valid stake tier', () => {
  const slugs = new Set(STAKE_TIERS.map(tier => tier.slug));
  for (const floor of FLOORS) {
    assert.ok(Array.isArray(floor.stakeTiers));
    assert.ok(floor.stakeTiers.length > 0);
    for (const tier of floor.stakeTiers) assert.ok(slugs.has(tier));
  }
});

test('invalid stakes never resolve to a tier', () => {
  assert.equal(stakeTierFor(0), null);
  assert.equal(stakeTierFor(-1), null);
  assert.equal(stakeTierFor(1.5), null);
  assert.equal(stakeTierFor(Number.MAX_SAFE_INTEGER + 1), null);
});
