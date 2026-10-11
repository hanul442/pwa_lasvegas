import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { buildSocialCompetitionSnapshot, createRival, archiveRival, createChallenge, acceptChallenge, cancelChallenge } from '../lib/social-competition.mjs';

test('social competition fails closed to empty read-only surfaces when source state is absent', () => {
  const state = defaultState();
  const before = structuredClone(state.users.hanseo.account);
  const snapshot = buildSocialCompetitionSnapshot(state, 'hanseo');

  assert.deepEqual(snapshot.rivals, []);
  assert.deepEqual(snapshot.challenges, []);
  assert.deepEqual(snapshot.spectating.tables, []);
  assert.equal(snapshot.spectating.mode, 'READ_ONLY');
  assert.ok(Array.isArray(snapshot.socialMoments.moments));
  assert.equal(snapshot.socialMoments.mode, 'READ_ONLY');
  assert.equal(snapshot.socialMoments.policy.cashEquivalent, false);
  assert.equal(snapshot.socialMoments.policy.redeemable, false);
  assert.equal(snapshot.capabilities.rivals, true);
  assert.equal(snapshot.capabilities.challenges, true);
  assert.equal(snapshot.capabilities.spectating, true);
  assert.equal(snapshot.capabilities.socialMoments, true);
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

test('rival lifecycle mutates only social state and rejects duplicate active pairs', () => {
  const state = defaultState();
  const economyBefore = structuredClone({ users: state.users, ledger: state.ledger, rounds: state.rounds, rechargeRequests: state.rechargeRequests });

  const rival = createRival(state, 'hanseo', 'zero', { now: '2026-09-14T01:00:00.000Z', rivalId: 'rival_test' });
  assert.equal(rival.status, 'ACTIVE');
  assert.equal(rival.opponent.id, 'zero');
  assert.throws(() => createRival(state, 'zero', 'hanseo'), { message: 'RIVAL_ALREADY_ACTIVE' });

  const archived = archiveRival(state, 'zero', 'rival_test', { now: '2026-09-14T02:00:00.000Z' });
  assert.equal(archived.status, 'ARCHIVED');
  assert.throws(() => archiveRival(state, 'hanseo', 'rival_test'), { message: 'RIVAL_NOT_ACTIVE' });

  assert.deepEqual({ users: state.users, ledger: state.ledger, rounds: state.rounds, rechargeRequests: state.rechargeRequests }, economyBefore);
});

test('challenge lifecycle is invitation-only, participant-scoped and has no chip transfer or reward', () => {
  const state = defaultState();
  const economyBefore = structuredClone({ users: state.users, ledger: state.ledger, feed: state.feed });

  const challenge = createChallenge(state, 'hanseo', 'zero', 'QUALIFIED_PROFIT', { now: '2026-09-14T03:00:00.000Z', challengeId: 'challenge_test' });
  assert.equal(challenge.status, 'PENDING');
  assert.equal(challenge.role, 'CHALLENGER');
  assert.throws(() => createChallenge(state, 'zero', 'hanseo', 'QUALIFIED_PROFIT'), { message: 'CHALLENGE_ALREADY_OPEN' });
  assert.throws(() => acceptChallenge(state, 'hanseo', 'challenge_test'), { message: 'FORBIDDEN' });

  const accepted = acceptChallenge(state, 'zero', 'challenge_test', { now: '2026-09-14T04:00:00.000Z' });
  assert.equal(accepted.status, 'ACTIVE');
  assert.equal(accepted.role, 'OPPONENT');
  assert.equal(accepted.startsAt, '2026-09-14T04:00:00.000Z');

  const cancelled = cancelChallenge(state, 'hanseo', 'challenge_test', { now: '2026-09-14T05:00:00.000Z' });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.throws(() => cancelChallenge(state, 'zero', 'challenge_test'), { message: 'CHALLENGE_NOT_OPEN' });

  assert.deepEqual({ users: state.users, ledger: state.ledger, feed: state.feed }, economyBefore);
});

test('social lifecycle fails closed on invalid targets and metrics', () => {
  const state = defaultState();
  assert.throws(() => createRival(state, 'hanseo', 'hanseo'), { message: 'INVALID_SOCIAL_TARGET' });
  assert.throws(() => createRival(state, 'hanseo', 'ghost'), { message: 'USER_NOT_FOUND' });
  assert.throws(() => createChallenge(state, 'hanseo', 'hanseo', 'WINS'), { message: 'INVALID_SOCIAL_TARGET' });
  assert.throws(() => createChallenge(state, 'hanseo', 'zero', 'TOTAL_WAGERED'), { message: 'INVALID_CHALLENGE_METRIC' });
});

test('a duel runs a week, scores table results only, and pays its winner once', async () => {
  const { settleChallenges, CHALLENGE_PRIZE } = await import('../lib/social-competition.mjs');
  const state = defaultState();
  createChallenge(state, 'hanseo', 'zero', 'WINS', { now: '2026-10-12T00:00:00.000Z', challengeId: 'duel' });
  const accepted = acceptChallenge(state, 'zero', 'duel', { now: '2026-10-12T01:00:00.000Z' });
  assert.equal(accepted.endsAt, '2026-10-19T01:00:00.000Z');
  const tx = (userId, pnl, at) => state.ledger.push({ id: `t${state.ledger.length}`, userId, type: pnl > 0 ? 'GAME_WIN' : 'GAME_LOSS', amount: pnl, qualifiedPnlDelta: pnl, rawPnlDelta: pnl, createdAt: at, metadata: { game: 'Baccarat', stake: 1 } });
  tx('hanseo', 100, '2026-10-12T02:00:00.000Z');
  tx('hanseo', 100, '2026-10-13T02:00:00.000Z');
  tx('zero', 900, '2026-10-12T03:00:00.000Z');
  tx('zero', 900, '2026-10-11T03:00:00.000Z'); // before the duel: does not count
  const live = buildSocialCompetitionSnapshot(state, 'hanseo').challenges[0];
  assert.deepEqual(live.score, { me: 2, them: 1 });
  const before = state.users.hanseo.account.available;
  assert.deepEqual(settleChallenges(state, Date.parse('2026-10-18T00:00:00.000Z')), []);
  assert.deepEqual(settleChallenges(state, Date.parse('2026-10-19T02:00:00.000Z')), ['duel']);
  assert.equal(state.users.hanseo.account.available, before + CHALLENGE_PRIZE);
  assert.equal(buildSocialCompetitionSnapshot(state, 'zero').challenges[0].winner, 'THEM');
  assert.deepEqual(settleChallenges(state, Date.parse('2026-10-20T00:00:00.000Z')), []);
  assert.equal(state.users.hanseo.account.available, before + CHALLENGE_PRIZE);
});

test('unanswered invitations lapse after three days', async () => {
  const { settleChallenges } = await import('../lib/social-competition.mjs');
  const state = defaultState();
  createChallenge(state, 'hanseo', 'zero', 'QUALIFIED_PROFIT', { now: '2026-10-12T00:00:00.000Z', challengeId: 'old' });
  settleChallenges(state, Date.parse('2026-10-15T00:00:01.000Z'));
  assert.equal(buildSocialCompetitionSnapshot(state, 'hanseo').challenges[0].status, 'EXPIRED');
});
