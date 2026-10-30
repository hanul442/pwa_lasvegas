import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { addLedger, lockBet, settleLockedHouseGame } from '../lib/economy.mjs';
import { rpForRound, noteRp, rpView, rpStandings, rpTierFor } from '../lib/rank-points.mjs';
import { handleApi } from '../lib/api.mjs';

const 억 = 100_000_000;
const NOV = Date.parse('2026-11-10T03:00:00Z');

test('RP follows the result against the bet, not the size of the bet', () => {
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 1_000_000 }), 10, 'win your bet back: +10');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: -1_000_000 }), -7, 'lose it: −7.5, rounded to whole RP');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 1_500_000 }), 15, 'blackjack 3:2');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 0 }), 0, 'a push moves nothing');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 35_000_000 }), 350, 'a straight-up hit: no cap on a round');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: -5_000_000 }), -37, 'nor on a loss');
  // A win counts for the most expensive floor its bet covers, never above the player's own floor;
  // a floor below it counts 0.5× (no 1.5× above it since 2026-10-30).
  assert.equal(rpForRound({ stake: 200_000_000, netPnl: 200_000_000, points: 0 }), 10, 'no bonus above my floor');
  assert.equal(rpForRound({ stake: 100_000_000, netPnl: 100_000_000, points: 0 }), 10);
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 1_000_000, points: 450 }), 5, 'a gold player below their floor: 0.5×');
});

test('no cap on a day, points never go below 0, and a new season starts three tiers lower', () => {
  const u = { rp: null };
  assert.equal(noteRp(u, { stake: 1e6, netPnl: -1e6 }, NOV), 0, 'nothing to lose yet');
  noteRp(u, { stake: 1e6, netPnl: 30e6 }, NOV);
  assert.equal(rpView(u, NOV).points, 300);
  noteRp(u, { stake: 1e6, netPnl: 30e6 }, NOV);
  assert.equal(rpView(u, NOV).today, 450, 'the second win: a silver player below their floor, 0.5×');
  assert.equal(rpView(u, NOV).tier, 'gold');
  noteRp(u, { stake: 1e6, netPnl: 1e6 }, NOV + 86_400_000);
  assert.equal(rpView(u, NOV + 86_400_000).today, 5, 'next day counts from 0');
  assert.equal(rpForRound({ stake: 1e6, netPnl: 1e6, points: 300 }), 5, 'the Gold Room is below a silver player: 0.5×');
  const DEC = Date.parse('2026-12-02T03:00:00Z');
  assert.equal(rpView(u, DEC).points, 0, '골드 450 → 아이언 0');
  noteRp(u, { stake: 1e6, netPnl: 1e6 }, DEC);
  assert.equal(u.rp.prev.season, 'rank-2026-10', 'October and November are one season');
});

test('every settled round notes RP, and the API shows my RP and the board', async () => {
  let state = defaultState();
  const u = state.users.hanseo;
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: 10 * 억, referenceType: 'TEST' });
  lockBet(state, u, { stake: 1_000_000, game: 'Blackjack', roundId: 'r1' });
  settleLockedHouseGame(state, u, { game: 'Blackjack', stake: 1_000_000, netPnl: 1_000_000, roundId: 'r1' });
  assert.equal(u.rp.points, 10);
  assert.equal(u.rp.rounds, 1);
  const g = newUser(state, 'ghost', 'GHOST'); g.guest = true; g.rp = { ...u.rp, points: 999 };
  assert.ok(!rpStandings(state).some(r => r.id === 'ghost'), 'guests stay off the board');
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const s = (await handleApi({ method: 'GET', header: n => ({ 'x-player-id': 'hanseo' })[n], body: async () => ({}) }, new URL('http://x/api/state'), store, {})).data;
  assert.equal(s.rp.points, 10);
  assert.equal(s.rp.tier, 'iron');
  assert.equal(s.rp.division, 'V');
  assert.equal(s.rp.toNext, 10, 'to 아이언 IV');
  assert.equal(s.rp.nextDivision, 'IV');
  assert.equal(s.rankings.rp.find(r => r.id === 'hanseo').value, 10);
});

