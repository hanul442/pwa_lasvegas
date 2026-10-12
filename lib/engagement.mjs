// Reasons to come back: 일급·주급·월급 pay, government support, three daily missions, the weekly
// season, win streaks, the lounge feed and the lucky-card rescue for an empty wallet.
// Days and weeks follow Korean time, so "today" turns over at midnight in Seoul.
import { id, tableBase, netWorth } from './state.mjs';
import { addLedger, totalBalance, rechargeStatus } from './economy.mjs';
import { buildSeasonPerformanceFromLedger } from './seasons.mjs';

const KST = 9 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function dayKey(now = Date.now()) { return new Date(now + KST).toISOString().slice(0, 10); }
function dayStart(key) { return Date.parse(`${key}T00:00:00Z`) - KST; }

// ---------- pay: 일급, 주급, 월급 ----------
// Clock in once a day for 일급. Seven days in a row adds a 주급 bonus; four 주급 in a row (28
// days) add a 월급 bonus, and the calendar starts over. Amounts are counted in the smallest bet
// of the cheapest table the player may sit at (tableBase), so pay keeps up with the floors.
export const PAY = { daily: 10, weekly: 100, monthly: 500 };
export const PAY_CYCLE = 28;

function dailyRecord(user) {
  const d = user.daily;
  return d && typeof d === 'object' ? d : { lastClaim: null, streak: 0 };
}

export function payFor(day, base) {
  const weekly = day % 7 === 0, monthly = day === PAY_CYCLE;
  return { daily: PAY.daily * base, weekly: weekly ? PAY.weekly * base : 0, monthly: monthly ? PAY.monthly * base : 0 };
}

export function dailyStatus(user, now = Date.now()) {
  const today = dayKey(now), yesterday = dayKey(now - DAY);
  const d = dailyRecord(user);
  const claimed = d.lastClaim === today;
  const alive = claimed || d.lastClaim === yesterday;
  const streak = alive ? d.streak : 0;
  // day: today's place in the 28-day calendar (the one just claimed, or the one to claim).
  const day = claimed ? ((streak - 1) % PAY_CYCLE) + 1 : (streak % PAY_CYCLE) + 1;
  const base = tableBase(user);
  const pay = payFor(day, base);
  const reward = claimed ? 0 : pay.daily + pay.weekly + pay.monthly;
  return {
    claimed, streak, day, reward, pay, base,
    rates: { daily: PAY.daily * base, weekly: PAY.weekly * base, monthly: PAY.monthly * base },
    // Pay days left until the next 주급 and 월급, today's counted when it is still to claim.
    toWeekly: claimed ? 7 - (day % 7) : 7 - ((day - 1) % 7),
    toMonthly: claimed ? (day === PAY_CYCLE ? PAY_CYCLE : PAY_CYCLE - day) : PAY_CYCLE - day + 1,
    nextAt: new Date(dayStart(today) + DAY).toISOString()
  };
}

export function claimDaily(state, user, now = Date.now()) {
  const status = dailyStatus(user, now);
  if (status.claimed) throw new Error('DAILY_ALREADY_CLAIMED');
  const streak = status.streak + 1;
  const { pay, day } = status;
  addLedger(state, user, { type: 'DAILY_BONUS', amount: pay.daily, referenceType: 'DAILY', metadata: { day, streak, kind: 'daily' } });
  if (pay.weekly) addLedger(state, user, { type: 'WEEKLY_PAY', amount: pay.weekly, referenceType: 'DAILY', metadata: { day, streak } });
  if (pay.monthly) addLedger(state, user, { type: 'MONTHLY_PAY', amount: pay.monthly, referenceType: 'DAILY', metadata: { day, streak } });
  user.daily = { lastClaim: dayKey(now), streak };
  const ps = user.payStats && typeof user.payStats === 'object' ? user.payStats : { days: 0, weeks: 0, months: 0 };
  ps.days++; if (pay.weekly) ps.weeks++; if (pay.monthly) ps.months++;
  user.payStats = ps;
  if (pay.monthly) pushFeed(state, { type: 'MONTHLY_PAY', actorId: user.id, amount: pay.monthly, streak });
  else if (pay.weekly) pushFeed(state, { type: 'DAILY_STREAK', actorId: user.id, amount: pay.weekly, streak });
  return { amount: pay.daily + pay.weekly + pay.monthly, pay, day, streak };
}

