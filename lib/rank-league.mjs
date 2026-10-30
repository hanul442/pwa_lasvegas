// 주간 리그 (2026-10-29, 한서 picked "C: RP 티어 + 주간 리그"): every week (Monday 00:00 Seoul) each
// player who plays a round is put in a group of 30 at their league level, and the week's RP
// (lib/rank-points.mjs rpWeek) is the score. When the week ends the top LEAGUE_UP move up a
// league, the bottom LEAGUE_DOWN move down, and the top three keep a badge.
// There aren't thirty people at every level yet, so AI players fill each group. Their scores are
// fixed by the group's seed and grow through the week like a person's would (in steps, some fast
// starters, some late pushers); a group's AI never knows how the people in it are doing.
// Plain data in, plain data out, like the rooms: it runs on the Node server and the Durable Object.
import crypto from 'node:crypto';
import { rpWeekOf, noteRpRecord } from './rank-points.mjs';

export const LEAGUES = [
  { id: 'rookie', name: '루키 리그' },
  { id: 'pro', name: '프로 리그' },
  { id: 'elite', name: '엘리트 리그' },
  { id: 'master', name: '마스터 리그' },
  { id: 'champion', name: '챔피언 리그' }
];
export const LEAGUE_SIZE = 30;
export const LEAGUE_UP = 5, LEAGUE_DOWN = 5, LEAGUE_BADGES = 3;
// A week's RP that the AI in each league aims for, low to high (a person can earn up to 2,100).
const AI_RANGE = [[15, 240], [30, 340], [50, 440], [70, 560], [90, 700]];
const AI_NAMES = ['도윤', '서준', '하은', '지호', '민서', '유나', '태오', '세아', '준우', '라온', '이안', '채원', '시우', '나래', '건우', '다온',
  '루카', '미르', '소율', '한결', '아린', '도하', '은호', '서아', '윤슬', '하람', '로이', '지안', '보담', '새벽', '이준', '예린', '현', '단비', '우주'];

const levelOf = user => Math.max(0, Math.min(LEAGUES.length - 1, Number(user.league?.level) || 0));
const weekScore = (user, week) => (user.rpWeek?.id === week && user.rpWeek.rounds > 0 ? user.rpWeek.net : null);
const unit = (seed, n) => crypto.createHash('sha256').update(`${seed}:${n}`).digest().readUInt32BE(0) / 2 ** 32;

function source(state) {
  if (!state.league || typeof state.league !== 'object') state.league = { groups: [], settled: [] };
  if (!Array.isArray(state.league.groups)) state.league.groups = [];
  if (!Array.isArray(state.league.settled)) state.league.settled = [];
  return state.league;
}

