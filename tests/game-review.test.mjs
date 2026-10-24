// 2026-10-24 full game review: rule and money fixes, one test each.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../lib/holdem.mjs';
import { startMatgo, matgoAct } from '../lib/matgo.mjs';
import { dealerHitsSoft17 } from '../lib/blackjack-v2.mjs';
import { playSicBo, SICBO_TOTAL_PAY, SICBO_ANY_TRIPLE } from '../lib/games.mjs';
import { spinSlots, STRIP } from '../lib/slots.mjs';
import { defaultState } from '../lib/state.mjs';

const sum = t => t.seats.reduce((a, s) => a + s.stack, 0);
const table = stacks => H.createTable({ seats: stacks.map((stack, i) => ({ id: 'p' + i, name: 'p' + i, kind: 'human', stack })), smallBlind: 1, bigBlind: 2, button: 2 });

test("hold'em: chips a folded top contributor left behind join the pot below, never vanish", () => {
  const t = table([1000, 100, 200]);
  const before = sum(t); H.startHand(t);
  H.applyAction(t, 2, { type: 'CALL' }); H.applyAction(t, 0, { type: 'RAISE', amount: 300 }); H.applyAction(t, 1, { type: 'ALL_IN' });
  H.foldOut(t, 0); H.applyAction(t, 2, { type: 'CALL' });
  assert.equal(sum(t), before);
  assert.ok(H.buildPots(t.hand.players).every(p => p.eligible.length > 0));
});

test("hold'em: a short all-in doesn't reopen the betting to someone who already acted", () => {
  const t = H.createTable({ seats: ['a', 'b', 'c'].map(id => ({ id, name: id, kind: 'human', stack: 1000 })), smallBlind: 1, bigBlind: 2, button: 0 });
  H.startHand(t); const h = t.hand;
  H.applyAction(t, h.toAct, { type: 'CALL' }); H.applyAction(t, h.toAct, { type: 'CALL' }); H.applyAction(t, h.toAct, { type: 'CHECK' });
  t.seats[2].stack = 12;
  const bettor = h.toAct;
  H.applyAction(t, bettor, { type: 'RAISE', amount: 10 });
  H.applyAction(t, h.toAct, { type: 'ALL_IN' });
  H.applyAction(t, h.toAct, { type: 'CALL' });
  assert.equal(h.toAct, bettor);
  const legal = H.legalActions(t, bettor);
  assert.equal(legal.canRaise, false);
  assert.equal(legal.canCall, true);
});

test("hold'em: a player who takes a chair between hands doesn't see the last hand's hole cards", () => {
  const t = table([100, 100, 100]);
  H.startHand(t);
  while (!t.hand.over) H.applyAction(t, t.hand.toAct, { type: 'FOLD' });
  t.seats[0] = { id: 'newcomer', name: 'new', kind: 'human', stack: 100 };
  const view = H.publicTable(t, 0);
  assert.ok(view.seats[0].cards.every(c => c === 'HIDDEN'));
});

test('blackjack: the floor decides soft 17, not the size of the bet', () => {
  assert.equal(dealerHitsSoft17(1_000_000_000, 'salon-prive'), false, 'a 10억 max bet at Salon Privé still stands');
  assert.equal(dealerHitsSoft17(1_000_000_000, 'penthouse'), true);
  assert.equal(dealerHitsSoft17(1_000_000_000), true, 'no floor: the stake decides as before');
});

test('맞고: the winner\'s 국진 reads the way that pays more once 피박 is counted', () => {
  const winner = ['01-3', '01-4', '02-3', '02-4', '03-3', '03-4', '04-3', '04-4', '09-1', '02-1', '05-1', '06-1', '07-1', '01-2', '02-2', '03-2', '10-1'];
  const r = startMatgo({ stake: 1, first: 0 });
  r.captured = [winner, ['05-3']];
  r.hands = [['11-1'], []];
  r.status = 'PLAYING'; r.phase = 'GO_STOP'; r.pending = { seat: 0, score: 7 };
  matgoAct(r, 0, { type: 'STOP' });
  assert.equal(r.result.points, 10);
  assert.ok(r.result.multipliers.some(m => m.label === '피박'));
});

test('sic bo pays the usual Macau table, and no total returns more than it takes', () => {
  assert.equal(SICBO_TOTAL_PAY[5], 30);
  assert.equal(SICBO_ANY_TRIPLE, 30);
  const ways = {}; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) ways[a + b + c] = (ways[a + b + c] || 0) + 1;
  for (const [n, pay] of Object.entries(SICBO_TOTAL_PAY)) assert.ok(ways[n] / 216 * (pay + 1) < 0.95, `total ${n}`);
  assert.ok(6 / 216 * (SICBO_ANY_TRIPLE + 1) < 0.9);
  const r = playSicBo(1_000_000, 'ANY_TRIPLE'); assert.equal(r.netPnl, r.triple ? 30_000_000 : -1_000_000);
});

test("slots: each floor's pot is its own", () => {
  const state = defaultState();
  const lose = [STRIP.indexOf('C'), STRIP.indexOf('C'), STRIP.indexOf('H')];
  spinSlots(state, { stake: 1_000_000_000_000, maxBet: 9_999_999_999_999, stopsOverride: lose });
  assert.equal(state.jackpot.floors[9_999_999], undefined);
  spinSlots(state, { stake: 1_000_000, maxBet: 9_999_999, stopsOverride: lose });
  assert.equal(state.jackpot.floors[9_999_999].pool, 5_000_000_000 + 5_000);
});
