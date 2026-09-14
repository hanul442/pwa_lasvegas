import test from 'node:test';
import assert from 'node:assert/strict';
import { socialMomentsSurfaceModel } from '../public/social-moments-ui.js';

const safePolicy = {
  cashEquivalent: false,
  exchangeRate: false,
  redeemable: false
};

test('social moments UI model keeps only approved read-only fields', () => {
  const snapshot = {
    mode: 'READ_ONLY',
    policy: safePolicy,
    moments: [
      {
        id: 'moment_win_tx1', type: 'MAJOR_WIN', actor: { id: 'zero', nickname: 'Zero', accent: 'Z' },
        game: 'Blackjack', chips: 450_000_000, occurredAt: '2026-09-14T01:00:00.000Z',
        source: { kind: 'LEDGER', id: 'tx1' }, stake: 500_000_000
      },
      {
        id: 'moment_bankruptcy_b1', type: 'BANKRUPTCY', actor: { id: 'june', nickname: 'June', accent: 'J' },
        game: 'Baccarat', chipsLost: 120_000_000, occurredAt: '2026-09-14T02:00:00.000Z',
        comparisonCardAvailable: true,
        comparisonCard: {
          kind: 'ILLUSTRATIVE_SCALE',
          items: [{ slug: 'car', name: '자동차', emoji: '🚗', price: 40_000_000, count: 3 }]
        }
      }
    ]
  };

  const model = socialMomentsSurfaceModel(snapshot);
  assert.equal(model.enabled, true);
  assert.equal(model.moments.length, 2);
  assert.equal('stake' in model.moments[0], false);
  assert.equal('source' in model.moments[0], false);
  assert.deepEqual(model.moments[1].comparisonCard.items[0], { slug: 'car', name: '자동차', emoji: '🚗' });
  assert.equal('price' in model.moments[1].comparisonCard.items[0], false);
  assert.equal('count' in model.moments[1].comparisonCard.items[0], false);
});

test('social moments UI fails closed if non-cash policy invariants are absent or unsafe', () => {
  for (const policy of [
    null,
    { cashEquivalent: true, exchangeRate: false, redeemable: false },
    { cashEquivalent: false, exchangeRate: true, redeemable: false },
    { cashEquivalent: false, exchangeRate: false, redeemable: true }
  ]) {
    assert.deepEqual(socialMomentsSurfaceModel({ mode: 'READ_ONLY', policy, moments: [] }), { enabled: false, moments: [] });
  }
  assert.deepEqual(socialMomentsSurfaceModel({ mode: 'MUTABLE', policy: safePolicy, moments: [] }), { enabled: false, moments: [] });
});

test('social moments UI drops malformed records and bounds the visible surface', () => {
  const moments = Array.from({ length: 20 }, (_, i) => ({
    id: `moment_${i}`, type: 'MAJOR_WIN', actor: { id: 'zero', nickname: 'Zero', accent: 'Z' },
    game: 'Blackjack', chips: 300_000_000 + i, occurredAt: `2026-09-14T00:${String(i).padStart(2, '0')}:00.000Z`
  }));
  moments.push({ id: 'bad', type: 'MAJOR_WIN', actor: { nickname: 'Bad' }, game: 'Blackjack', chips: -1, occurredAt: 'not-a-date' });

  const model = socialMomentsSurfaceModel({ mode: 'READ_ONLY', policy: safePolicy, moments });
  assert.equal(model.moments.length, 12);
  assert.equal(model.moments.some(moment => moment.id === 'bad'), false);
});
