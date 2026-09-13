import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { buildSocialCompetitionSnapshot } from '../lib/social-competition.mjs';

test('social competition fails closed to empty read-only surfaces when source state is absent', () => {
  const state = defaultState();
  const before = structuredClone(state.users.hanseo.account);
  const snapshot = buildSocialCompetitionSnapshot(state, 'hanseo');

  assert.deepEqual(snapshot.rivals, []);
  assert.deepEqual(snapshot.challenges, []);
  assert.equal(snapshot.capabilities.rivals, true);
  assert.equal(snapshot.capabilities.challenges, true);
  assert.equal(snapshot.capabilities.spectating, false);
  assert.equal(snapshot.capabilities.socialMoments, false);
  assert.deepEqual(state.users.hanseo.account, before);
});

test('viewer sees only canonical rival and challenge records that involve them', () => {
  const state = defaultState();
  state.socialCompetition = {
    version: 1,
    rivals: [
      { id: 'r1', userIds: ['hanseo', 'zero'], status: 'ACTIVE', createdAt: '2026-09-14T00:00:00.000Z' },
      { id: 'r2', userIds: ['min', 'june'], status: 'ACTIVE' },
      { id: 'bad-rival', userIds: ['hanseo', 'ghost'], status: 'ACTIVE' }
    ],
    challenges: [
      { id: 'c1', challengerId: 'hanseo', opponentId: 'zero', status: 'PENDING', metric: 'QUALIFIED_PROFIT', createdAt: '2026-09-14T00:00:00.000Z' },
      { id: 'c2', challengerId: 'min', opponentId: 'june', status: 'ACTIVE', metric: 'WINS' },
      { id: 'bad-status', challengerId: 'hanseo', opponentId: 'zero', status: 'MYSTERY' }
    ]
  };

  const snapshot = buildSocialCompetitionSnapshot(state, 'hanseo');
  assert.equal(snapshot.rivals.length, 1);
  assert.equal(snapshot.rivals[0].opponent.id, 'zero');
  assert.equal(snapshot.challenges.length, 1);
  assert.equal(snapshot.challenges[0].role, 'CHALLENGER');
  assert.equal(snapshot.challenges[0].counterpart.id, 'zero');
  assert.equal(snapshot.challenges[0].metric, 'QUALIFIED_PROFIT');
});

test('social competition projection rejects unknown viewers and never invents counterpart users', () => {
  const state = defaultState();
  assert.throws(() => buildSocialCompetitionSnapshot(state, 'ghost'), { message: 'USER_NOT_FOUND' });

  state.socialCompetition = {
    version: 1,
    rivals: [{ id: 'r1', userIds: ['hanseo', 'ghost'], status: 'ACTIVE' }],
    challenges: [{ id: 'c1', challengerId: 'hanseo', opponentId: 'ghost', status: 'PENDING' }]
  };
  const snapshot = buildSocialCompetitionSnapshot(state, 'hanseo');
  assert.deepEqual(snapshot.rivals, []);
  assert.deepEqual(snapshot.challenges, []);
});
