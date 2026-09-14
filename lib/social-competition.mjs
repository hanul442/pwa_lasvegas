import crypto from 'node:crypto';
import { buildSpectatingSnapshot } from './spectating.mjs';

const RIVAL_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);
const CHALLENGE_STATUSES = new Set(['PENDING', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED']);
const CHALLENGE_METRICS = new Set(['QUALIFIED_PROFIT', 'WINS']);

function knownUser(state, userId) {
  return typeof userId === 'string' && Boolean(state?.users?.[userId]);
}

function nowIso(now) {
  return typeof now === 'string' ? now : new Date().toISOString();
}

function ensureSource(state) {
  if (!state.socialCompetition || typeof state.socialCompetition !== 'object') {
    state.socialCompetition = { version: 1, rivals: [], challenges: [] };
  }
  if (!Array.isArray(state.socialCompetition.rivals)) state.socialCompetition.rivals = [];
  if (!Array.isArray(state.socialCompetition.challenges)) state.socialCompetition.challenges = [];
  if (!Number.isSafeInteger(state.socialCompetition.version)) state.socialCompetition.version = 1;
  return state.socialCompetition;
}

function publicOpponent(state, userId) {
  const user = state.users[userId];
  return user ? { id: user.id, nickname: user.nickname, accent: user.accent } : null;
}

function normalizeRival(state, viewerId, rival) {
  if (!rival || typeof rival.id !== 'string' || !Array.isArray(rival.userIds) || rival.userIds.length !== 2) return null;
  const [a, b] = rival.userIds;
  if (!knownUser(state, a) || !knownUser(state, b) || a === b || !rival.userIds.includes(viewerId)) return null;
  if (!RIVAL_STATUSES.has(rival.status)) return null;
  const opponentId = a === viewerId ? b : a;
  return {
    id: rival.id,
    status: rival.status,
    opponent: publicOpponent(state, opponentId),
    createdAt: rival.createdAt ?? null,
    updatedAt: rival.updatedAt ?? rival.createdAt ?? null
  };
}

function normalizeChallenge(state, viewerId, challenge) {
  if (!challenge || typeof challenge.id !== 'string') return null;
  if (!knownUser(state, challenge.challengerId) || !knownUser(state, challenge.opponentId)) return null;
  if (challenge.challengerId === challenge.opponentId) return null;
  if (![challenge.challengerId, challenge.opponentId].includes(viewerId)) return null;
  if (!CHALLENGE_STATUSES.has(challenge.status)) return null;

  const role = challenge.challengerId === viewerId ? 'CHALLENGER' : 'OPPONENT';
  const counterpartId = role === 'CHALLENGER' ? challenge.opponentId : challenge.challengerId;
  return {
    id: challenge.id,
    status: challenge.status,
    role,
    counterpart: publicOpponent(state, counterpartId),
    metric: typeof challenge.metric === 'string' ? challenge.metric : null,
    startsAt: challenge.startsAt ?? null,
    endsAt: challenge.endsAt ?? null,
    createdAt: challenge.createdAt ?? null,
    updatedAt: challenge.updatedAt ?? challenge.createdAt ?? null
  };
}

function pairMatches(userIds, a, b) {
  return Array.isArray(userIds) && userIds.length === 2 && userIds.includes(a) && userIds.includes(b);
}

export function createRival(state, actorId, opponentId, { now, rivalId } = {}) {
  if (!knownUser(state, actorId) || !knownUser(state, opponentId)) throw new Error('USER_NOT_FOUND');
  if (actorId === opponentId) throw new Error('INVALID_SOCIAL_TARGET');
  const source = ensureSource(state);
  if (source.rivals.some(r => r.status === 'ACTIVE' && pairMatches(r.userIds, actorId, opponentId))) {
    throw new Error('RIVAL_ALREADY_ACTIVE');
  }
  const timestamp = nowIso(now);
  const rival = {
    id: rivalId || `rival_${crypto.randomUUID()}`,
    userIds: [actorId, opponentId],
    status: 'ACTIVE',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  source.rivals.push(rival);
  source.version += 1;
  return normalizeRival(state, actorId, rival);
}

export function archiveRival(state, actorId, rivalId, { now } = {}) {
  if (!knownUser(state, actorId)) throw new Error('USER_NOT_FOUND');
  const source = ensureSource(state);
  const rival = source.rivals.find(r => r.id === rivalId && Array.isArray(r.userIds) && r.userIds.includes(actorId));
  if (!rival) throw new Error('RIVAL_NOT_FOUND');
  if (rival.status !== 'ACTIVE') throw new Error('RIVAL_NOT_ACTIVE');
  rival.status = 'ARCHIVED';
  rival.updatedAt = nowIso(now);
  source.version += 1;
  return normalizeRival(state, actorId, rival);
}

export function createChallenge(state, actorId, opponentId, metric, { now, challengeId } = {}) {
  if (!knownUser(state, actorId) || !knownUser(state, opponentId)) throw new Error('USER_NOT_FOUND');
  if (actorId === opponentId) throw new Error('INVALID_SOCIAL_TARGET');
  if (!CHALLENGE_METRICS.has(metric)) throw new Error('INVALID_CHALLENGE_METRIC');
  const source = ensureSource(state);
  const duplicate = source.challenges.some(c =>
    ['PENDING', 'ACTIVE'].includes(c.status) &&
    ((c.challengerId === actorId && c.opponentId === opponentId) || (c.challengerId === opponentId && c.opponentId === actorId)) &&
    c.metric === metric
  );
  if (duplicate) throw new Error('CHALLENGE_ALREADY_OPEN');
  const timestamp = nowIso(now);
  const challenge = {
    id: challengeId || `challenge_${crypto.randomUUID()}`,
    challengerId: actorId,
    opponentId,
    status: 'PENDING',
    metric,
    startsAt: null,
    endsAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  source.challenges.push(challenge);
  source.version += 1;
  return normalizeChallenge(state, actorId, challenge);
}

export function acceptChallenge(state, actorId, challengeId, { now } = {}) {
  if (!knownUser(state, actorId)) throw new Error('USER_NOT_FOUND');
  const source = ensureSource(state);
  const challenge = source.challenges.find(c => c.id === challengeId);
  if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
  if (challenge.opponentId !== actorId) throw new Error('FORBIDDEN');
  if (challenge.status !== 'PENDING') throw new Error('CHALLENGE_NOT_PENDING');
  const timestamp = nowIso(now);
  challenge.status = 'ACTIVE';
  challenge.startsAt = timestamp;
  challenge.updatedAt = timestamp;
  source.version += 1;
  return normalizeChallenge(state, actorId, challenge);
}

export function cancelChallenge(state, actorId, challengeId, { now } = {}) {
  if (!knownUser(state, actorId)) throw new Error('USER_NOT_FOUND');
  const source = ensureSource(state);
  const challenge = source.challenges.find(c => c.id === challengeId);
  if (!challenge) throw new Error('CHALLENGE_NOT_FOUND');
  if (![challenge.challengerId, challenge.opponentId].includes(actorId)) throw new Error('FORBIDDEN');
  if (!['PENDING', 'ACTIVE'].includes(challenge.status)) throw new Error('CHALLENGE_NOT_OPEN');
  challenge.status = 'CANCELLED';
  challenge.updatedAt = nowIso(now);
  source.version += 1;
  return normalizeChallenge(state, actorId, challenge);
}

export function buildSocialCompetitionSnapshot(state, viewerId) {
  if (!knownUser(state, viewerId)) throw new Error('USER_NOT_FOUND');
  const source = state.socialCompetition;
  const rivals = Array.isArray(source?.rivals)
    ? source.rivals.map(rival => normalizeRival(state, viewerId, rival)).filter(Boolean)
    : [];
  const challenges = Array.isArray(source?.challenges)
    ? source.challenges.map(challenge => normalizeChallenge(state, viewerId, challenge)).filter(Boolean)
    : [];
  const spectating = buildSpectatingSnapshot(state, viewerId);

  return {
    version: Number.isSafeInteger(source?.version) ? source.version : 1,
    rivals,
    challenges,
    spectating,
    capabilities: {
      rivals: true,
      challenges: true,
      spectating: true,
      socialMoments: false
    }
  };
}
