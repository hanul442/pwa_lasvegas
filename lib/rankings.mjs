import { netWorth, luxuryValue } from './state.mjs';

function baseRow(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    accent: user.accent,
    wealth: netWorth(user),
    profit: user.account.qualifiedPnl,
    wagered: user.account.totalWagered,
    peak: user.account.peakBankroll,
    bankruptcies: user.bankruptcies?.length ?? 0,
    topFloor: user.account.unlockedFloors?.includes('penthouse') ?? false,
    // Luxury on show beside the name (lib/shop.mjs): the total, and the three dearest pieces.
    assets: luxuryValue(user),
    showcase: (Array.isArray(user.luxury) ? user.luxury : []).slice().sort((a, b) => b.price - a.price).slice(0, 3).map(x => x.id)
  };
}

function ranked(rows, key) {
  return [...rows]
    .sort((a, b) => (b[key] - a[key]) || (b.peak - a.peak) || a.nickname.localeCompare(b.nickname) || a.id.localeCompare(b.id))
    .map((row, index) => ({ ...row, rank: index + 1, value: row[key] }));
}

function record(rows, key) {
  const winner = ranked(rows, key)[0];
  return winner ? { userId: winner.id, nickname: winner.nickname, value: winner[key] } : null;
}

export function buildRankingSnapshot(state, season = null) {
  const rows = Object.values(state.users).map(baseRow);
  const vipRows = rows.filter(row => row.topFloor);
  const allTime = {
    wealth: ranked(rows, 'wealth'),
    profit: ranked(rows, 'profit'),
    highRoller: ranked(rows, 'wagered')
  };

  const seasonRows = season?.performanceByUser
    ? rows.map(row => ({ ...row, seasonProfit: Number(season.performanceByUser[row.id]?.profit ?? 0), seasonWagered: Number(season.performanceByUser[row.id]?.wagered ?? 0), seasonWins: Number(season.performanceByUser[row.id]?.wins ?? 0) }))
    : [];

  return {
    ...allTime,
    allTime,
    season: season ? {
      id: season.id,
      name: season.name,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      bankrollCarriesOver: true,
      performanceResets: true,
      profit: ranked(seasonRows, 'seasonProfit'),
      highRoller: ranked(seasonRows, 'seasonWagered'),
      wins: ranked(seasonRows, 'seasonWins')
    } : null,
    records: {
      wealth: record(rows, 'wealth'),
      profit: record(rows, 'profit'),
      highRoller: record(rows, 'wagered'),
      peakBankroll: record(rows, 'peak'),
      vip: vipRows.length ? {
        wealth: record(vipRows, 'wealth'),
        profit: record(vipRows, 'profit'),
        highRoller: record(vipRows, 'wagered'),
        peakBankroll: record(vipRows, 'peak')
      } : null
    }
  };
}
