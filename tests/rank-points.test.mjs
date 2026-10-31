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
  assert.equal(rpForRound({ game: 'Roulette', stake: 1_000_000, netPnl: 35_000_000 }), 30, 'a straight-up hit counts 3× its bet (배당 상한, roulette and slots)');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 35_000_000 }), 350, 'other games: no cap');
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
  assert.equal(rpView(u, NOV).points, 199, 'no cap on a round, but RP stops at the top of 아이언 I: the next tier takes a 승급전');
  noteRp(u, { stake: 1e6, netPnl: 30e6 }, NOV);
  assert.equal(rpView(u, NOV).today, 199, 'nothing kept past the top');
  assert.equal(rpView(u, NOV).tier, 'iron');
  u.rp.points = 650; // as if two 승급전 were won
  noteRp(u, { stake: 1e6, netPnl: 1e6 }, NOV + 86_400_000);
  assert.equal(rpView(u, NOV + 86_400_000).today, 5, 'next day counts from 0');
  assert.equal(rpForRound({ stake: 1e6, netPnl: 1e6, points: 650 }), 5, 'the Gold Room is below a silver player: 0.5×');
  const DEC = Date.parse('2026-12-02T03:00:00Z');
  assert.equal(rpView(u, DEC).points, 0, '실버 655 → 아이언 0');
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
  assert.equal(s.rp.toNext, 30, 'to 아이언 IV');
  assert.equal(s.rp.nextDivision, 'IV');
  assert.equal(s.rankings.rp.find(r => r.id === 'hanseo').value, 10);
});

test('tiers widen as they climb and split into five divisions; 레전드 has none', async () => {
  const { rpDivision, rpNextStep, rpTierFor, RP_TIER_STARTS } = await import('../lib/rank-points.mjs');
  assert.deepEqual(RP_TIER_STARTS, [0, 200, 450, 750, 1100, 1500, 2000, 2600, 3300, 5000]);
  assert.deepEqual([0, 199, 200, 749, 750, 4999, 5000].map(p => rpTierFor(p).id), ['iron', 'iron', 'bronze', 'silver', 'gold', 'grandmaster', 'legend']);
  assert.deepEqual([0, 39, 40, 80, 120, 160, 199, 200, 249, 250, 4999, 5000, 9000].map(rpDivision), ['V', 'V', 'IV', 'III', 'II', 'I', 'I', 'V', 'V', 'IV', 'I', null, null]);
  assert.deepEqual(rpNextStep(120).next, { id: 'iron', division: 'I', need: 40 });
  assert.deepEqual(rpNextStep(160).next, { id: 'bronze', division: 'V', need: 0, promo: true }, 'from I only the 승급전 goes on');
  assert.deepEqual(rpNextStep(4900).next, { id: 'legend', division: null, need: 0, promo: true });
  assert.equal(rpNextStep(5100).next, null);
});

import { FLOORS } from '../lib/constants.mjs';
import { rpFloorLevel } from '../lib/rank-points.mjs';

test('실버 to 그랜드마스터 is 50:50; 레전드 wins less and loses more on the same bet', () => {
  // Bets on the player's own floor, so only the tier scale moves the numbers.
  const own = points => ({ stake: FLOORS[Math.min(FLOORS.length - 1, rpFloorLevel(points))].maxBet, points });
  const win = points => rpForRound({ ...own(points), netPnl: own(points).stake });
  const loss = points => rpForRound({ ...own(points), netPnl: -own(points).stake });
  assert.deepEqual([0, 325, 550, 2100, 4363, 5213].map(win), [10, 10, 10, 10, 10, 5]);
  assert.deepEqual([0, 550, 2100, 4363, 5213].map(loss), [-7, -10, -10, -10, -13]);
});

test('디비전별 베팅 상한: the floor my tier just opened grows from the floor below’s top bet to its own, never lower than before', async () => {
  const { rpBetCap, rpBetCaps } = await import('../lib/rank-points.mjs');
  const { checkBetCap } = await import('../lib/stakes.mjs');
  const { monthBoundary } = await import('../lib/rank-tier.mjs');
  const [gold, high] = FLOORS;
  assert.equal(rpBetCap(100, 0), gold.maxBet, '아이언 plays the Gold Room at its full limit');
  assert.equal(rpBetCap(325, 0), gold.maxBet, '브론즈 too');
  assert.equal(rpBetCap(450, 1), high.minBet * 4, '실버 V: 4× (1.2억, 400칩), above the Gold Room top (1억)');
  assert.ok(rpBetCap(450, 1) >= gold.maxBet);
  assert.equal(rpBetCap(510, 1), high.minBet * 5, '실버 IV: 5× (500칩)');
  assert.equal(rpBetCap(710, 1), high.minBet * 10, '실버 I: the full 10×');
  assert.equal(rpBetCap(450, 0), gold.maxBet, 'a floor already passed keeps its limit');
  assert.equal(rpBetCap(5213, FLOORS.length - 1), FLOORS.at(-1).maxBet, '레전드: no division, no cap');
  assert.equal(rpBetCaps(450)[high.slug], high.minBet * 4);
  const u = { rp: { season: monthBoundary(Date.now()).id, points: 450 } };
  assert.throws(() => checkBetCap(u, high, high.minBet * 4 + 1_000_000), /BET_OVER_DIVISION_CAP/);
  assert.doesNotThrow(() => checkBetCap(u, high, high.minBet * 4));
  assert.doesNotThrow(() => checkBetCap(u, gold, gold.maxBet));
});

test('a minimum bet on my own new floor counts in full, even under the division cap', () => {
  const [, high] = FLOORS;
  assert.equal(rpForRound({ stake: high.minBet, netPnl: high.minBet, points: 450 }), 10, '실버 V at High Limit: 3천만 is a High Limit bet');
  assert.equal(rpForRound({ stake: FLOORS[0].minBet, netPnl: FLOORS[0].minBet, points: 450 }), 5, 'the Gold Room is below 실버: 0.5×');
  assert.equal(rpForRound({ stake: high.minBet, netPnl: high.minBet, points: 0 }), 10, '아이언 at an event on High Limit: no 1.5×');
});

test('floors below my tier lock as I climb, and open again when I am short of a buy-in', async () => {
  const { floorOpen, floorRefusal } = await import('../lib/state.mjs');
  const { monthBoundary } = await import('../lib/rank-tier.mjs');
  const [gold, high, salon] = FLOORS;
  const u = { account: { available: 50 * high.minBet, locked: 0, wallet: 0, loans: [] }, rp: { season: monthBoundary(Date.now()).id, points: 450 } };
  assert.equal(floorOpen(u, high), true, '실버 plays High Limit');
  assert.equal(floorOpen(u, gold), false, 'the Gold Room is locked');
  assert.equal(floorRefusal(u, gold), 'FLOOR_OUTGROWN');
  assert.equal(floorRefusal(u, salon), 'FLOOR_RP_LOCKED');
  u.account.available = 10 * high.minBet;
  assert.equal(floorOpen(u, gold), true, 'under 20 High Limit bets the Gold Room opens again');
});

test('going up a tier never lowers the most I may bet', async () => {
  const { rpBetCaps, RP_TIER_STARTS: S } = await import('../lib/rank-points.mjs');
  let best = 0;
  for (let p = 0; p < S.at(-1) + 50; p += 5) {
    const top = Math.max(...Object.entries(rpBetCaps(p)).filter(([slug]) => FLOORS.findIndex(f => f.slug === slug) <= rpFloorLevel(p)).map(([, v]) => v));
    assert.ok(top >= best, `RP ${p}: ${top} < ${best}`);
    best = top;
  }
});