// The AI seats of a group, `progress` (0–1) of the way through the week.
export function groupBots(group, progress) {
  const humans = group.members.length;
  const [lo, hi] = AI_RANGE[group.level];
  const p = Math.max(0, Math.min(1, progress));
  // Names shuffled by the group's seed, so no two AI in a group share one.
  const names = AI_NAMES.map((n, k) => [unit(group.seed, `name${k}`), n]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  return Array.from({ length: Math.max(0, LEAGUE_SIZE - humans) }, (_, i) => {
    const target = lo + (hi - lo) * unit(group.seed, `t${i}`) ** 1.6;
    const shape = 0.6 + unit(group.seed, `s${i}`) * 1.4;           // <1 fast starter, >1 late push
    const steps = 20 + Math.floor(unit(group.seed, `n${i}`) * 30); // plays in sessions, not smoothly
    const done = Math.floor(p * steps) / steps;
    return { id: `ai-${group.id}-${i}`, nickname: names[i % names.length], ai: true, value: Math.floor(target * done ** shape) };
  });
}

function standings(state, group, progress) {
  const people = group.members.map(id => state.users[id]).filter(Boolean)
    .map(u => ({ id: u.id, nickname: u.nickname, ai: false, value: Math.floor(Math.max(0, weekScore(u, group.week) ?? 0)) }));
  return [...people, ...groupBots(group, progress)]
    .sort((a, b) => b.value - a.value || Number(a.ai) - Number(b.ai) || a.nickname.localeCompare(b.nickname))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// Puts everyone who played this week into a group (in a fixed order, so it comes out the same
// on every copy of the state) of their league (a new group when theirs is full).
export function joinLeagues(state, now = Date.now()) {
  const week = rpWeekOf(now), src = source(state);
  for (const u of Object.values(state.users || {}).sort((a, b) => (a.rpWeek?.first || '').localeCompare(b.rpWeek?.first || '') || a.id.localeCompare(b.id))) {
    if (u.guest || weekScore(u, week.id) === null) continue;
    if (src.groups.some(g => g.week === week.id && g.members.includes(u.id))) continue;
    const level = levelOf(u);
    let group = src.groups.find(g => g.week === week.id && g.level === level && g.members.length < LEAGUE_SIZE);
    if (!group) {
      // Ids and seeds come from the week, the league and the group's number, so a state that is
      // only read (and not saved) draws the same group the next save writes.
      const n = src.groups.filter(g => g.week === week.id && g.level === level).length;
      const id = `${week.id}-${LEAGUES[level].id}-${n + 1}`;
      group = { id, week: week.id, level, seed: crypto.createHash('sha256').update(id).digest('hex').slice(0, 16), members: [] };
      src.groups.push(group);
    }
    group.members.push(u.id);
    u.league = { ...(u.league || {}), level, week: week.id, group: group.id };
  }
}

// Closes every week that has ended: moves people up and down and hands out the badges.
export function settleLeagues(state, now = Date.now()) {
  const src = source(state), current = rpWeekOf(now).id;
  const ended = [...new Set(src.groups.map(g => g.week))].filter(w => w < current && !src.settled.includes(w));
  for (const week of ended) {
    for (const group of src.groups.filter(g => g.week === week)) {
      const rows = standings(state, group, 1), of = rows.length;
      for (const r of rows.filter(x => !x.ai)) {
        const u = state.users[r.id];
        if (!u) continue;
        const from = group.level;
        const move = r.rank <= LEAGUE_UP && from < LEAGUES.length - 1 ? 1 : r.rank > of - LEAGUE_DOWN && from > 0 ? -1 : 0;
        u.league = { ...(u.league || {}), level: from + move, last: { week, level: from, rank: r.rank, of, move, score: r.value } };
        noteRpRecord(u, x => ({ leagueUps: x.leagueUps + (move > 0 ? 1 : 0), league: Math.max(x.league, from + move), podiums: x.podiums + (r.rank <= LEAGUE_BADGES ? 1 : 0) }));
        if (r.rank <= LEAGUE_BADGES) {
          u.badges = Array.isArray(u.badges) ? u.badges : [];
          u.badges.unshift({ kind: 'LEAGUE', league: LEAGUES[from].id, rank: r.rank, name: LEAGUES[from].name, seasonId: week, at: new Date(now).toISOString() });
          if (u.badges.length > 40) u.badges.length = 40;
        }
      }
    }
    src.settled.push(week);
  }
  // Keep this week and the one before, for the "last week" line.
  const keep = new Set([current, ...src.settled.slice(-1)]);
  src.groups = src.groups.filter(g => keep.has(g.week));
  src.settled = src.settled.slice(-8);
}

export const leagueDue = (state, now = Date.now()) => {
  const current = rpWeekOf(now).id;
  return (state.league?.groups || []).some(g => g.week < current && !(state.league.settled || []).includes(g.week));
};

// How my last finished week ended, with the league names it moved between (the result card,
// js/league-moment.js, plays the move up or down from these).
function lastWeekView(last) {
  if (!last || !Number.isFinite(last.level)) return null;
  const from = LEAGUES[Math.max(0, Math.min(LEAGUES.length - 1, last.level))];
  const to = LEAGUES[Math.max(0, Math.min(LEAGUES.length - 1, last.level + (last.move || 0)))];
  return { ...last, fromId: from.id, fromName: from.name, toId: to.id, toName: to.name, badge: last.rank <= LEAGUE_BADGES };
}

// What my 리그 screen shows: my group's thirty, where the lines for moving up and down sit, and
// how last week ended.
export function leagueView(state, user, now = Date.now()) {
  const week = rpWeekOf(now), level = levelOf(user);
  const group = (state.league?.groups || []).find(g => g.week === week.id && g.members.includes(user.id));
  const base = { week: week.id, endsAt: new Date(week.endsAt).toISOString(), level, league: LEAGUES[level].id, name: LEAGUES[level].name, top: level === LEAGUES.length - 1, bottom: level === 0, up: LEAGUE_UP, down: LEAGUE_DOWN, size: LEAGUE_SIZE, last: lastWeekView(user.league?.last) };
  if (!group) return { ...base, joined: false, rows: [] };
  const progress = (now - week.startsAt) / (week.endsAt - week.startsAt);
  const rows = standings(state, group, progress).map(r => ({ ...r, me: r.id === user.id }));
  const mine = rows.find(r => r.me);
  return { ...base, joined: true, rank: mine?.rank ?? null, score: mine?.value ?? 0, rows };
}
