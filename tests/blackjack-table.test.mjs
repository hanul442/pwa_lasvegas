// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startBlackjackV2, blackjackV2Action, blackjackV2Public, settleBlackjackV2,
  perfectPairs, twentyOne3, PERFECT_PAIRS, TWENTY_ONE_3, blackjackAiRoster, aiDecision
} from '../lib/blackjack-v2.mjs';
import { basicStrategy } from '../public/js/bj-strategy.js';
import { BOT_NAMES } from '../lib/holdem-bot.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { forceHotTable } from '../lib/hot-table.mjs';

// These tests count exact payouts: keep 핫 딜러 타임 (lib/hot-table.mjs) out of them whatever the hour.
forceHotTable('off');

const c = text => ({ r: text.slice(0, -1), s: text.slice(-1) });
const cards = (...texts) => texts.map(c);

test('perfect pairs pays 6, 12 and 25 to 1 on a box\'s first two cards', () => {
  assert.deepEqual(PERFECT_PAIRS, { PERFECT: 25, COLOURED: 12, MIXED: 6 });
  assert.equal(perfectPairs(cards('8♠', '8♠')), 'PERFECT');
  assert.equal(perfectPairs(cards('8♠', '8♣')), 'COLOURED');
  assert.equal(perfectPairs(cards('Q♥', 'Q♦')), 'COLOURED');
  assert.equal(perfectPairs(cards('Q♥', 'Q♣')), 'MIXED');
  assert.equal(perfectPairs(cards('K♥', 'Q♥')), null, 'ten-value cards of different rank are not a pair');
  assert.equal(perfectPairs(cards('A♠', '2♠')), null);
});

test('21+3 pays flush 5, straight 10, trips 30, straight flush 40, suited trips 100', () => {
  assert.deepEqual(TWENTY_ONE_3, { SUITED_TRIPS: 100, STRAIGHT_FLUSH: 40, TRIPS: 30, STRAIGHT: 10, FLUSH: 5 });
  assert.equal(twentyOne3(cards('7♦', '7♦', '7♦')), 'SUITED_TRIPS');
  assert.equal(twentyOne3(cards('7♦', '7♠', '7♦')), 'TRIPS');
  assert.equal(twentyOne3(cards('9♣', '10♣', 'J♣')), 'STRAIGHT_FLUSH');
  assert.equal(twentyOne3(cards('Q♥', 'A♥', 'K♥')), 'STRAIGHT_FLUSH', 'ace plays high');
  assert.equal(twentyOne3(cards('3♠', 'A♥', '2♣')), 'STRAIGHT', 'ace plays low');
  assert.equal(twentyOne3(cards('K♠', 'A♥', '2♣')), null, 'no wrap-around straights');
  assert.equal(twentyOne3(cards('2♠', '9♠', 'K♠')), 'FLUSH');
  assert.equal(twentyOne3(cards('2♠', '9♠', 'K♥')), null);
});

test('side bets settle at the deal and count in the round stake and net', () => {
  let won = 0;
  for (let i = 0; i < 1500; i++) {
    const round = startBlackjackV2([200_000, 300_000], 2, { pairs: [100_000, 0], trips: [50_000, 300_000] });
    assert.equal(round.stake, 200_000 + 300_000 + 100_000 + 50_000 + 300_000);
    assert.equal(round.sideBets.length, 3);
    for (const bet of round.sideBets) {
      const hand = round.hands.find(h => h.spot === bet.spot).cards;
      const hit = bet.kind === 'PP' ? perfectPairs(hand) : twentyOne3([...hand, round.dealer[0]]);
      const pays = hit ? (bet.kind === 'PP' ? PERFECT_PAIRS : TWENTY_ONE_3)[hit] : 0;
      assert.equal(bet.result, hit || 'LOSS');
      assert.equal(bet.netPnl, hit ? bet.stake * pays : -bet.stake);
      if (hit) won++;
    }
    assert.ok(blackjackV2Public(round).sideBets.every(b => b.result), 'side results are public right after the deal');
    while (round.status === 'INSURANCE' || round.status === 'PLAYER') {
      blackjackV2Action(round, round.status === 'INSURANCE' ? 'NO_INSURANCE' : 'STAND', round.activeHand);
    }
    const out = settleBlackjackV2(round);
    const handNet = round.hands.reduce((a, h) => a + h.result.netPnl, 0);
    const sideNet = round.sideBets.reduce((a, b) => a + b.netPnl, 0);
    assert.equal(out.netPnl, handNet + sideNet);
    assert.equal(out.outcomes.filter(o => /^(PP|T3)_/.test(o.result)).length, 3);
  }
  assert.ok(won > 0, 'some side bet should hit in 1500 rounds');
});

