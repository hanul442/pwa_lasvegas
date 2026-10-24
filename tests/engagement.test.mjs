import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { settleHouseGame, totalBalance } from '../lib/economy.mjs';
import { handleApi } from '../lib/api.mjs';
import { tableBase } from '../lib/state.mjs';
import { dayKey, dailyStatus, claimDaily, PAY, PAY_MIN, PAY_CYCLE, supportStatus, claimSupport, WELFARE_STEPS, missionsFor, missionsStatus, claimMission, MISSIONS, MISSION_SWEEP_BONUS, weekBoundary, settleFinishedSeason, SEASON_PRIZES, rescueStatus, playRescue, onRoundSettled } from '../lib/engagement.mjs';

const DAY = 86_400_000;
// 2026-10-14 12:00 in Seoul, a Wednesday.
const WED = Date.parse('2026-10-14T03:00:00Z');

test('days turn over at midnight in Seoul', () => {
  assert.equal(dayKey(Date.parse('2026-10-14T14:59:59Z')), '2026-10-14');
  assert.equal(dayKey(Date.parse('2026-10-14T15:00:00Z')), '2026-10-15');
});

test('일급 every day, 주급 on every seventh day in a row, 월급 on the 28th, and a missed day starts over', () => {
  const rate = (kind, base) => Math.max(PAY[kind] * base, PAY_MIN[kind]);
  const state = defaultState(); const u = state.users.hanseo;
  const base = tableBase(u);
  assert.equal(base, 10_000_000, 'the 10억 profile sits at High Limit at the cheapest');
  const start = u.account.available;
  const first = claimDaily(state, u, WED);
  assert.equal(first.amount, rate('daily', base));
  assert.equal(first.amount, 10_000_000_000, '일급 is at least 100억');
  assert.throws(() => claimDaily(state, u, WED + 1000), /DAILY_ALREADY_CLAIMED/);
  assert.equal(dailyStatus(u, WED).claimed, true);
  assert.equal(dailyStatus(u, WED).toWeekly, 6);
  // Pay is counted in the table base on the day it is paid, and the pay itself can lift the
  // player past a floor's ceiling, so each day is checked against the base it was paid at.
  let paid = first.amount, last;
  const claim = d => { const b = tableBase(u); last = claimDaily(state, u, WED + d * DAY); paid += last.amount; return b; };
  for (let d = 1; d < 6; d++) claim(d);
  const weekBase = claim(6);
  assert.equal(u.daily.streak, 7);
  assert.deepEqual(last.pay, { daily: rate('daily', weekBase), weekly: rate('weekly', weekBase), monthly: 0 });
  assert.equal(u.account.available, start + paid);
  assert.equal(u.payStats.weeks, 1);
  assert.equal(state.feed[0].type, 'DAILY_STREAK');
  for (let d = 7; d < PAY_CYCLE - 1; d++) claim(d);
  const monthBase = claim(PAY_CYCLE - 1);
  assert.equal(u.payStats.weeks, 4);
  assert.equal(u.payStats.months, 1);
  assert.ok(state.ledger.some(x => x.userId === 'hanseo' && x.type === 'MONTHLY_PAY' && x.amount === rate('monthly', monthBase)));
  // Day 29 starts the calendar over but keeps the streak.
  assert.equal(dailyStatus(u, WED + PAY_CYCLE * DAY).day, 1);
  assert.equal(claimDaily(state, u, WED + PAY_CYCLE * DAY).streak, PAY_CYCLE + 1);
  // Skipping a day drops the streak.
  assert.equal(dailyStatus(u, WED + (PAY_CYCLE + 2) * DAY).streak, 0);
});

