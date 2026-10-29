import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { addLedger, lockBet, settleLockedHouseGame } from '../lib/economy.mjs';
import { rpForRound, noteRp, rpView, rpStandings, rpTierFor, RP_DAY_CAP, RP_ROUND_CAP } from '../lib/rank-points.mjs';
import { handleApi } from '../lib/api.mjs';

const 억 = 100_000_000;
const NOV = Date.parse('2026-11-10T03:00:00Z');

test('RP follows the result against the bet, not the size of the bet', () => {
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 1_000_000 }), 10, 'win your bet back: +10');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: -1_000_000 }), -7.5, 'lose it: −7.5');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 1_500_000 }), 15, 'blackjack 3:2');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 0 }), 0, 'a push moves nothing');
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 35_000_000 }), RP_ROUND_CAP, 'a straight-up hit is capped');
  // The same even-money win on a higher floor than the player's tier counts 1.5×, a lower one 0.5×.
  assert.equal(rpForRound({ stake: 10_000_000, netPnl: 10_000_000, points: 0 }), 15);
  assert.equal(rpForRound({ stake: 1_000_000, netPnl: 1_000_000, points: 450 }), 5);
});

test('a day of gains stops at the cap, points never go below 0, and a new month starts from 0', () => {
  const u = { rp: null };
  assert.equal(noteRp(u, { stake: 1e6, netPnl: -1e6 }, NOV), 0, 'nothing to lose yet');
  for (let i = 0; i < 40; i++) noteRp(u, { stake: 1e6, netPnl: 30e6 }, NOV);
  assert.equal(rpView(u, NOV).today, RP_DAY_CAP);
  assert.equal(rpView(u, NOV).points, RP_DAY_CAP);
  assert.equal(rpView(u, NOV).tier, rpTierFor(RP_DAY_CAP).id);
  noteRp(u, { stake: 1e6, netPnl: 30e6 }, NOV + 86_400_000);
  assert.equal(rpView(u, NOV + 86_400_000).today, RP_ROUND_CAP, 'next day: a fresh cap');
  assert.equal(rpForRound({ stake: 1e6, netPnl: 1e6, points: 300 }), 5, 'the Gold Room is below a gold-tier player: 0.5×');
  const DEC = Date.parse('2026-12-02T03:00:00Z');
  assert.equal(rpView(u, DEC).points, 0);
  noteRp(u, { stake: 1e6, netPnl: 1e6 }, DEC);
  assert.equal(u.rp.prev.season, 'rank-2026-11');
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
  assert.equal(s.rp.toNext, 90);
  assert.equal(s.rankings.rp.find(r => r.id === 'hanseo').value, 10);
});
