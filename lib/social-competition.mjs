const RIVAL_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);
const CHALLENGE_STATUSES = new Set(['PENDING', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED']);

function knownUser(state, userId) {
  return typeof userId === 'string' && Boolean(state?.users?.[userId]);
}

function publicOpponent(state, userId) {
  const user = state.users[userId];
  return user ? { id: user.id, nickname: user.nickname, accent: user.accent } : null;
}

function normalizeRival(state, viewerId, rival) {
  if (!rival || typeof rival.id !== 'string' || !Array.isArray(rival.userIds) || rival.userIds.length !== 2) return null;
  const [a, b] = rival.userIds;
  if (!knownUser(state, a) || !knownUser(state, b) || a === b || !rival.userIds.includes(viewerId)) return null;
  const status = RIVAL_STATUSES.has(rival.status) ? rival.status : 'ACTIVE';
  const opponentId = a === viewerId ? b : a;
  return {
    id: rival.id,
    status,
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
    createdAt: challenge.createdAt ?? null
  };
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

  return {
    version: Number.isSafeInteger(source?.version) ? source.version : 1,
    rivals,
    challenges,
    capabilities: {
      rivals: true,
      challenges: true,
      spectating: false,
      socialMoments: false
    }
  };
}
