const MAJOR_WIN_THRESHOLD = 300_000_000;

function knownUser(state, userId) {
  return typeof userId === 'string' && Boolean(state?.users?.[userId]);
}

function publicActor(state, userId) {
  const user = state.users[userId];
  return user ? { id: user.id, nickname: user.nickname, accent: user.accent } : null;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function majorWinMoment(state, tx) {
  if (!tx || tx.type !== 'GAME_WIN' || !knownUser(state, tx.userId)) return null;
  if (!Number.isSafeInteger(tx.rawPnlDelta) || tx.rawPnlDelta < MAJOR_WIN_THRESHOLD) return null;
  if (typeof tx.id !== 'string' || !validTimestamp(tx.createdAt)) return null;
  const game = typeof tx.metadata?.game === 'string' ? tx.metadata.game : null;
  if (!game) return null;

  return {
    id: `moment_win_${tx.id}`,
    type: 'MAJOR_WIN',
    actor: publicActor(state, tx.userId),
    game,
    chips: tx.rawPnlDelta,
    occurredAt: tx.createdAt,
    source: { kind: 'LEDGER', id: tx.id }
  };
}

function bankruptcyMoment(state, bankruptcy) {
  if (!bankruptcy || !knownUser(state, bankruptcy.userId)) return null;
  if (typeof bankruptcy.id !== 'string' || !validTimestamp(bankruptcy.createdAt)) return null;
  if (!Number.isSafeInteger(bankruptcy.sessionLoss) || bankruptcy.sessionLoss < 0) return null;
  if (typeof bankruptcy.game !== 'string') return null;

  return {
    id: `moment_bankruptcy_${bankruptcy.id}`,
    type: 'BANKRUPTCY',
    actor: publicActor(state, bankruptcy.userId),
    game: bankruptcy.game,
    chipsLost: bankruptcy.sessionLoss,
    occurredAt: bankruptcy.createdAt,
    source: { kind: 'BANKRUPTCY_RECORD', id: bankruptcy.id },
    comparisonCardAvailable: false
  };
}

export function buildSocialMomentsSnapshot(state, viewerId, { limit = 20 } = {}) {
  if (!knownUser(state, viewerId)) throw new Error('USER_NOT_FOUND');
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;

  const wins = Array.isArray(state.ledger)
    ? state.ledger.map(tx => majorWinMoment(state, tx)).filter(Boolean)
    : [];
  const bankruptcies = Object.values(state.users ?? {}).flatMap(user =>
    Array.isArray(user?.bankruptcies)
      ? user.bankruptcies.map(record => bankruptcyMoment(state, record)).filter(Boolean)
      : []
  );

  const moments = [...wins, ...bankruptcies]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))
    .slice(0, safeLimit);

  return {
    mode: 'READ_ONLY',
    moments,
    policy: {
      majorWinThresholdChips: MAJOR_WIN_THRESHOLD,
      bankruptcyComparisonCards: false,
      cashEquivalent: false,
      redeemable: false
    }
  };
}
