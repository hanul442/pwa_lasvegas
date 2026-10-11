import crypto from 'node:crypto';
import { id } from './state.mjs';

const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
export const BLACKJACK_MAX_SPOTS = 3;
export const BLACKJACK_MAX_HANDS = 6;

function randInt(max) { return crypto.randomInt(0, max); }
function freshDeck(decks = 6) {
  const cards = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function cardText(c) { return `${c.r}${c.s}`; }
export function blackjackValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { aces++; total += 11; }
    else if (['J','Q','K'].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
function initialHand(stake, spot, cards) {
  return {
    id: id('bjh'), spot, cards, stake, doubled: false, fromSplit: false,
    status: blackjackValue(cards).total === 21 ? 'STAND' : 'PLAYING', result: null
  };
}
function validSpots(spots) {
  return Number.isInteger(spots) && spots >= 1 && spots <= BLACKJACK_MAX_SPOTS;
}
function activeIndex(round, from = 0) {
  for (let i = Math.max(0, from); i < round.hands.length; i++) if (round.hands[i].status === 'PLAYING') return i;
  for (let i = 0; i < Math.max(0, from); i++) if (round.hands[i].status === 'PLAYING') return i;
  return -1;
}
function syncRoundStatus(round, from = 0) {
  const next = activeIndex(round, from);
  round.activeHand = next;
  round.status = next === -1 ? 'READY_TO_SETTLE' : 'PLAYER';
}
function handAt(round, handIndex) {
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= round.hands.length) throw new Error('INVALID_HAND');
  const hand = round.hands[handIndex];
  if (round.status !== 'PLAYER' || hand.status !== 'PLAYING' || handIndex !== round.activeHand) throw new Error('HAND_NOT_ACTIONABLE');
  return hand;
}
// Any two cards of the same value split, so K-Q or 10-J count as a pair, as on most Strip tables.
function splitValue(card) { return ['10','J','Q','K'].includes(card.r) ? '10' : card.r; }
function splitAllowed(round, hand) {
  return hand.cards.length === 2 && splitValue(hand.cards[0]) === splitValue(hand.cards[1]) && round.hands.length < BLACKJACK_MAX_HANDS;
}
function natural(hand) {
  return !hand.fromSplit && !hand.doubled && hand.cards.length === 2 && blackjackValue(hand.cards).total === 21;
}

// stakes: one number per betting box (1 to 3 boxes), or a single stake repeated over `spots` boxes.
export function startBlackjackV2(stakes, spots = 1) {
  const list = Array.isArray(stakes) ? stakes.map(Number) : Array.from({ length: spots }, () => stakes);
  if (!validSpots(list.length)) throw new Error('INVALID_SPOTS');
  if (!list.every(s => Number.isSafeInteger(s) && s > 0)) throw new Error('INVALID_STAKE');
  const total = list.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) throw new Error('INVALID_STAKE');

  const deck = freshDeck(6);
  const hands = list.map((stake, i) => ({ spot: i + 1, stake, cards: [] }));
  const dealer = [];
  for (const hand of hands) hand.cards.push(deck.pop());
  dealer.push(deck.pop());
  for (const hand of hands) hand.cards.push(deck.pop());
  dealer.push(deck.pop());

  const round = {
    id: id('bj2'), game: 'Blackjack', engineVersion: 'MULTI_SPOT_V2', baseStake: list[0],
    stake: total, spots: list.length, deck, dealer,
    hands: hands.map(h => initialHand(h.stake, h.spot, h.cards)),
    insurance: null,
    activeHand: 0, status: 'PLAYER', createdAt: new Date().toISOString()
  };

  if (dealer[0].r === 'A') {
    // Ace showing: offer insurance before the dealer peeks.
    round.insurance = { offered: true, taken: null, stake: 0, result: null, netPnl: 0 };
    round.activeHand = -1;
    round.status = 'INSURANCE';
  } else peek(round);
  return round;
}

