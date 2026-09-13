import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStakeAgainstFloor } from '../lib/stakes.mjs';

function user({ available = 100_000_000, unlockedFloors = ['test-floor'] } = {}) {
  return { account: { available, unlockedFloors } };
}

const floor = {
  slug: 'test-floor',
  minBet: 100_000,
  maxBet: 10_000_000,
  stakeTiers: ['low']
};

test('accepts a stake whose canonical tier is allowed by the floor', () => {
  const out = validateStakeAgainstFloor(user(), floor, 500_000);
  assert.equal(out.tier.slug, 'low');
  assert.equal(out.floor, floor);
});

test('rejects an in-range stake when its canonical tier is not allowed by the floor', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user(), floor, 1_000_000),
    { message: 'STAKE_TIER_NOT_ALLOWED' }
  );
});

test('keeps table limits authoritative before tier policy', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user(), floor, 10_000_001),
    { message: 'BET_OUTSIDE_TABLE_LIMIT' }
  );
});

test('rejects locked floors and insufficient virtual bankroll', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user({ unlockedFloors: [] }), floor, 500_000),
    { message: 'FLOOR_LOCKED' }
  );
  assert.throws(
    () => validateStakeAgainstFloor(user({ available: 499_999 }), floor, 500_000),
    { message: 'INSUFFICIENT_BANKROLL' }
  );
});

test('fails closed when floor tier metadata is missing', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user(), { ...floor, stakeTiers: null }, 500_000),
    { message: 'STAKE_TIER_NOT_ALLOWED' }
  );
});
