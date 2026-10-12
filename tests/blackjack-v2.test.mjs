import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startBlackjackV2,
  blackjackV2Action,
  blackjackV2ActionCost,
  blackjackV2Public,
  settleBlackjackV2
} from '../lib/blackjack-v2.mjs';
import { defaultState } from '../lib/store.mjs';
import { lockBet, increaseBetLock, settleLockedHouseGame } from '../lib/economy.mjs';

test('blackjack v2 opens up to three simultaneous betting spots', () => {
  const round = startBlackjackV2(1_000_000, 3);
  assert.equal(round.spots, 3);
  assert.equal(round.hands.length, 3);
  assert.equal(round.stake, 3_000_000);
  assert.deepEqual(round.hands.map(h => h.spot), [1, 2, 3]);
  assert.ok(round.hands.every(h => h.cards.length === 2));
});

test('blackjack v2 split creates another hand on the same spot and increases locked risk once', () => {
  let round = null;
  for (let i = 0; i < 500; i++) {
    const candidate = startBlackjackV2(1_000_000, 1);
    const hand = candidate.hands[0];
    if (candidate.status === 'PLAYER' && hand.cards[0].r === hand.cards[1].r) { round = candidate; break; }
  }
  assert.ok(round, 'could not produce a splittable random hand');
  assert.equal(blackjackV2ActionCost(round, 'SPLIT', 0), 1_000_000);
  blackjackV2Action(round, 'SPLIT', 0);
  assert.equal(round.hands.length, 2);
  assert.equal(round.hands[0].spot, 1);
  assert.equal(round.hands[1].spot, 1);
  assert.equal(round.stake, 2_000_000);
  assert.ok(round.hands.every(h => h.cards.length === 2));
});

test('blackjack v2 splits any two ten-value cards but not unequal values', () => {
  const pairOf = (a, b) => {
    for (let i = 0; i < 500; i++) {
      const round = startBlackjackV2(1_000_000, 1);
      if (round.status !== 'PLAYER') continue;
      round.hands[0].cards = [{ r: a, s: '♠' }, { r: b, s: '♥' }];
      return round;
    }
    throw new Error('no playable round');
  };
  const faces = pairOf('K', 'Q');
  assert.equal(blackjackV2Public(faces).hands[0].canSplit, true);
  blackjackV2Action(faces, 'SPLIT', 0);
  assert.equal(faces.hands.length, 2);
  assert.equal(blackjackV2Public(pairOf('10', 'J')).hands[0].canSplit, true);
  const mixed = pairOf('9', '10');
  assert.equal(blackjackV2Public(mixed).hands[0].canSplit, false);
  assert.throws(() => blackjackV2Action(mixed, 'SPLIT', 0), /SPLIT_NOT_ALLOWED/);
});

test('blackjack v2 split lock and settlement conserve bankroll plus net PnL', () => {
  const state = defaultState();
  const user = state.users.hanseo;
  const opening = user.account.available;
  let round = null;

  for (let i = 0; i < 500; i++) {
    const candidate = startBlackjackV2(1_000_000, 1);
    const hand = candidate.hands[0];
    if (candidate.status === 'PLAYER' && hand.cards[0].r === hand.cards[1].r) { round = candidate; break; }
  }
  assert.ok(round, 'could not produce a splittable random hand');

  lockBet(state, user, { stake: round.stake, game: 'Blackjack', roundId: round.id });
  const extra = blackjackV2ActionCost(round, 'SPLIT', 0);
  increaseBetLock(state, user, { stake: extra, game: 'Blackjack', roundId: round.id });
  blackjackV2Action(round, 'SPLIT', 0);
  assert.equal(user.account.locked, round.stake);

  while (round.status === 'PLAYER') blackjackV2Action(round, 'STAND', round.activeHand);
  const out = settleBlackjackV2(round);
  settleLockedHouseGame(state, user, {
    game: 'Blackjack', stake: out.totalStake, netPnl: out.netPnl, roundId: round.id,
    details: { engineVersion: round.engineVersion, outcomes: out.outcomes }
  });

  assert.equal(user.account.locked, 0);
  assert.equal(user.account.available, opening + out.netPnl);
  assert.equal(user.account.totalWagered, out.totalStake);
});

test('blackjack v2 settlement reveals every dealer draw and explains each hand independently', () => {
  const round = {
    id: 'bj2_test', game: 'Blackjack', engineVersion: 'MULTI_SPOT_V2', baseStake: 1_000_000,
    stake: 2_000_000, spots: 2,
    dealer: [{ r: '2', s: '♦' }, { r: '5', s: '♠' }],
    deck: [{ r: 'K', s: '♣' }, { r: '3', s: '♥' }],
    hands: [
      { id: 'h1', spot: 1, cards: [{ r: '10', s: '♠' }, { r: '9', s: '♣' }], stake: 1_000_000, doubled: false, fromSplit: false, status: 'STAND', result: null },
      { id: 'h2', spot: 2, cards: [{ r: '10', s: '♦' }, { r: '7', s: '♣' }], stake: 1_000_000, doubled: false, fromSplit: false, status: 'STAND', result: null }
    ],
    activeHand: -1, status: 'READY_TO_SETTLE', createdAt: new Date().toISOString()
  };

  const out = settleBlackjackV2(round);
  assert.deepEqual(out.public.dealer, ['2♦', '5♠', '3♥', 'K♣']);
  assert.equal(out.public.dealerValue, 20);
  assert.equal(out.outcomes[0].result, 'LOSS');
  assert.equal(out.outcomes[1].result, 'LOSS');
  assert.equal(out.netPnl, -2_000_000);
  assert.deepEqual(blackjackV2Public(round, true).dealer, ['2♦', '5♠', '3♥', 'K♣']);
});

