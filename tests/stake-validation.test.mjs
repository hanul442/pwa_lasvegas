import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStakeAgainstFloor } from '../lib/stakes.mjs';

function user({ available = 1_000_000_000, unlockedFloors = ['test-floor'] } = {}) {
  return { account: { available, locked: 0, unlockedFloors } };
}

const floor = {
  slug: 'test-floor',
  minBet: 10_000_000,
  maxBet: 1_000_000_000,
  stakeTiers: ['high-limit']
};

test('accepts a stake whose canonical tier is allowed by the floor', () => {
  const out = validateStakeAgainstFloor(user(), floor, 50_000_000);
  assert.equal(out.tier.slug, 'high-limit');
  assert.equal(out.floor, floor);
});

test('rejects an in-range stake when its canonical tier is not allowed by the floor', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user(), floor, 100_000_000),
    { message: 'STAKE_TIER_NOT_ALLOWED' }
  );
});

test('keeps table limits authoritative before tier policy', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user(), floor, 1_000_000_001),
    { message: 'BET_OUTSIDE_TABLE_LIMIT' }
  );
});

test('rejects locked floors and insufficient virtual bankroll', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user({ unlockedFloors: [] }), floor, 50_000_000),
    { message: 'FLOOR_LOCKED' }
  );
  assert.throws(
    () => validateStakeAgainstFloor(user({ available: 49_999_999 }), floor, 50_000_000),
    { message: 'INSUFFICIENT_BANKROLL' }
  );
});

test('turns away a player worth more than a hundred of the floor\'s smallest bets', () => {
  const capped = { ...floor, ceiling: 10_000_000_000 };
  assert.equal(validateStakeAgainstFloor(user({ available: 10_000_000_000 }), capped, 50_000_000).floor, capped, 'exactly at the ceiling still sits');
  assert.throws(() => validateStakeAgainstFloor(user({ available: 10_000_000_001 }), capped, 50_000_000), { message: 'FLOOR_OUTGROWN' });
  const owing = { account: { available: 10_000_000_001, locked: 0, unlockedFloors: ['test-floor'] }, loans: [{ balance: 1 }] };
  assert.equal(validateStakeAgainstFloor(owing, capped, 50_000_000).floor, capped, 'debt counts against net worth');
});

test('fails closed when floor tier metadata is missing', () => {
  assert.throws(
    () => validateStakeAgainstFloor(user(), { ...floor, stakeTiers: null }, 50_000_000),
    { message: 'STAKE_TIER_NOT_ALLOWED' }
  );
});
