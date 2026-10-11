import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { settleHouseGame, totalBalance } from '../lib/economy.mjs';
import { handleApi } from '../lib/api.mjs';
import { dayKey, dailyStatus, claimDaily, DAILY_REWARDS, missionsFor, missionsStatus, claimMission, MISSIONS, MISSION_SWEEP_BONUS, weekBoundary, settleFinishedSeason, SEASON_PRIZES, rescueStatus, playRescue, onRoundSettled } from '../lib/engagement.mjs';

const DAY = 86_400_000;
// 2026-10-14 12:00 in Seoul, a Wednesday.
const WED = Date.parse('2026-10-14T03:00:00Z');

test('days turn over at midnight in Seoul', () => {
  assert.equal(dayKey(Date.parse('2026-10-14T14:59:59Z')), '2026-10-14');
  assert.equal(dayKey(Date.parse('2026-10-14T15:00:00Z')), '2026-10-15');
});

test('daily bonus pays once a day and climbs a 7-day streak that resets on a missed day', () => {
  const state = defaultState(); const u = state.users.hanseo;
  const start = u.account.available;
  const first = claimDaily(state, u, WED);
  assert.equal(first.amount, DAILY_REWARDS[0]);
  assert.throws(() => claimDaily(state, u, WED + 1000), /DAILY_ALREADY_CLAIMED/);
  assert.equal(dailyStatus(u, WED).claimed, true);
  for (let d = 1; d < 7; d++) claimDaily(state, u, WED + d * DAY);
  assert.equal(u.daily.streak, 7);
  assert.equal(u.account.available, start + DAILY_REWARDS.reduce((a, b) => a + b, 0));
  assert.equal(state.feed[0].type, 'DAILY_STREAK');
  // Day 8 starts the calendar over but keeps the streak.
  assert.equal(dailyStatus(u, WED + 7 * DAY).day, 1);
  assert.equal(claimDaily(state, u, WED + 7 * DAY).streak, 8);
  // Skipping a day drops the streak.
  assert.equal(dailyStatus(u, WED + 9 * DAY).streak, 0);
  assert.equal(dailyStatus(u, WED + 9 * DAY).reward, DAILY_REWARDS[0]);
});

test('three missions a day, stable within the day, one of them general', () => {
  const a = missionsFor('hanseo', '2026-10-14');
  assert.deepEqual(a, missionsFor('hanseo', '2026-10-14'));
  assert.equal(new Set(a.map(m => m.id)).size, 3);
  assert.equal(a.filter(m => !m.game).length, 1);
});

test('settled rounds advance missions, and claiming all three adds the sweep bonus', () => {
  const state = defaultState(); const u = state.users.hanseo;
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
  assert.equal(last.bonus, MISSION_SWEEP_BONUS);
  const rewards = ['rounds-any', 'wins-blackjack', 'mult-5'].reduce((a, id) => a + MISSIONS.find(m => m.id === id).reward, 0);
  assert.equal(u.account.available, before + rewards + MISSION_SWEEP_BONUS);
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
  win('june', 9_000_000); win('min', 4_000_000); win('zero', 1_000_000); win('hanseo', -2_000_000);
  const before = { june: state.users.june.account.available, min: state.users.min.account.available, hanseo: state.users.hanseo.account.available };
  const result = settleFinishedSeason(state, WED);
  assert.deepEqual(result.podium.map(r => r.userId), ['june', 'min', 'zero']);
  assert.equal(state.users.june.account.available, before.june + SEASON_PRIZES[0]);
  assert.equal(state.users.min.account.available, before.min + SEASON_PRIZES[1]);
  assert.equal(state.users.hanseo.account.available, before.hanseo);
  assert.equal(state.users.june.badges[0].rank, 1);
  assert.equal(settleFinishedSeason(state, WED + 1000), null);
  assert.equal(state.users.june.account.available, before.june + SEASON_PRIZES[0]);
});

test('lucky card rescue only opens on an empty wallet while the recharge cools down', () => {
  const state = defaultState(); const u = state.users.hanseo;
  assert.equal(rescueStatus(u, WED).eligible, false);
  u.account.available = 0;
  u.recharge.lastAt = new Date(WED - 60_000).toISOString();
  u.recharge.dailyDate = new Date(WED).toISOString().slice(0, 10);
  const status = rescueStatus(u, WED);
  assert.equal(status.broke, true);
  assert.equal(status.eligible, true);
  const out = playRescue(state, u, 1, () => 0, WED);
  assert.equal(out.cards.length, 3);
  assert.equal(new Set(out.cards).size, 3);
  assert.equal(totalBalance(u), out.amount);
  assert.equal(out.amount, out.cards[1]);
  assert.throws(() => playRescue(state, u, 0, Math.random, WED + 1000), /RESCUE_NOT_AVAILABLE/);
});

test('API exposes engagement and the claim routes', async () => {
  let state = defaultState();
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body) => handleApi({ method, header: () => undefined, body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  const s = await call('GET', '/api/state');
  assert.equal(s.data.engagement.daily.claimed, false);
  assert.equal(s.data.engagement.missions.items.length, 3);
  assert.ok(s.data.rankings.season, 'weekly season is always on');
  const claim = await call('POST', '/api/daily/claim');
  assert.equal(claim.status, 200);
  assert.equal(claim.data.state.engagement.daily.claimed, true);
  assert.equal((await call('POST', '/api/daily/claim')).status, 409);
  assert.equal((await call('POST', '/api/missions/claim', { missionId: 'nope' })).status, 404);
  assert.equal((await call('POST', '/api/rescue', { pick: 0 })).status, 409);
  // Settling a round shows up in the weekly season board.
  await call('POST', '/api/sicbo/play', { stake: 100_000, floor: 'downtown', betType: 'BIG' });
  const after = await call('GET', '/api/state');
  const me = after.data.rankings.season.highRoller.find(r => r.id === 'hanseo');
  assert.equal(me.value, 100_000);
});
