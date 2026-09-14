import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { buildSocialMomentsSnapshot } from '../lib/social-moments.mjs';

function cleanState() {
  const state = defaultState();
  state.ledger = [];
  for (const user of Object.values(state.users)) user.bankruptcies = [];
  return state;
}

test('social moments projects canonical major wins and bankruptcies without mutating source state', () => {
  const state = cleanState();
  state.ledger.push({
    id: 'tx_major', userId: 'zero', type: 'GAME_WIN', rawPnlDelta: 450_000_000,
    createdAt: '2026-09-14T01:00:00.000Z', metadata: { game: 'Blackjack', stake: 500_000_000 }
  });
  state.users.june.bankruptcies.push({
    id: 'bust_june', userId: 'june', game: 'Baccarat', sessionLoss: 120_000_000,
    peakBankroll: 310_000_000, roundId: 'round_bust', createdAt: '2026-09-14T02:00:00.000Z',
    comparisons: [{ label: 'example', price: 1, count: 120_000_000 }]
  });
  const before = structuredClone(state);

  const snapshot = buildSocialMomentsSnapshot(state, 'hanseo');

  assert.equal(snapshot.mode, 'READ_ONLY');
  assert.equal(snapshot.moments.length, 2);
  assert.equal(snapshot.moments[0].type, 'BANKRUPTCY');
  assert.equal(snapshot.moments[0].actor.id, 'june');
  assert.equal(snapshot.moments[0].chipsLost, 120_000_000);
  assert.equal(snapshot.moments[0].comparisonCardAvailable, false);
  assert.equal('comparisons' in snapshot.moments[0], false);
  assert.equal(snapshot.moments[1].type, 'MAJOR_WIN');
  assert.equal(snapshot.moments[1].actor.id, 'zero');
  assert.equal(snapshot.moments[1].chips, 450_000_000);
  assert.equal('stake' in snapshot.moments[1], false);
  assert.equal(snapshot.policy.cashEquivalent, false);
  assert.equal(snapshot.policy.redeemable, false);
  assert.deepEqual(state, before);
});

test('social moments fail closed for sub-threshold or malformed records', () => {
  const state = cleanState();
  state.ledger.push(
    { id: 'small', userId: 'zero', type: 'GAME_WIN', rawPnlDelta: 299_999_999, createdAt: '2026-09-14T01:00:00.000Z', metadata: { game: 'Blackjack' } },
    { id: 'wrong-type', userId: 'zero', type: 'ADMIN_GRANT', rawPnlDelta: 900_000_000, createdAt: '2026-09-14T01:00:00.000Z', metadata: { game: 'Blackjack' } },
    { id: 'ghost', userId: 'ghost', type: 'GAME_WIN', rawPnlDelta: 900_000_000, createdAt: '2026-09-14T01:00:00.000Z', metadata: { game: 'Blackjack' } },
    { id: 'bad-time', userId: 'zero', type: 'GAME_WIN', rawPnlDelta: 900_000_000, createdAt: 'not-a-date', metadata: { game: 'Blackjack' } }
  );
  state.users.zero.bankruptcies.push({ id: 'bad-bust', userId: 'zero', game: 'Blackjack', sessionLoss: -1, createdAt: '2026-09-14T02:00:00.000Z' });

  const snapshot = buildSocialMomentsSnapshot(state, 'hanseo');
  assert.deepEqual(snapshot.moments, []);
});

test('social moments are bounded, deterministic and reject unknown viewers', () => {
  const state = cleanState();
  for (let i = 0; i < 60; i += 1) {
    state.ledger.push({
      id: `tx_${String(i).padStart(2, '0')}`, userId: 'zero', type: 'GAME_WIN', rawPnlDelta: 300_000_000 + i,
      createdAt: `2026-09-14T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, metadata: { game: 'Baccarat' }
    });
  }

  const snapshot = buildSocialMomentsSnapshot(state, 'hanseo', { limit: 1000 });
  assert.equal(snapshot.moments.length, 50);
  assert.equal(snapshot.moments[0].source.id, 'tx_59');
  assert.equal(snapshot.moments.at(-1).source.id, 'tx_10');
  assert.throws(() => buildSocialMomentsSnapshot(state, 'ghost'), { message: 'USER_NOT_FOUND' });
});
