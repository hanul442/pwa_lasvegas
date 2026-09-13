import test from 'node:test';
import assert from 'node:assert/strict';
import { stakeTierForUi } from '../public/stake-tiers.js';

test('stake tier UI resolves canonical approved boundaries', () => {
  assert.equal(stakeTierForUi(100_000)?.slug, 'low');
  assert.equal(stakeTierForUi(999_999)?.slug, 'low');
  assert.equal(stakeTierForUi(1_000_000)?.slug, 'mid');
  assert.equal(stakeTierForUi(9_999_999)?.slug, 'mid');
  assert.equal(stakeTierForUi(10_000_000)?.slug, 'high');
  assert.equal(stakeTierForUi(49_999_999)?.slug, 'high');
  assert.equal(stakeTierForUi(50_000_000)?.slug, 'vip');
  assert.equal(stakeTierForUi(0), null);
});
