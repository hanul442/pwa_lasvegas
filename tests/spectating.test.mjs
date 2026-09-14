import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/store.mjs';
import { buildSpectatingSnapshot } from '../lib/spectating.mjs';

function activeBlackjackRound() {
  return {
    id: 'bj_watch',
    game: 'Blackjack',
    userId: 'zero',
    floor: 'high-limit',
    stake: 25_000_000,
    status: 'PLAYER',
    player: [{ r: 'A', s: '♠' }, { r: 'K', s: '♦' }],
    dealer: [{ r: '9', s: '♣' }, { r: 'Q', s: '♥' }],
    deck: [{ r: '2', s: '♠' }, { r: '3', s: '♠' }],
    doubled: false,
    createdAt: '2026-09-14T00:00:00.000Z'
  };
}

function activeMultiSpotRound() {
  return {
    id: 'bj2_watch',
    game: 'Blackjack',
    engineVersion: 'MULTI_SPOT_V2',
    userId: 'zero',
    floor: 'strip',
    stake: 2_000_000,
    status: 'PLAYER',
    hands: [
      { spot: 1, cards: [{ r: '8', s: '♠' }, { r: '8', s: '♦' }], doubled: false, fromSplit: false },
      { spot: 2, cards: [{ r: 'K', s: '♣' }, { r: '7', s: '♥' }], doubled: false, fromSplit: false }
    ],
    dealer: [{ r: '6', s: '♣' }, { r: 'Q', s: '♥' }],
    deck: [{ r: '2', s: '♠' }],
    createdAt: '2026-09-14T00:00:00.000Z'
  };
}

test('spectating exposes only public active blackjack state and never dealer hole card or deck', () => {
  const state = defaultState();
  state.rounds.push(activeBlackjackRound());
  const before = structuredClone(state);

  const snapshot = buildSpectatingSnapshot(state, 'hanseo');

  assert.equal(snapshot.mode, 'READ_ONLY');
  assert.equal(snapshot.tables.length, 1);
  assert.equal(snapshot.tables[0].participant.id, 'zero');
  assert.equal(snapshot.tables[0].floor, 'high-limit');
  assert.deepEqual(snapshot.tables[0].gameState.playerCards, ['A♠', 'K♦']);
  assert.deepEqual(snapshot.tables[0].gameState.dealerCards, ['9♣', 'HIDDEN']);
  assert.equal(JSON.stringify(snapshot).includes('Q♥'), false);
  assert.equal(JSON.stringify(snapshot).includes('2♠'), false);
  assert.equal('stake' in snapshot.tables[0], false);
  assert.equal(snapshot.capabilities.interaction, false);
  assert.equal(snapshot.capabilities.sideBets, false);
  assert.equal(snapshot.capabilities.chipTransfer, false);
  assert.equal(snapshot.capabilities.hiddenCardsExposed, false);
  assert.deepEqual(state, before);
});

test('spectating supports multi-spot blackjack without exposing stake, deck, or dealer hole card', () => {
  const state = defaultState();
  state.rounds.push(activeMultiSpotRound());
  const snapshot = buildSpectatingSnapshot(state, 'hanseo');

  assert.equal(snapshot.tables.length, 1);
  assert.equal(snapshot.tables[0].gameState.multiSpot, true);
  assert.equal(snapshot.tables[0].gameState.hands.length, 2);
  assert.deepEqual(snapshot.tables[0].gameState.hands[0].cards, ['8♠', '8♦']);
  assert.deepEqual(snapshot.tables[0].gameState.dealerCards, ['6♣', 'HIDDEN']);
  assert.equal(JSON.stringify(snapshot).includes('Q♥'), false);
  assert.equal(JSON.stringify(snapshot).includes('2♠'), false);
  assert.equal(JSON.stringify(snapshot).includes('2000000'), false);
});

test('spectating excludes settled, malformed, unknown-user and unsupported rounds', () => {
  const state = defaultState();
  const settled = activeBlackjackRound();
  settled.id = 'settled';
  settled.status = 'SETTLED';
  const ghost = activeBlackjackRound();
  ghost.id = 'ghost';
  ghost.userId = 'ghost';
  const malformed = activeBlackjackRound();
  malformed.id = 'bad';
  malformed.dealer = [];
  const unsupported = { id: 'roulette_live', game: 'Roulette', userId: 'zero', status: 'PLAYER', floor: 'strip' };
  state.rounds.push(settled, ghost, malformed, unsupported);

  const snapshot = buildSpectatingSnapshot(state, 'hanseo');
  assert.deepEqual(snapshot.tables, []);
});

test('spectating fails closed for unknown viewers and does not mutate economy state', () => {
  const state = defaultState();
  const economyBefore = structuredClone({ users: state.users, ledger: state.ledger, rechargeRequests: state.rechargeRequests });

  assert.throws(() => buildSpectatingSnapshot(state, 'ghost'), { message: 'USER_NOT_FOUND' });
  assert.deepEqual({ users: state.users, ledger: state.ledger, rechargeRequests: state.rechargeRequests }, economyBefore);
});
