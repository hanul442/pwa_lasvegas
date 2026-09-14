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

export function activeHybridSeason(state) {
  return normalizeHybridSeason(state?.meta?.activeSeason);
}
