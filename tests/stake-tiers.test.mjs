import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOORS, STAKE_TIERS, stakeTierFor } from '../lib/constants.mjs';

test('stake tiers run from 1천만 to 10조 with no gaps', () => {
  assert.equal(STAKE_TIERS.length, 6);
  assert.equal(stakeTierFor(9_999_999), null);
  assert.equal(stakeTierFor(10_000_000)?.slug, 'low');
  assert.equal(stakeTierFor(99_999_999)?.slug, 'low');
  assert.equal(stakeTierFor(100_000_000)?.slug, 'mid');
  assert.equal(stakeTierFor(9_999_999_999)?.slug, 'high');
  assert.equal(stakeTierFor(10_000_000_000)?.slug, 'vip');
  assert.equal(stakeTierFor(100_000_000_000)?.slug, 'royal');
  assert.equal(stakeTierFor(1_000_000_000_000)?.slug, 'vault');
  assert.equal(stakeTierFor(10_000_000_000_000)?.slug, 'vault');
  assert.equal(stakeTierFor(10_000_000_000_001), null);
  for (let i = 1; i < STAKE_TIERS.length; i++) assert.equal(STAKE_TIERS[i].minBet, STAKE_TIERS[i - 1].maxBet + 1);
  assert.equal(FLOORS.at(-1).maxBet, 10_000_000_000_000);
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