function peek(round) {
  if (blackjackValue(round.dealer).total === 21) {
    round.hands.forEach(h => { if (h.status === 'PLAYING') h.status = 'STAND'; });
    round.activeHand = -1;
    round.status = 'READY_TO_SETTLE';
  } else {
    syncRoundStatus(round, 0);
  }
}

function baseStakes(round) {
  return round.hands.filter(h => !h.fromSplit).reduce((a, h) => a + (h.doubled ? h.stake / 2 : h.stake), 0);
}

export function insuranceCost(round) {
  return Math.floor(baseStakes(round) / 2);
}

export function blackjackV2ActionCost(round, action, handIndex = round.activeHand) {
  if (action === 'INSURANCE' || action === 'NO_INSURANCE') {
    if (round.status !== 'INSURANCE') throw new Error('INSURANCE_NOT_OFFERED');
    return action === 'INSURANCE' ? insuranceCost(round) : 0;
  }
  if (round.status === 'INSURANCE') throw new Error('INSURANCE_DECISION_REQUIRED');
  const hand = handAt(round, handIndex);
  if (action === 'HIT' || action === 'STAND') return 0;
  if (action === 'DOUBLE') {
    if (hand.cards.length !== 2 || hand.doubled) throw new Error('DOUBLE_NOT_ALLOWED');
    return hand.stake;
  }
  if (action === 'SPLIT') {
    if (!splitAllowed(round, hand)) throw new Error(round.hands.length >= BLACKJACK_MAX_HANDS ? 'HAND_LIMIT_REACHED' : 'SPLIT_NOT_ALLOWED');
    return hand.stake;
  }
  throw new Error('INVALID_ACTION');
}

export function blackjackV2Action(round, action, handIndex = round.activeHand) {
  const cost = blackjackV2ActionCost(round, action, handIndex);
  if (action === 'INSURANCE' || action === 'NO_INSURANCE') {
    // Insurance pays 2:1 if the dealer has blackjack; either way the dealer then peeks.
    const ins = round.insurance;
    ins.taken = action === 'INSURANCE';
    ins.stake = cost;
    round.stake += cost;
    const dealerBlackjack = blackjackValue(round.dealer).total === 21;
    if (ins.taken) {
      ins.result = dealerBlackjack ? 'WIN' : 'LOSS';
      ins.netPnl = dealerBlackjack ? cost * 2 : -cost;
    }
    peek(round);
    return round;
  }
  const hand = round.hands[handIndex];

  if (action === 'HIT') {
    hand.cards.push(round.deck.pop());
    const total = blackjackValue(hand.cards).total;
    if (total > 21) hand.status = 'BUST';
    else if (total === 21) hand.status = 'STAND';
    syncRoundStatus(round, hand.status === 'PLAYING' ? handIndex : handIndex + 1);
  } else if (action === 'STAND') {
    hand.status = 'STAND';
    syncRoundStatus(round, handIndex + 1);
  } else if (action === 'DOUBLE') {
    hand.doubled = true;
    hand.stake += cost;
    round.stake += cost;
    hand.cards.push(round.deck.pop());
    hand.status = blackjackValue(hand.cards).total > 21 ? 'BUST' : 'STAND';
    syncRoundStatus(round, handIndex + 1);
  } else if (action === 'SPLIT') {
    const splitCard = hand.cards.pop();
    const splitAces = hand.cards[0].r === 'A' && splitCard.r === 'A';
    hand.fromSplit = true;
    hand.cards.push(round.deck.pop());
    hand.status = splitAces || blackjackValue(hand.cards).total === 21 ? 'STAND' : 'PLAYING';

    const siblingCards = [splitCard, round.deck.pop()];
    const sibling = {
      id: id('bjh'), spot: hand.spot, cards: siblingCards, stake: hand.stake,
      doubled: false, fromSplit: true,
      status: splitAces || blackjackValue(siblingCards).total === 21 ? 'STAND' : 'PLAYING', result: null
    };
    round.hands.splice(handIndex + 1, 0, sibling);
    round.stake += cost;
    syncRoundStatus(round, hand.status === 'PLAYING' ? handIndex : handIndex + 1);
  }
  return round;
}