test('정부 지원금 once a week for anyone; 구제금융 once a day for someone worth under 100만', () => {
  const state = defaultState(); const u = state.users.hanseo;
  // Mid-way through High Limit (1억–10억 net worth), so a payout doesn't graduate the floor.
  u.account.available = 300_000_000;
  const grant = claimSupport(state, u, 'grant', WED);
  assert.equal(grant.amount, 5 * tableBase(u));
  assert.throws(() => claimSupport(state, u, 'grant', WED + DAY), /SUPPORT_ALREADY_CLAIMED/);
  const base = tableBase(u);
  assert.equal(claimSupport(state, u, 'grant', WED + 7 * DAY).amount, 5 * base, 'next week pays again');
  assert.throws(() => claimSupport(state, u, 'welfare', WED), /WELFARE_NOT_QUALIFIED/);
  u.account.available = 200_000;
  assert.equal(supportStatus(u, WED).welfare.qualified, true);
  // Ten a day, 100억 each.
  assert.deepEqual(WELFARE_STEPS, Array(10).fill(10_000_000_000));
  assert.equal(claimSupport(state, u, 'welfare', WED).amount, 10_000_000_000);
  assert.throws(() => claimSupport(state, u, 'welfare', WED + 1000), /WELFARE_NOT_QUALIFIED/, 'only while broke');
  for (const step of WELFARE_STEPS.slice(1)) {
    u.account.available = 0; // lost it all again
    assert.equal(claimSupport(state, u, 'welfare', WED + 1000).amount, step);
  }
  u.account.available = 0;
  assert.equal(supportStatus(u, WED).welfare.claimed, true);
  assert.throws(() => claimSupport(state, u, 'welfare', WED + 2000), /SUPPORT_ALREADY_CLAIMED/);
  // A new day starts back at 10억, and a save from before (only the day) counts as one taken.
  assert.equal(claimSupport(state, u, 'welfare', WED + DAY).amount, 10_000_000_000);
  u.support.welfare = dayKey(WED + 2 * DAY); u.account.available = 0;
  assert.equal(supportStatus(u, WED + 2 * DAY).welfare.taken, 1);
});

test('three missions a day, stable within the day, one of them general', () => {
  const a = missionsFor('hanseo', '2026-10-14');
  assert.deepEqual(a, missionsFor('hanseo', '2026-10-14'));
  assert.equal(new Set(a.map(m => m.id)).size, 3);
  assert.equal(a.filter(m => !m.game).length, 1);
});

test('settled rounds advance missions, and claiming all three adds the sweep bonus', () => {
  const state = defaultState(); const u = state.users.hanseo;
  // Mid-way through High Limit (1억–10억 net worth), so a payout doesn't graduate the floor.
  u.account.available = 300_000_000;
  // Force a known set of missions for the day.
  u.missions = { day: dayKey(WED), items: ['rounds-any', 'wins-blackjack', 'mult-5'].map(id => ({ id, progress: 0, claimed: false })), games: [], swept: false };
  assert.throws(() => claimMission(state, u, 'rounds-any', WED), /MISSION_NOT_DONE/);
  for (let i = 0; i < 10; i++) onRoundSettled(state, u, { game: 'Blackjack', stake: 100_000, netPnl: i < 3 ? 100_000 : -100_000 }, WED);
  onRoundSettled(state, u, { game: 'Roulette', stake: 100_000, netPnl: 3_500_000 }, WED);
  const view = missionsStatus(u, WED);
  assert.ok(view.items.every(i => i.done), JSON.stringify(view.items));
  const before = u.account.available;
  for (const id of ['rounds-any', 'wins-blackjack']) claimMission(state, u, id, WED);
  const last = claimMission(state, u, 'mult-5', WED);
  const base = tableBase(u);
  assert.equal(last.bonus, MISSION_SWEEP_BONUS * base);
  const rewards = ['rounds-any', 'wins-blackjack', 'mult-5'].reduce((a, id) => a + MISSIONS.find(m => m.id === id).pays * base, 0);
  assert.equal(u.account.available, before + rewards + MISSION_SWEEP_BONUS * base);
  assert.throws(() => claimMission(state, u, 'mult-5', WED), /MISSION_ALREADY_CLAIMED/);
  // The 35x roulette hit went to the lounge feed.
  assert.ok(state.feed.some(f => f.type === 'HOT_WIN' && f.game === 'Roulette' && f.multiple === 35));
  // Next day brings fresh missions.
  assert.ok(missionsStatus(u, WED + DAY).items.every(i => i.progress === 0 && !i.claimed));
});

test('win streaks count wins in a row and pushes keep them going', () => {
  const state = defaultState(); const u = state.users.hanseo;
  for (const n of [1, 1, 0, 1, -1, 1]) onRoundSettled(state, u, { game: 'Baccarat', stake: 100, netPnl: n * 100 }, WED);
  assert.deepEqual(u.streak, { current: 1, best: 3 });
});

test('weeks run Monday to Monday in Seoul', () => {
  const w = weekBoundary(WED);
  assert.equal(w.id, 'week-2026-10-12');
  assert.equal(w.startsAt, '2026-10-11T15:00:00.000Z');
  assert.equal(w.endsAt, '2026-10-18T15:00:00.000Z');
  // Sunday 23:59 Seoul is still the same week; Monday 00:00 is the next.
  assert.equal(weekBoundary(Date.parse('2026-10-18T14:59:00Z')).id, 'week-2026-10-12');
  assert.equal(weekBoundary(Date.parse('2026-10-18T15:00:00Z')).id, 'week-2026-10-19');
});