test('side bets cannot exceed the box stake or sit on a missing box', () => {
  assert.throws(() => startBlackjackV2([100_000], 1, { pairs: [100_001] }), /INVALID_SIDE_BET/);
  assert.throws(() => startBlackjackV2([100_000], 1, { trips: [0, 50_000] }), /INVALID_SIDE_BET/);
  assert.throws(() => startBlackjackV2([100_000], 1, { trips: [-5] }), /INVALID_SIDE_BET/);
});

test('AI seats are dealt from the shoe, play after the player and never touch the net', () => {
  const roster = blackjackAiRoster([]);
  assert.ok(roster.length >= 1 && roster.length <= 3);
  assert.ok(roster.every(p => BOT_NAMES.includes(p.name)));
  assert.equal(new Set(roster.map(p => p.name)).size, roster.length);
  for (let i = 0; i < 300; i++) {
    const round = startBlackjackV2([100_000], 1, { ai: roster });
    assert.equal(round.ai.length, roster.length);
    assert.equal(round.deck.length, 312 - 2 - 2 * (1 + roster.length));
    const open = blackjackV2Public(round);
    assert.ok(open.ai.every(a => a.cards.length === 2 && a.log.length === 0 && !a.result));
    while (round.status === 'INSURANCE' || round.status === 'PLAYER') {
      blackjackV2Action(round, round.status === 'INSURANCE' ? 'NO_INSURANCE' : 'STAND', round.activeHand);
    }
    const out = settleBlackjackV2(round);
    assert.equal(out.netPnl, round.hands[0].result.netPnl);
    const view = out.public;
    for (const seat of view.ai) {
      assert.ok(seat.result && typeof seat.result.netPnl === 'number');
      assert.equal(seat.cards.length, 2 + seat.log.filter(x => x.card).length);
    }
  }
});

test('the dealer still draws when only an AI hand is alive', () => {
  const round = startBlackjackV2([100_000], 1, { ai: [{ name: 'NOVA', temper: 'steady', unit: 1 }] });
  round.insurance = null;
  round.dealer = cards('10♠', '6♥');
  round.hands[0].cards = cards('K♠', 'Q♠', '5♦');
  round.hands[0].status = 'BUST';
  round.ai[0].cards = cards('10♦', '8♣');
  round.ai[0].status = 'PLAYING';
  round.status = 'READY_TO_SETTLE';
  settleBlackjackV2(round);
  assert.ok(round.dealer.length > 2);
  assert.deepEqual(round.ai[0].log, [{ action: 'STAND', total: 18 }]);

  const alone = startBlackjackV2([100_000], 1);
  alone.insurance = null;
  alone.dealer = cards('10♠', '6♥');
  alone.hands[0].cards = cards('K♠', 'Q♠', '5♦');
  alone.hands[0].status = 'BUST';
  alone.status = 'READY_TO_SETTLE';
  settleBlackjackV2(alone);
  assert.equal(alone.dealer.length, 2);
});

test('AI temperaments bend basic strategy a little', () => {
  const seat = (temper, ...texts) => ({ temper, cards: cards(...texts) });
  assert.equal(aiDecision(seat('cautious', '10♠', '2♥'), c('10♦')), 'STAND');
  assert.equal(aiDecision(seat('steady', '10♠', '2♥'), c('10♦')), 'HIT');
  assert.equal(aiDecision(seat('reckless', 'A♠', '7♥'), c('5♦'), () => 0.1), 'HIT');
  assert.equal(aiDecision(seat('steady', 'A♠', '7♥'), c('2♦')), 'STAND');
});

