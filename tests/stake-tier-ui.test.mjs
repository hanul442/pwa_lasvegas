import test from 'node:test';
import assert from 'node:assert/strict';
import { setStakeTierBands, stakeTierForUi } from '../public/stake-tiers.js';

const canonicalPayload = [
  { slug: 'low', name: 'LOW', minBet: 100_000, maxBet: 999_999 },
  { slug: 'mid', name: 'MID', minBet: 1_000_000, maxBet: 9_999_999 },
  { slug: 'high', name: 'HIGH', minBet: 10_000_000, maxBet: 49_999_999 },
  { slug: 'vip', name: 'VIP', minBet: 50_000_000, maxBet: Number.MAX_SAFE_INTEGER }
];

test('stake tier UI resolves boundaries supplied by the server', () => {
  setStakeTierBands(canonicalPayload);
  assert.equal(stakeTierForUi(100_000)?.slug, 'low');
  assert.equal(stakeTierForUi(999_999)?.slug, 'low');
  assert.equal(stakeTierForUi(1_000_000)?.slug, 'mid');
  assert.equal(stakeTierForUi(9_999_999)?.slug, 'mid');
  assert.equal(stakeTierForUi(10_000_000)?.slug, 'high');
  assert.equal(stakeTierForUi(49_999_999)?.slug, 'high');
  assert.equal(stakeTierForUi(50_000_000)?.slug, 'vip');
  assert.equal(stakeTierForUi(0), null);
});

test('stake tier UI follows changed server metadata instead of local boundaries', () => {
  setStakeTierBands([{ slug: 'test', name: 'TEST', minBet: 7, maxBet: 9 }]);
  assert.equal(stakeTierForUi(8)?.slug, 'test');
  assert.equal(stakeTierForUi(100_000), null);
});

test('invalid metadata fails closed', () => {
  setStakeTierBands([{ slug: 'bad', name: 'BAD', minBet: 1.5, maxBet: 10 }]);
  assert.equal(stakeTierForUi(5), null);
});