test('blackjack v2 rejects more than three initial spots', () => {
  assert.throws(() => startBlackjackV2(1_000_000, 4), { message: 'INVALID_SPOTS' });
});

function aceUpRound(stakes, hole) {
  for (let i = 0; i < 2000; i++) {
    const round = startBlackjackV2(stakes);
    if (round.status !== 'INSURANCE') continue;
    round.dealer[1] = hole;
    round.hands.forEach(h => { h.cards = [{ r: '10', s: '♠' }, { r: '7', s: '♣' }]; h.status = 'PLAYING'; });
    return round;
  }
  throw new Error('no ace-up round');
}

test('blackjack v2 takes a different stake on each betting box', () => {
  const round = startBlackjackV2([200_000, 500_000, 1_000_000]);
  assert.deepEqual(round.hands.map(h => h.stake), [200_000, 500_000, 1_000_000]);
  assert.equal(round.stake, 1_700_000);
  assert.throws(() => startBlackjackV2([1, 2, 3, 4]), { message: 'INVALID_SPOTS' });
  assert.throws(() => startBlackjackV2([100, 0]), { message: 'INVALID_STAKE' });
});

test('blackjack v2 asks for insurance first when the dealer shows an ace', () => {
  const round = aceUpRound([4_000_000, 6_000_000], { r: 'K', s: '♦' });
  assert.equal(blackjackV2Public(round).insurance.cost, 5_000_000);
  assert.equal(blackjackV2Public(round).dealer[1], 'HIDDEN');
  assert.throws(() => blackjackV2ActionCost(round, 'HIT', 0), { message: 'INSURANCE_DECISION_REQUIRED' });
  assert.equal(blackjackV2ActionCost(round, 'INSURANCE'), 5_000_000);
  // Every amount moves in 100만s: half of 300만 rounds up to 200만.
  assert.equal(blackjackV2ActionCost(aceUpRound([3_000_000], { r: 'K', s: '♦' }), 'INSURANCE'), 2_000_000);
});

test('blackjack v2 insurance pays 2:1 against a dealer blackjack and conserves the bankroll', () => {
  const state = defaultState();
  const user = state.users.hanseo;
  const opening = user.account.available;
  const round = aceUpRound([2_000_000], { r: 'K', s: '♦' });
  lockBet(state, user, { stake: round.stake, game: 'Blackjack', roundId: round.id });
  const cost = blackjackV2ActionCost(round, 'INSURANCE');
  increaseBetLock(state, user, { stake: cost, game: 'Blackjack', roundId: round.id });
  blackjackV2Action(round, 'INSURANCE');
  assert.equal(round.status, 'READY_TO_SETTLE');
  assert.equal(user.account.locked, round.stake);
  const out = settleBlackjackV2(round);
  // Hand loses 2,000,000; insurance wins 2 × 1,000,000: the player breaks even.
  assert.equal(out.netPnl, 0);
  assert.equal(out.outcomes.at(-1).result, 'INSURANCE_WIN');
  settleLockedHouseGame(state, user, { game: 'Blackjack', stake: out.totalStake, netPnl: out.netPnl, roundId: round.id, details: {} });
  assert.equal(user.account.locked, 0);
  assert.equal(user.account.available, opening);
});

test('blackjack v2 insurance is lost when the dealer has no blackjack, and play continues', () => {
  const round = aceUpRound([2_000_000], { r: '6', s: '♦' });
  blackjackV2Action(round, 'INSURANCE');
  assert.equal(round.status, 'PLAYER');
  assert.equal(round.insurance.netPnl, -1_000_000);
  blackjackV2Action(round, 'STAND', 0);
  const out = settleBlackjackV2(round);
  assert.equal(out.outcomes.at(-1).result, 'INSURANCE_LOSS');
  assert.equal(out.totalStake, 3_000_000);
});

test('blackjack v2 declining insurance costs nothing and still peeks', () => {
  const round = aceUpRound([1_000_000], { r: 'Q', s: '♦' });
  assert.equal(blackjackV2ActionCost(round, 'NO_INSURANCE'), 0);
  blackjackV2Action(round, 'NO_INSURANCE');
  assert.equal(round.status, 'READY_TO_SETTLE');
  const out = settleBlackjackV2(round);
  assert.equal(out.netPnl, -1_000_000);
  assert.ok(!out.outcomes.some(o => o.result.startsWith('INSURANCE')));
  assert.throws(() => blackjackV2ActionCost(round, 'INSURANCE'), { message: 'INSURANCE_NOT_OFFERED' });
});