test('basic strategy: six decks, dealer stands on soft 17, double after split', () => {
  const bs = (hand, up, opts) => basicStrategy(hand.split(' '), up, opts);
  assert.equal(bs('10♠ 6♥', '7♦'), 'HIT');
  assert.equal(bs('10♠ 6♥', '6♦'), 'STAND');
  assert.equal(bs('10♠ 2♥', '3♦'), 'HIT');
  assert.equal(bs('10♠ 2♥', '4♦'), 'STAND');
  assert.equal(bs('6♠ 5♥', 'A♦'), 'HIT', '11 vs ace hits when the dealer stands on soft 17');
  assert.equal(bs('6♠ 5♥', '10♦'), 'DOUBLE');
  assert.equal(bs('5♠ 4♥', '2♦'), 'HIT');
  assert.equal(bs('5♠ 4♥', '3♦'), 'DOUBLE');
  assert.equal(bs('A♠ 7♥', '2♦'), 'STAND');
  assert.equal(bs('A♠ 7♥', '6♦'), 'DOUBLE');
  assert.equal(bs('A♠ 7♥', '9♦'), 'HIT');
  assert.equal(bs('A♠ 7♥', '6♦', { canDouble: false }), 'STAND');
  assert.equal(bs('A♠ 2♥', '5♦'), 'DOUBLE');
  assert.equal(bs('A♠ 2♥ 2♣', '5♦'), 'HIT');
  assert.equal(bs('8♠ 8♥', 'A♦'), 'SPLIT');
  assert.equal(bs('A♠ A♥', '10♦'), 'SPLIT');
  assert.equal(bs('A♠ A♥', '6♦', { canSplit: false }), 'HIT');
  assert.equal(bs('K♠ Q♥', '6♦'), 'STAND');
  assert.equal(bs('9♠ 9♥', '7♦'), 'STAND');
  assert.equal(bs('9♠ 9♥', '8♦'), 'SPLIT');
  assert.equal(bs('5♠ 5♥', '9♦'), 'DOUBLE');
  assert.equal(bs('4♠ 4♥', '5♦'), 'SPLIT');
  assert.equal(bs('2♠ 2♥', '8♦'), 'HIT');
  assert.equal(bs('10♠ 6♥', 'A♦'), 'HIT', 'no surrender: hard 16 vs ace hits');
});

function memoryStore() {
  let state = defaultState();
  // Mid-way through High Limit (1억–10억 net worth), so a few wins don't graduate the floor.
  state.users.hanseo.account.available = 300_000_000;
  return {
    load: async () => structuredClone(state),
    mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; }
  };
}
const call = (store, method, path, body, headers = {}) =>
  handleApi({ method, header: n => headers[n], body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('blackjack start route locks side bets with the round and keeps the AI players', async () => {
  const store = memoryStore();
  const before = (await call(store, 'GET', '/api/state')).data.user.account.available;
  const tooBig = await call(store, 'POST', '/api/blackjack/v2/start', { stakes: [10_000_000], pairs: [20_000_000], floor: 'high-limit' }, { 'x-idempotency-key': 'bj-side-big-0001' });
  assert.equal(tooBig.status, 400);
  let names = null, total = 0, stayed = 0;
  for (let n = 0; n < 8; n++) {
    const body = { stakes: [10_000_000], pairs: [3_000_000], trips: [5_000_000], floor: 'high-limit' };
    const res = await call(store, 'POST', '/api/blackjack/v2/start', body, { 'x-idempotency-key': `bj-side-start-${n}000` });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    let round = res.data.round;
    assert.equal(round.stake, 18_000_000);
    assert.equal(round.sideBets.length, 2);
    assert.ok(round.ai.length >= 1 && round.ai.length <= 3);
    if (names && round.ai.some(a => names.includes(a.name))) stayed++;
    names = round.ai.map(a => a.name);
    const replay = await call(store, 'POST', '/api/blackjack/v2/start', body, { 'x-idempotency-key': `bj-side-start-${n}000` });
    assert.equal(replay.data.replayed, true);
    const conflict = await call(store, 'POST', '/api/blackjack/v2/start', { ...body, pairs: [5_000_000] }, { 'x-idempotency-key': `bj-side-start-${n}000` });
    assert.equal(conflict.data.error, 'IDEMPOTENCY_CONFLICT', 'a different side bet under the same key is refused');
    let k = 0;
    while (round.status !== 'SETTLED') {
      const action = round.status === 'INSURANCE' ? 'NO_INSURANCE' : 'STAND';
      const step = await call(store, 'POST', '/api/blackjack/v2/action', { roundId: round.id, action, handIndex: round.activeHand }, { 'x-idempotency-key': `bj-side-step-${n}-${k++}000` });
      assert.equal(step.status, 200, JSON.stringify(step.data));
      round = step.data.round;
    }
    assert.ok(round.ai.every(a => a.result));
    total += round.netPnl;
  }
  assert.ok(stayed >= 3, 'most rounds keep someone from the last round');
  const after = (await call(store, 'GET', '/api/state')).data.user.account;
  assert.equal(after.locked, 0);
  assert.equal(after.available, before + total);
});
