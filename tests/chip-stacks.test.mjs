// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { holding, TIERS } from '../public/js/chips.js';

const worth = (counts, chips) => counts.reduce((n, c, k) => n + c * chips[k], 0);

test('my stacks add up to the balance, down to the smallest chip', () => {
  const { chips } = TIERS['gold-room'];
  for (const amount of [0, 500_000, 1_000_000, 2_500_000, 9_900_000, 18_000_000, 199_000_000, 200_000_000, 12_345_678_901]) {
    const counts = holding(amount, chips);
    assert.equal(worth(counts, chips), amount - (amount % chips[0]), `amount ${amount}`);
    assert.ok(counts.every(n => Number.isInteger(n) && n >= 0));
  }
});

test('a big balance keeps a little change in the smaller chips', () => {
  const { chips } = TIERS['high-limit'];
  const counts = holding(chips[3] * 40, chips);
  assert.ok(counts[0] >= 3 && counts[1] >= 2 && counts[2] >= 2, String(counts));
  assert.ok(counts[3] > 30);
});