// ---------- government support ----------
// 정부 지원금: anyone, once a Seoul week. 기초생활수급: someone worth under 1천원 gets 생계급여 once a day.
export const SUPPORT_WEEKLY = 50;
export const WELFARE_BELOW = 1_000;
export const WELFARE_DAILY = 300;

function support(user) {
  return user.support && typeof user.support === 'object' ? user.support : { weekly: null, welfare: null, totalWeekly: 0, totalWelfare: 0 };
}

export function supportStatus(user, now = Date.now()) {
  const s = support(user), week = weekBoundary(now).id, today = dayKey(now);
  const worth = netWorth(user);
  return {
    grant: { amount: SUPPORT_WEEKLY * tableBase(user), claimed: s.weekly === week, nextAt: weekBoundary(now).endsAt },
    welfare: { amount: WELFARE_DAILY, below: WELFARE_BELOW, qualified: worth < WELFARE_BELOW, claimed: s.welfare === today, nextAt: new Date(dayStart(today) + DAY).toISOString() }
  };
}

export function claimSupport(state, user, kind, now = Date.now()) {
  const status = supportStatus(user, now), s = support(user);
  if (kind === 'grant') {
    if (status.grant.claimed) throw new Error('SUPPORT_ALREADY_CLAIMED');
    addLedger(state, user, { type: 'GOV_GRANT', amount: status.grant.amount, referenceType: 'SUPPORT', referenceId: weekBoundary(now).id });
    s.weekly = weekBoundary(now).id; s.totalWeekly = (s.totalWeekly || 0) + status.grant.amount;
    user.support = s;
    return { amount: status.grant.amount };
  }
  if (kind === 'welfare') {
    if (!status.welfare.qualified) throw new Error('WELFARE_NOT_QUALIFIED');
    if (status.welfare.claimed) throw new Error('SUPPORT_ALREADY_CLAIMED');
    addLedger(state, user, { type: 'WELFARE', amount: WELFARE_DAILY, referenceType: 'SUPPORT', referenceId: dayKey(now) });
    s.welfare = dayKey(now); s.totalWelfare = (s.totalWelfare || 0) + WELFARE_DAILY;
    user.support = s;
    return { amount: WELFARE_DAILY };
  }
  throw new Error('INVALID_SUPPORT');
}