function handPublic(round, hand, index) {
  return {
    id: hand.id,
    spot: hand.spot,
    index,
    cards: hand.cards.map(cardText),
    value: blackjackValue(hand.cards).total,
    stake: hand.stake,
    doubled: hand.doubled,
    fromSplit: hand.fromSplit,
    status: hand.status,
    active: round.status === 'PLAYER' && round.activeHand === index,
    canDouble: round.status === 'PLAYER' && round.activeHand === index && hand.status === 'PLAYING' && hand.cards.length === 2 && !hand.doubled,
    canSplit: round.status === 'PLAYER' && round.activeHand === index && hand.status === 'PLAYING' && splitAllowed(round, hand),
    result: hand.result ? { ...hand.result } : null
  };
}

export function blackjackV2Public(round, reveal = false) {
  const dealer = reveal
    ? round.dealer.map(cardText)
    : [cardText(round.dealer[0]), 'HIDDEN'];
  return {
    id: round.id,
    game: round.game,
    engineVersion: round.engineVersion,
    baseStake: round.baseStake,
    stake: round.stake,
    spots: round.spots,
    status: round.status,
    activeHand: round.activeHand,
    hands: round.hands.map((h, i) => handPublic(round, h, i)),
    insurance: round.insurance ? { ...round.insurance, cost: round.status === 'INSURANCE' ? insuranceCost(round) : round.insurance.stake } : null,
    dealer,
    dealerValue: reveal ? blackjackValue(round.dealer).total : null,
    netPnl: round.status === 'SETTLED' ? round.netPnl : null
  };
}

export function settleBlackjackV2(round) {
  if (round.status !== 'READY_TO_SETTLE') throw new Error('BAD_STATE');
  let dealerValue = blackjackValue(round.dealer);
  const dealerNatural = round.dealer.length === 2 && dealerValue.total === 21;
  const needsDealerPlay = round.hands.some(hand => blackjackValue(hand.cards).total <= 21 && !natural(hand));

  if (!dealerNatural && needsDealerPlay) {
    while (dealerValue.total < 17) {
      round.dealer.push(round.deck.pop());
      dealerValue = blackjackValue(round.dealer);
    }
  }

  let netPnl = 0;
  const outcomes = [];
  for (const hand of round.hands) {
    const playerValue = blackjackValue(hand.cards).total;
    const playerNatural = natural(hand);
    let result = 'PUSH', handPnl = 0;

    if (playerValue > 21) { result = 'BUST'; handPnl = -hand.stake; }
    else if (dealerNatural) {
      if (!playerNatural) { result = 'DEALER_BLACKJACK'; handPnl = -hand.stake; }
    } else if (playerNatural) { result = 'BLACKJACK'; handPnl = Math.floor(hand.stake * 1.5); }
    else if (dealerValue.total > 21 || playerValue > dealerValue.total) { result = 'WIN'; handPnl = hand.stake; }
    else if (playerValue < dealerValue.total) { result = 'LOSS'; handPnl = -hand.stake; }

    hand.status = 'SETTLED';
    hand.result = { result, netPnl: handPnl };
    netPnl += handPnl;
    outcomes.push({ handId: hand.id, spot: hand.spot, result, netPnl: handPnl, playerValue });
  }

  if (round.insurance?.taken) {
    netPnl += round.insurance.netPnl;
    outcomes.push({ handId: null, spot: null, result: `INSURANCE_${round.insurance.result}`, netPnl: round.insurance.netPnl, playerValue: null });
  }

  round.status = 'SETTLED';
  round.activeHand = -1;
  round.netPnl = netPnl;
  return { netPnl, totalStake: round.stake, outcomes, public: blackjackV2Public(round, true) };
}
