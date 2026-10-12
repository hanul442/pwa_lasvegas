import test from 'node:test';
import assert from 'node:assert/strict';
import { holding, TIERS } from '../public/js/chips.js';

const worth = (counts, chips) => counts.reduce((n, c, k) => n + c * chips[k], 0);

test('my stacks add up to the balance, down to the smallest chip', () => {
  const { chips } = TIERS.corner;
  for (const amount of [0, 5, 10, 25, 99, 180, 1990, 2000, 123_456]) {
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