// ---------- daily missions ----------
// Game names match the ledger's metadata.game.
export const MISSIONS = [
  { id: 'rounds-any', label: '아무 게임이나 10판 하기', kind: 'rounds', target: 10, pays: 4 },
  { id: 'rounds-30', label: '아무 게임이나 30판 하기', kind: 'rounds', target: 30, pays: 10 },
  { id: 'variety', label: '서로 다른 게임 3가지 하기', kind: 'variety', target: 3, pays: 6 },
  { id: 'variety-5', label: '서로 다른 게임 5가지 하기', kind: 'variety', target: 5, pays: 10 },
  { id: 'streak-3', label: '3연승 하기', kind: 'streak', target: 3, pays: 8 },
  { id: 'wins-5', label: '아무 게임이나 5번 이기기', kind: 'wins', target: 5, pays: 6 },
  { id: 'mult-5', label: '한 판에 건 돈의 5배 이상 따기', kind: 'multiple', mult: 5, target: 1, pays: 10 },
  { id: 'big-bet', label: '한 판에 최소 베팅의 5배 이상 걸기', kind: 'bigbet', mult: 5, target: 1, pays: 5 },
  { id: 'wins-blackjack', label: '블랙잭에서 3번 이기기', kind: 'wins', game: 'Blackjack', target: 3, pays: 6 },
  { id: 'rounds-blackjack', label: '블랙잭 8판 하기', kind: 'rounds', game: 'Blackjack', target: 8, pays: 5 },
  { id: 'wins-baccarat', label: '바카라에서 3번 이기기', kind: 'wins', game: 'Baccarat', target: 3, pays: 5 },
  { id: 'rounds-roulette', label: '룰렛 5번 돌리기', kind: 'rounds', game: 'Roulette', target: 5, pays: 4 },
  { id: 'wins-roulette', label: '룰렛에서 2번 맞히기', kind: 'wins', game: 'Roulette', target: 2, pays: 6 },
  { id: 'wins-sicbo', label: '식보에서 2번 이기기', kind: 'wins', game: 'Sic Bo', target: 2, pays: 5 },
  { id: 'wins-matgo', label: '맞고 한 판 이기기', kind: 'wins', game: 'Matgo', target: 1, pays: 6 },
  { id: 'wins-gostop', label: '고스톱 한 판 이기기', kind: 'wins', game: 'Gostop', target: 1, pays: 6 },
  { id: 'wins-seotda', label: '섯다에서 2번 이기기', kind: 'wins', game: 'Seotda', target: 2, pays: 6 },
  { id: 'wins-holdem', label: '홀덤에서 수익 내고 일어나기', kind: 'wins', game: "Hold'em", target: 1, pays: 8 },
  { id: 'wins-slots', label: '슬롯에서 3번 맞추기', kind: 'wins', game: 'Slots', target: 3, pays: 5 },
  { id: 'rounds-slots', label: '슬롯 레버 15번 당기기', kind: 'rounds', game: 'Slots', target: 15, pays: 4 }
];
// Rewards are counted in the player's table base (see tableBase); a full sweep pays a bonus.
export const MISSION_SWEEP_BONUS = 10;
const missionReward = (def, user) => def.pays * tableBase(user);

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Three missions a day, the same for a player all day long: one general, two game-specific.
export function missionsFor(userId, day) {
  const general = MISSIONS.filter(m => !m.game), games = MISSIONS.filter(m => m.game);
  const h = hash(`${userId}:${day}`);
  const first = general[h % general.length];
  const a = games[(h >>> 8) % games.length];
  let b = games[(h >>> 16) % games.length];
  if (b === a) b = games[(games.indexOf(a) + 1) % games.length];
  return [first, a, b];
}

function missionState(user, now) {
  const day = dayKey(now);
  if (user.missions?.day === day) return user.missions;
  return { day, items: missionsFor(user.id, day).map(m => ({ id: m.id, progress: 0, claimed: false })), games: [], swept: false };
}

export function missionsStatus(user, now = Date.now()) {
  const ms = missionState(user, now);
  const items = ms.items.map(it => {
    const def = MISSIONS.find(m => m.id === it.id);
    return { id: it.id, label: def.label, target: def.target, reward: missionReward(def, user), progress: Math.min(def.target, it.progress), done: it.progress >= def.target, claimed: it.claimed };
  });
  return { day: ms.day, items, sweepBonus: MISSION_SWEEP_BONUS * tableBase(user), swept: Boolean(ms.swept), nextAt: new Date(dayStart(ms.day) + DAY).toISOString() };
}

export function claimMission(state, user, missionId, now = Date.now()) {
  const ms = missionState(user, now);
  user.missions = ms;
  const it = ms.items.find(x => x.id === missionId);
  if (!it) throw new Error('MISSION_NOT_FOUND');
  const def = MISSIONS.find(m => m.id === missionId);
  if (it.progress < def.target) throw new Error('MISSION_NOT_DONE');
  if (it.claimed) throw new Error('MISSION_ALREADY_CLAIMED');
  it.claimed = true;
  const amount = missionReward(def, user);
  addLedger(state, user, { type: 'MISSION_REWARD', amount, referenceType: 'MISSION', referenceId: `${ms.day}:${def.id}`, metadata: { mission: def.id } });
  let bonus = 0;
  if (!ms.swept && ms.items.every(x => x.claimed)) {
    ms.swept = true; bonus = MISSION_SWEEP_BONUS * tableBase(user);
    addLedger(state, user, { type: 'MISSION_REWARD', amount: bonus, referenceType: 'MISSION', referenceId: `${ms.day}:sweep`, metadata: { mission: 'sweep' } });
  }
  return { amount, bonus };
}

