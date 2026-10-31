import crypto from 'node:crypto';
import { buildSpectatingSnapshot } from './spectating.mjs';
import { buildSocialMomentsSnapshot } from './social-moments.mjs';
import { addLedger } from './economy.mjs';
import { pushFeed } from './engagement.mjs';
import { rewardBase } from './state.mjs';

const RIVAL_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);
const CHALLENGE_STATUSES = new Set(['PENDING', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED']);
const CHALLENGE_METRICS = new Set(['QUALIFIED_PROFIT', 'WINS']);
// A duel runs a week from acceptance; an unanswered invitation lapses after three days.
export const CHALLENGE_DAYS = 7;
export const INVITE_DAYS = 3;
// The winner's prize: 100 of rewardBase, the Gold Room's smallest bet in the RP season (10억), the
// same for everyone like pay and missions. It was counted in the winner's own floor, so a duel
// paid 1조 at the 크라운 and 3조 at the 올림포스 (2026-10-31 금액 전수 점검).
export const CHALLENGE_PRIZE = 100;
export const challengePrizeFor = user => CHALLENGE_PRIZE * rewardBase(user);
const DAY_MS = 86_400_000;

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
  const scored = ['ACTIVE', 'COMPLETED'].includes(challenge.status) && challenge.startsAt;
  return {
    ...(scored ? { score: { me: frozenScore(state, challenge, viewerId), them: frozenScore(state, challenge, counterpartId) } } : {}),
    ...(challenge.status === 'COMPLETED' ? { winner: challenge.winnerId === viewerId ? 'ME' : challenge.winnerId ? 'THEM' : 'TIE' } : {}),
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
  challenge.endsAt = new Date(Date.parse(timestamp) + CHALLENGE_DAYS * DAY_MS).toISOString();
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
  const socialMoments = buildSocialMomentsSnapshot(state, viewerId);

  return {
    version: Number.isSafeInteger(source?.version) ? source.version : 1,
    prize: challengePrizeFor(state.users[viewerId]),
    rivals,
    challenges,
    spectating,
    socialMoments,
    capabilities: {
      rivals: true,
      challenges: true,
      spectating: true,
      socialMoments: true
    }
  };
}

// A finished duel keeps the scores it ended on (finalScores), so its history can leave the live
// ledger (lib/history.mjs) and it need not be recounted on every request.
function frozenScore(state, challenge, userId) {
  const kept = challenge.finalScores?.[userId];
  return Number.isFinite(kept) ? kept : challengeScore(state, challenge, userId);
}
export function freezeChallengeScores(state, challenge) {
  if (challenge.finalScores) return;
  challenge.finalScores = {
    [challenge.challengerId]: challengeScore(state, challenge, challenge.challengerId),
    [challenge.opponentId]: challengeScore(state, challenge, challenge.opponentId)
  };
}

// Profit or wins a player made at the tables while the duel ran.
export function challengeScore(state, challenge, userId) {
  // A duel's running score (lib/tally.mjs), kept as its games are played.
  if (challenge.liveScores) return challenge.liveScores[userId] || 0;
  const start = Date.parse(challenge.startsAt);
  const end = challenge.endsAt ? Date.parse(challenge.endsAt) : Infinity;
  let score = 0;
  for (const tx of state.ledger || []) {
    if (tx?.userId !== userId || !['GAME_WIN', 'GAME_LOSS', 'GAME_PUSH'].includes(tx.type)) continue;
    const at = Date.parse(tx.createdAt);
    if (!(at >= start && at < end)) continue;
    const pnl = Number(tx.qualifiedPnlDelta ?? tx.rawPnlDelta ?? 0);
    score += challenge.metric === 'WINS' ? (pnl > 0 ? 1 : 0) : pnl;
  }
  return score;
}

// Closes finished duels (the winner takes a prize from the house) and lapses old invitations.
export function settleChallenges(state, now = Date.now()) {
  const source = state.socialCompetition;
  if (!source || !Array.isArray(source.challenges)) return [];
  const done = [];
  for (const c of source.challenges) {
    if (c.status === 'PENDING' && Date.parse(c.createdAt) + INVITE_DAYS * DAY_MS <= now) {
      c.status = 'EXPIRED'; c.updatedAt = new Date(now).toISOString(); source.version += 1;
      continue;
    }
    if (c.status !== 'ACTIVE' || !c.endsAt || Date.parse(c.endsAt) > now) continue;
    if (!knownUser(state, c.challengerId) || !knownUser(state, c.opponentId)) continue;
    const a = challengeScore(state, c, c.challengerId), b = challengeScore(state, c, c.opponentId);
    c.status = 'COMPLETED';
    c.finalScores = { [c.challengerId]: a, [c.opponentId]: b };
    c.winnerId = a > b ? c.challengerId : b > a ? c.opponentId : null;
    c.updatedAt = new Date(now).toISOString();
    source.version += 1;
    if (c.winnerId) {
      const winner = state.users[c.winnerId];
      const loserId = c.winnerId === c.challengerId ? c.opponentId : c.challengerId;
      addLedger(state, winner, { type: 'CHALLENGE_PRIZE', amount: challengePrizeFor(winner), referenceType: 'CHALLENGE', referenceId: c.id, metadata: { metric: c.metric } });
      pushFeed(state, { type: 'CHALLENGE_WON', actorId: c.winnerId, opponent: state.users[loserId].nickname });
    }
    done.push(c.id);
  }
  return done;
}