test('tiers widen as they climb and split into five divisions; 레전드 has none', async () => {
  const { rpDivision, rpNextStep, rpTierFor, RP_TIER_STARTS } = await import('../lib/rank-points.mjs');
  assert.deepEqual(RP_TIER_STARTS, [0, 100, 200, 350, 500, 700, 900, 1200, 1500, 2300]);
  assert.deepEqual([0, 99, 100, 349, 350, 2299, 2300].map(p => rpTierFor(p).id), ['iron', 'iron', 'bronze', 'silver', 'gold', 'grandmaster', 'legend']);
  assert.deepEqual([0, 19, 20, 40, 60, 80, 99, 100, 229, 230, 2299, 2300, 5000].map(rpDivision), ['V', 'V', 'IV', 'III', 'II', 'I', 'I', 'V', 'V', 'IV', 'I', null, null]);
  assert.deepEqual(rpNextStep(80).next, { id: 'bronze', division: 'V', need: 20 });
  assert.deepEqual(rpNextStep(2250).next, { id: 'legend', division: null, need: 50 });
  assert.equal(rpNextStep(2350).next, null);
});

import { FLOORS } from '../lib/constants.mjs';
import { rpFloorLevel } from '../lib/rank-points.mjs';

test('실버 to 그랜드마스터 is 50:50; 레전드 wins less and loses more on the same bet', () => {
  // Bets on the player's own floor, so only the tier scale moves the numbers.
  const own = points => ({ stake: FLOORS[Math.min(FLOORS.length - 1, rpFloorLevel(points))].maxBet, points });
  const win = points => rpForRound({ ...own(points), netPnl: own(points).stake });
  const loss = points => rpForRound({ ...own(points), netPnl: -own(points).stake });
  assert.deepEqual([0, 150, 250, 950, 2000, 2400].map(win), [10, 10, 10, 10, 10, 5]);
  assert.deepEqual([0, 250, 950, 2000, 2400].map(loss), [-7, -10, -10, -10, -13]);
});

test('디비전별 베팅 상한: the floor my tier just opened grows from 2× to 10× its minimum', async () => {
  const { rpBetCap, rpBetCaps } = await import('../lib/rank-points.mjs');
  const { checkBetCap } = await import('../lib/stakes.mjs');
  const { monthBoundary } = await import('../lib/rank-tier.mjs');
  const [gold, high] = FLOORS;
  assert.equal(rpBetCap(50, 0), gold.maxBet, '아이언 plays the Gold Room at its full limit');
  assert.equal(rpBetCap(150, 0), gold.maxBet, '브론즈 too');
  assert.equal(rpBetCap(200, 1), high.minBet * 2, '실버 V: 2×');
  assert.equal(rpBetCap(230, 1), high.minBet * 4, '실버 IV: 4×');
  assert.equal(rpBetCap(330, 1), high.minBet * 10, '실버 I: the full 10×');
  assert.equal(rpBetCap(200, 0), gold.maxBet, 'a floor already passed keeps its limit');
  assert.equal(rpBetCap(2400, FLOORS.length - 1), FLOORS.at(-1).maxBet, '레전드: no division, no cap');
  assert.equal(rpBetCaps(200)[high.slug], high.minBet * 2);
  const u = { rp: { season: monthBoundary(Date.now()).id, points: 200 } };
  assert.throws(() => checkBetCap(u, high, high.minBet * 3), /BET_OVER_DIVISION_CAP/);
  assert.doesNotThrow(() => checkBetCap(u, high, high.minBet * 2));
  assert.doesNotThrow(() => checkBetCap(u, gold, gold.maxBet));
});

test('a minimum bet on my own new floor counts in full, even under the division cap', () => {
  const [, high] = FLOORS;
  assert.equal(rpForRound({ stake: high.minBet, netPnl: high.minBet, points: 200 }), 10, '실버 V at High Limit: 3천만 is a High Limit bet');
  assert.equal(rpForRound({ stake: FLOORS[0].minBet, netPnl: FLOORS[0].minBet, points: 200 }), 5, 'the Gold Room is below 실버: 0.5×');
  assert.equal(rpForRound({ stake: high.minBet, netPnl: high.minBet, points: 0 }), 10, '아이언 at an event on High Limit: no 1.5×');
});

test('floors below my tier lock as I climb, and open again when I am short of a buy-in', async () => {
  const { floorOpen, floorRefusal } = await import('../lib/state.mjs');
  const { monthBoundary } = await import('../lib/rank-tier.mjs');
  const [gold, high, salon] = FLOORS;
  const u = { account: { available: 50 * high.minBet, locked: 0, wallet: 0, loans: [] }, rp: { season: monthBoundary(Date.now()).id, points: 200 } };
  assert.equal(floorOpen(u, high), true, '실버 plays High Limit');
  assert.equal(floorOpen(u, gold), false, 'the Gold Room is locked');
  assert.equal(floorRefusal(u, gold), 'FLOOR_OUTGROWN');
  assert.equal(floorRefusal(u, salon), 'FLOOR_RP_LOCKED');
  u.account.available = 10 * high.minBet;
  assert.equal(floorOpen(u, gold), true, 'under 20 High Limit bets the Gold Room opens again');
});