function trackMissions(user, { game, stake, netPnl }, now) {
  const ms = missionState(user, now);
  user.missions = ms;
  if (!ms.games.includes(game)) ms.games.push(game);
  const won = netPnl > 0;
  for (const it of ms.items) {
    const def = MISSIONS.find(m => m.id === it.id);
    if (!def || it.progress >= def.target) continue;
    if (def.game && def.game !== game) continue;
    if (def.kind === 'rounds') it.progress++;
    else if (def.kind === 'wins' && won) it.progress++;
    else if (def.kind === 'variety') it.progress = ms.games.length;
    else if (def.kind === 'streak') it.progress = Math.max(it.progress, user.streak?.current || 0);
    else if (def.kind === 'multiple' && won && stake > 0 && netPnl >= stake * def.mult) it.progress++;
    else if (def.kind === 'bigbet' && stake >= def.mult * tableBase(user)) it.progress++;
  }
}

// ---------- settlement hook ----------
export const HOT_WIN_MULTIPLE = 5;
export const HOT_WIN_CHIPS = 500_000_000;

// Called by economy.mjs after every settled round.
export function onRoundSettled(state, user, { game, stake, netPnl }, now = Date.now()) {
  const s = user.streak && typeof user.streak === 'object' ? user.streak : { current: 0, best: 0 };
  if (netPnl > 0) { s.current++; s.best = Math.max(s.best, s.current); }
  else if (netPnl < 0) s.current = 0;
  user.streak = s;
  trackMissions(user, { game, stake, netPnl }, now);
  const multiple = stake > 0 ? netPnl / stake : 0;
  // Lifetime records the achievements read.
  const r = user.records && typeof user.records === 'object' ? user.records : { bestMultiple: 0, games: [] };
  if (netPnl > 0) r.bestMultiple = Math.max(r.bestMultiple || 0, Math.floor(multiple));
  if (!r.games.includes(game)) r.games.push(game);
  user.records = r;
  if (netPnl > 0 && (multiple >= HOT_WIN_MULTIPLE || netPnl >= HOT_WIN_CHIPS)) {
    pushFeed(state, { type: 'HOT_WIN', actorId: user.id, game, amount: netPnl, multiple: Math.floor(multiple) });
  }
}

// ---------- lounge feed ----------
const FEED_LIMIT = 100;
export function pushFeed(state, entry) {
  if (!Array.isArray(state.feed)) state.feed = [];
  state.feed.unshift({ id: id('feed'), createdAt: new Date().toISOString(), ...entry });
  if (state.feed.length > FEED_LIMIT) state.feed.length = FEED_LIMIT;
}

export function feedView(state, limit = 20) {
  return (state.feed || []).slice(0, limit).map(f => ({ ...f, nickname: f.actorId ? state.users[f.actorId]?.nickname ?? null : null }));
}

// ---------- weekly season ----------
// Seasons run Monday 00:00 to Monday 00:00 in Seoul. Bankrolls carry over; the board resets.
// Counted in each winner's table base.
export const SEASON_PRIZES = [300, 200, 100];

export function weekBoundary(now = Date.now()) {
  const kst = new Date(now + KST);
  const weekday = (kst.getUTCDay() + 6) % 7; // Monday = 0
  const mondayKey = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - weekday)).toISOString().slice(0, 10);
  const start = dayStart(mondayKey);
  const [, m, d] = mondayKey.split('-').map(Number);
  return { id: `week-${mondayKey}`, name: `${m}월 ${d}일 주간 시즌`, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 7 * DAY).toISOString() };
}

export function weeklySeason(state, now = Date.now()) {
  const boundary = weekBoundary(now);
  const performanceByUser = buildSeasonPerformanceFromLedger(state, boundary) || {};
  return { ...boundary, bankrollCarriesOver: true, performanceResets: true, performanceByUser };
}

