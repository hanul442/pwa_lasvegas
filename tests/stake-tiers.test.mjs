import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOORS, STAKE_TIERS, stakeTierFor } from '../lib/constants.mjs';

test('six tiers run from 100만 to 1조, ten times each, with no gaps', () => {
  assert.equal(STAKE_TIERS.length, 6);
  assert.equal(stakeTierFor(999_999), null, 'nothing under 100만');
  assert.equal(stakeTierFor(1_000_000)?.slug, 'gold-room');
  assert.equal(stakeTierFor(9_999_999)?.slug, 'gold-room');
  assert.equal(stakeTierFor(10_000_000)?.slug, 'high-limit');
  assert.equal(stakeTierFor(100_000_000_000)?.slug, 'vault');
  assert.equal(stakeTierFor(1_000_000_000_000)?.slug, 'vault');
  assert.equal(stakeTierFor(1_000_000_000_001), null);
  for (let i = 1; i < STAKE_TIERS.length; i++) assert.equal(STAKE_TIERS[i].minBet, STAKE_TIERS[i - 1].maxBet + 1);
  assert.equal(FLOORS.at(-1).maxBet, 1_000_000_000_000);
});

test('a floor opens at ten of its smallest bets and closes past a hundred', () => {
  assert.equal(FLOORS[0].threshold, 0);
  for (const f of FLOORS.slice(1)) assert.equal(f.threshold, f.minBet * 10);
  for (const f of FLOORS.slice(0, -1)) assert.equal(f.ceiling, f.minBet * 100);
  assert.equal(FLOORS.at(-1).ceiling, null, 'The Vault never closes');
  // At any net worth at least one opened floor is still open.
  for (let worth = 0; worth < 1e13; worth = worth * 3 + 7) {
    const open = FLOORS.filter(f => worth >= f.threshold && (f.ceiling == null || worth <= f.ceiling));
    assert.ok(open.length >= 1, String(worth));
  }
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
