const REQUIRED_KEYS = ['id','name','startsAt','endsAt','performanceByUser'];

function isIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function finiteNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function validPerformance(value) {
  return value && typeof value === 'object'
    && finiteNonNegative(value.profit)
    && finiteNonNegative(value.wagered)
    && finiteNonNegative(value.wins);
}

function validSeasonBoundary(candidate) {
  return candidate && typeof candidate === 'object'
    && typeof candidate.id === 'string' && candidate.id.trim()
    && typeof candidate.name === 'string' && candidate.name.trim()
    && isIso(candidate.startsAt) && isIso(candidate.endsAt)
    && Date.parse(candidate.endsAt) > Date.parse(candidate.startsAt);
}

export function normalizeHybridSeason(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (REQUIRED_KEYS.some(key => !(key in candidate))) return null;
  if (!validSeasonBoundary(candidate)) return null;
  if (!candidate.performanceByUser || typeof candidate.performanceByUser !== 'object' || Array.isArray(candidate.performanceByUser)) return null;

  const performanceByUser = {};
  for (const [userId, value] of Object.entries(candidate.performanceByUser)) {
    if (typeof userId !== 'string' || !userId || !validPerformance(value)) return null;
    performanceByUser[userId] = {
      profit: Number(value.profit),
      wagered: Number(value.wagered),
      wins: Number(value.wins)
    };
  }

  return {
    id: candidate.id,
    name: candidate.name,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    bankrollCarriesOver: true,
    performanceResets: true,
    performanceByUser
  };
}

function seasonLedgerEvents(state, season) {
  if (!validSeasonBoundary(season) || !Array.isArray(state?.ledger)) return null;
  const start = Date.parse(season.startsAt);
  const end = Date.parse(season.endsAt);
  const events = [];
  for (const tx of state.ledger) {
    if (!tx || typeof tx !== 'object') return null;
    if (!['GAME_WIN', 'GAME_LOSS', 'GAME_PUSH'].includes(tx.type)) continue;
    const occurred = Date.parse(tx.createdAt);
    if (Number.isFinite(occurred) && occurred >= start && occurred < end) events.push(tx);
  }
  return events;
}

export function buildSeasonPerformanceFromLedger(state, season) {
  const events = seasonLedgerEvents(state, season);
  if (!events) return null;
  const performanceByUser = {};
  for (const tx of events) {
    if (typeof tx.userId !== 'string' || !tx.userId || !state.users?.[tx.userId]) return null;
    const wagered = Number(tx.metadata?.stake);
    const pnl = Number(tx.qualifiedPnlDelta ?? tx.rawPnlDelta);
    if (!Number.isFinite(wagered) || wagered < 0 || !Number.isFinite(pnl)) return null;
    const row = performanceByUser[tx.userId] ?? { profit: 0, wagered: 0, wins: 0 };
    row.profit += pnl;
    row.wagered += wagered;
    if (tx.type === 'GAME_WIN' && pnl > 0) row.wins += 1;
    performanceByUser[tx.userId] = row;
  }
  return performanceByUser;
}

export function activeHybridSeason(state) {
  const candidate = state?.meta?.activeSeason;
  if (!validSeasonBoundary(candidate)) return null;
  const derived = buildSeasonPerformanceFromLedger(state, candidate);
  if (derived) {
    return {
      id: candidate.id,
      name: candidate.name,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      bankrollCarriesOver: true,
      performanceResets: true,
      performanceByUser: derived
    };
  }
  return normalizeHybridSeason(candidate);
}