// Pays last week's podium once: the first state change of a new week settles it.
export function settleFinishedSeason(state, now = Date.now()) {
  const prev = weekBoundary(now - 7 * DAY);
  state.meta ??= {};
  const settled = Array.isArray(state.meta.settledSeasons) ? state.meta.settledSeasons : [];
  if (settled.includes(prev.id)) return null;
  const perf = buildSeasonPerformanceFromLedger(state, prev) || {};
  const podium = Object.entries(perf)
    .filter(([uid, p]) => state.users[uid] && p.profit > 0)
    .sort((a, b) => b[1].profit - a[1].profit || b[1].wagered - a[1].wagered)
    .slice(0, SEASON_PRIZES.length)
    .map(([uid, p], i) => ({ rank: i + 1, userId: uid, nickname: state.users[uid].nickname, profit: p.profit, reward: SEASON_PRIZES[i] * tableBase(state.users[uid]) }));
  for (const row of podium) {
    const u = state.users[row.userId];
    addLedger(state, u, { type: 'SEASON_REWARD', amount: row.reward, referenceType: 'SEASON', referenceId: prev.id, metadata: { rank: row.rank } });
    u.badges = Array.isArray(u.badges) ? u.badges : [];
    u.badges.unshift({ kind: 'SEASON', rank: row.rank, seasonId: prev.id, name: prev.name, at: new Date(now).toISOString() });
    if (row.rank === 1) pushFeed(state, { type: 'SEASON_WINNER', actorId: u.id, amount: row.profit, season: prev.name });
  }
  state.meta.settledSeasons = [...settled, prev.id].slice(-20);
  state.meta.lastSeason = { ...prev, podium };
  return state.meta.lastSeason;
}

// ---------- lucky card rescue ----------
// With an empty wallet and the recharge still cooling down, pick one of three face-down cards.
export const RESCUE_PRIZES = [10, 20, 30, 50, 100];
export const RESCUE_COOLDOWN_MS = 60 * 60 * 1000;
export const RESCUE_BELOW = 10; // can't cover the smallest bet

export function rescueStatus(user, now = Date.now()) {
  const recharge = rechargeStatus(user);
  const last = user.rescue?.lastAt ? Date.parse(user.rescue.lastAt) : 0;
  const cooldownRemaining = Math.max(0, RESCUE_COOLDOWN_MS - (now - last));
  const broke = totalBalance(user) < RESCUE_BELOW;
  return { eligible: broke && !recharge.eligible && cooldownRemaining === 0, broke, cooldownRemaining, prizes: RESCUE_PRIZES };
}

export function playRescue(state, user, pick, rand = Math.random, now = Date.now()) {
  if (!rescueStatus(user, now).eligible) throw new Error('RESCUE_NOT_AVAILABLE');
  const index = Number(pick);
  if (![0, 1, 2].includes(index)) throw new Error('INVALID_PICK');
  // Deal three distinct prizes; the picked card is the prize, the others are shown afterwards.
  const pool = [...RESCUE_PRIZES];
  const cards = Array.from({ length: 3 }, () => pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  const amount = cards[index];
  addLedger(state, user, { type: 'RESCUE_GRANT', amount, referenceType: 'RESCUE', metadata: { pick: index, cards } });
  user.rescue = { lastAt: new Date(now).toISOString(), total: (user.rescue?.total || 0) + amount };
  return { amount, cards, pick: index };
}

// ---------- per-player view ----------
export function engagementView(state, user, now = Date.now()) {
  return {
    daily: dailyStatus(user, now),
    support: supportStatus(user, now),
    missions: missionsStatus(user, now),
    streak: { current: user.streak?.current || 0, best: user.streak?.best || 0 },
    badges: Array.isArray(user.badges) ? user.badges.slice(0, 20) : [],
    rescue: rescueStatus(user, now),
    lastSeason: state.meta?.lastSeason ?? null,
    feed: feedView(state)
  };
}
