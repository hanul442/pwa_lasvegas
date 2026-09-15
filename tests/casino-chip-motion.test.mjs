import test from 'node:test';
import assert from 'node:assert/strict';
import { chipCount, chipSettlement, chipStackMarkup, compactChipLabel } from '../public/casino-chip-motion.js';

test('chip labels remain compact without assigning real-world value', () => {
  assert.equal(compactChipLabel(1_000_000), '100만');
  assert.equal(compactChipLabel(100_000_000), '1억');
});

test('visual chip stacks are bounded for mobile performance', () => {
  assert.equal(chipCount(0, 1_000_000), 0);
  assert.equal(chipCount(1_000_000, 1_000_000), 1);
  assert.equal(chipCount(3_000_000, 1_000_000), 2);
  assert.equal(chipCount(1_000_000_000, 1_000_000), 6);
});

test('winning settlement pays only authoritative net profit as new chips', () => {
  assert.deepEqual(chipSettlement(1_500_000, 1_000_000), {
    kind: 'win',
    wagerMotion: 'hold',
    payoutMotion: 'pay',
    payoutAmount: 1_500_000,
    returnedAmount: 2_500_000
  });
});

test('loss sweeps the wager and push returns the original stake', () => {
  assert.deepEqual(chipSettlement(-1_000_000, 1_000_000), {
    kind: 'loss',
    wagerMotion: 'sweep',
    payoutMotion: 'none',
    payoutAmount: 0,
    returnedAmount: 0
  });
  assert.deepEqual(chipSettlement(0, 1_000_000), {
    kind: 'push',
    wagerMotion: 'return',
    payoutMotion: 'none',
    payoutAmount: 0,
    returnedAmount: 1_000_000
  });
});

test('stack markup exposes motion semantics and fictional CH accessibility text', () => {
  const html = chipStackMarkup({amount: 3_000_000, minUnit: 1_000_000, motion: 'pay', role: 'payout'});
  assert.match(html, /data-chip-motion="pay"/);
  assert.match(html, /payout/);
  assert.match(html, /fictional CH/);
});