test('a finished season pays its podium once and leaves a badge', () => {
  const state = defaultState();
  state.ledger = state.ledger.filter(tx => tx.type === 'INITIAL_GRANT' || tx.referenceType === 'DEMO_SEED' ? false : true);
  const lastWeek = weekBoundary(WED - 7 * DAY);
  const at = new Date(Date.parse(lastWeek.startsAt) + DAY).toISOString();
  const win = (uid, pnl) => state.ledger.push({ id: `tx_${uid}_${pnl}`, userId: uid, type: pnl > 0 ? 'GAME_WIN' : 'GAME_LOSS', amount: pnl, rawPnlDelta: pnl, qualifiedPnlDelta: pnl, createdAt: at, metadata: { game: 'Baccarat', stake: 1_000_000 } });
  // Three people, plus the demo AI 'june' with the best week of all: AI never takes a prize.
  for (const [uid, from] of [['ann', 'june'], ['bo', 'min'], ['cy', 'zero']]) state.users[uid] = { ...structuredClone(state.users[from]), id: uid, nickname: uid.toUpperCase() };
  win('ann', 9_000_000); win('bo', 4_000_000); win('cy', 1_000_000); win('hanseo', -2_000_000); win('june', 50_000_000);
  const before = { ann: state.users.ann.account.available, bo: state.users.bo.account.available, hanseo: state.users.hanseo.account.available, june: state.users.june.account.available };
  // Prizes are counted in each winner's table base at the moment they are paid.
  const prizes = { ann: SEASON_PRIZES[0] * tableBase(state.users.ann), bo: SEASON_PRIZES[1] * tableBase(state.users.bo) };
  const result = settleFinishedSeason(state, WED);
  assert.deepEqual(result.podium.map(r => r.userId), ['ann', 'bo', 'cy']);
  assert.equal(state.users.ann.account.available, before.ann + prizes.ann);
  assert.equal(state.users.bo.account.available, before.bo + prizes.bo);
  assert.equal(state.users.hanseo.account.available, before.hanseo);
  assert.equal(state.users.june.account.available, before.june);
  assert.equal(state.users.ann.badges[0].rank, 1);
  assert.equal(settleFinishedSeason(state, WED + 1000), null);
  assert.equal(state.users.ann.account.available, before.ann + prizes.ann);
});

test('the lucky card rescue is retired: an empty wallet gets the 구제금융 instead', () => {
  const state = defaultState(); const u = state.users.hanseo;
  u.account.available = 0;
  u.recharge.lastAt = new Date(WED - 60_000).toISOString();
  u.recharge.dailyDate = new Date(WED).toISOString().slice(0, 10);
  const status = rescueStatus(u, WED);
  assert.equal(status.broke, true);
  assert.equal(status.eligible, false);
  assert.throws(() => playRescue(state, u, 0, Math.random, WED), /RESCUE_NOT_AVAILABLE/);
  assert.equal(totalBalance(u), 0);
});

test('API exposes engagement and the claim routes', async () => {
  let state = defaultState();
  // Mid-way through High Limit (1억–10억 net worth), so a payout doesn't graduate the floor.
  state.users.hanseo.account.available = 300_000_000;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body) => handleApi({ method, header: () => undefined, body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  const s = await call('GET', '/api/state');
  assert.equal(s.data.engagement.daily.claimed, false);
  assert.equal(s.data.engagement.missions.items.length, 3);
  assert.ok(s.data.rankings.season, 'weekly season is always on');
  // Settling a round shows up in the weekly season board (played before 일급 lifts the player
  // past High Limit).
  await call('POST', '/api/sicbo/play', { stake: 10_000_000, floor: 'high-limit', betType: 'BIG' });
  const after = await call('GET', '/api/state');
  const me = after.data.rankings.season.highRoller.find(r => r.id === 'hanseo');
  assert.equal(me.value, 10_000_000);
  const claim = await call('POST', '/api/daily/claim');
  assert.equal(claim.status, 200);
  assert.equal(claim.data.state.engagement.daily.claimed, true);
  assert.equal((await call('POST', '/api/daily/claim')).status, 409);
  assert.equal((await call('POST', '/api/missions/claim', { missionId: 'nope' })).status, 404);
  assert.equal((await call('POST', '/api/rescue', { pick: 0 })).status, 409);
});
