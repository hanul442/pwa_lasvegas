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

export function normalizeHybridSeason(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (REQUIRED_KEYS.some(key => !(key in candidate))) return null;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null;
  if (!isIso(candidate.startsAt) || !isIso(candidate.endsAt)) return null;
  if (Date.parse(candidate.endsAt) <= Date.parse(candidate.startsAt)) return null;
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
  if (!season || !Array.isArray(state?.ledger)) return [];
  const start = Date.parse(season.startsAt);
  const end = Date.parse(season.endsAt);
  return state.ledger.filter(tx => {
    if (!tx || !['GAME_WIN','GAME_LOSS','GAME_PUSH'].includes(tx.type)) return false;
    const occurred = Date.parse(tx.createdAt);
    return Number.isFinite(occurred) && occurred >= start && occurred < end;
  });
}

export function buildSeasonPerformanceFromLedger(state, season) {
  const normalized = normalizeHybridSeason(season);
  if (!normalized) return null;
  const performanceByUser = {};
  for (const tx of seasonLedgerEvents(state, normalized)) {
    if (typeof tx.userId !== 'string' || !tx.userId) continue;
    const wagered = Number(tx.metadata?.stake);
    const pnl = Number(tx.rawPnlDelta);
    if (!Number.isFinite(wagered) || wagered < 0 || !Number.isFinite(pnl)) continue;
    const row = performanceByUser[tx.userId] ?? { profit: 0, wagered: 0, wins: 0 };
    row.profit += pnl;
    row.wagered += wagered;
    if (tx.type === 'GAME_WIN' && pnl > 0) row.wins += 1;
    performanceByUser[tx.userId] = row;
  }
  return performanceByUser;
}

export function activeHybridSeason(state) {
  const explicit = normalizeHybridSeason(state?.meta?.activeSeason);
  if (!explicit) return null;
  const derived = buildSeasonPerformanceFromLedger(state, explicit);
  return { ...explicit, performanceByUser: derived ?? explicit.performanceByUser };
}
