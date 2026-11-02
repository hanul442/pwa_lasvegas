// 시즌 레이스 (2026-11-02, 한서 "시즌 마감 전 랭킹 경쟁 좋아요"): the closing weeks of an RP season
// as a race. Each player sees the clock to the season's end, the player just above (and how many RP
// it takes to pass them), the one chasing from just below, and the gap to the podium. When a round
// lifts someone past other players, each of those players hears about it (lib/news.mjs: a banner in
// the app, a push when the app is closed, at most every two hours).
import { DEMO_PLAYERS } from './state.mjs';
import { rpStandings, rpPointsNow, rpTierEra, spurtAt } from './rank-points.mjs';
import { monthBoundary } from './rank-tier.mjs';

const PASS_KEEP = 60;
const PASS_QUIET = 30 * 60 * 1000; // the same two players trading places: one note per half hour
export const PODIUM = 3;

const row = r => (r ? { id: r.id, nickname: r.nickname, rp: r.value, rank: r.rank, tier: r.tier, division: r.division } : null);

// My place in the race: the clock, the neighbours on the board, the gap to the podium.
export function raceView(state, user, now = Date.now()) {
  if (!rpTierEra(now) || !user || user.guest) return null;
  const season = monthBoundary(now);
  const rows = rpStandings(state, now, DEMO_PLAYERS);
  const i = rows.findIndex(r => r.id === user.id);
  const me = i >= 0 ? rows[i] : null;
  const mine = me ? me.value : Math.floor(rpPointsNow(user, now));
  const above = me ? rows[i - 1] : rows.at(-1);
  const below = me ? rows[i + 1] : null;
  const third = rows[PODIUM - 1];
  return {
    season: season.id, name: season.name, endsAt: season.endsAt,
    rank: me?.rank ?? null, of: rows.length, rp: mine,
    // RP it takes to pass them (one more than the gap; a tie sorts by name).
    above: above ? { ...row(above), need: Math.max(1, above.value - mine + 1) } : null,
    below: below ? { ...row(below), gap: mine - below.value } : null,
    podium: me && me.rank <= PODIUM ? null : third ? { need: Math.max(1, third.value - mine + 1), rp: third.value } : null,
    spurt: spurtAt(now)
  };
}

// After a round that raised `user` from `before` RP: who they passed. Called from lib/economy.mjs.
export function notePasses(state, user, before, now = Date.now()) {
  if (!rpTierEra(now) || user.guest || DEMO_PLAYERS.includes(user.id)) return null;
  const after = Math.floor(rpPointsNow(user, now));
  if (!(after > before)) return null;
  const season = monthBoundary(now).id;
  const passes = Array.isArray(state.rankPasses) ? state.rankPasses : (state.rankPasses = []);
  const recent = (victim) => passes.some(p => p.by === user.id && p.victim === victim && now - Date.parse(p.at) < PASS_QUIET);
  const passed = Object.values(state.users || {}).filter(v => {
    if (v.id === user.id || v.guest || DEMO_PLAYERS.includes(v.id)) return false;
    const played = v.rp?.season === season ? v.rp.rounds > 0 || v.rp.points > 0 : rpPointsNow(v, now) > 0;
    const p = Math.floor(rpPointsNow(v, now));
    return played && p >= before && p < after && !recent(v.id);
  });
  if (!passed.length) return null;
  const rows = rpStandings(state, now, DEMO_PLAYERS);
  const rankOf = id => rows.find(r => r.id === id)?.rank ?? null;
  const at = new Date(now).toISOString();
  for (const v of passed) {
    passes.unshift({ id: `pass_${now.toString(36)}_${v.id}`, at, season, by: user.id, byRp: after, byRank: rankOf(user.id), victim: v.id, victimRp: Math.floor(rpPointsNow(v, now)), victimRank: rankOf(v.id) });
  }
  if (passes.length > PASS_KEEP) passes.length = PASS_KEEP;
  return passed.map(v => v.id);
}

// For lib/news.mjs: the passes that happened to `userId` since `since`, this season only.
export function passNews(state, userId, since, now = Date.now()) {
  const season = monthBoundary(now).id;
  return (state.rankPasses || [])
    .filter(p => p.victim === userId && p.season === season && Date.parse(p.at) > since)
    .map(p => {
      const who = state.users[p.by]?.nickname || '누군가';
      const gap = Math.max(1, p.byRp - p.victimRp + 1);
      return {
        id: p.id, type: 'RANK_PASSED', at: p.at, mine: false, push: true,
        title: `${who}님이 나를 제쳤어요`,
        body: `${p.victimRank ? `지금 ${p.victimRank}위` : '순위가 밀렸어요'} · ${gap} RP면 다시 앞서요.`,
        go: 'ranking'
      };
    });
}
