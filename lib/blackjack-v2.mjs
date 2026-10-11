import crypto from 'node:crypto';
import { id } from './state.mjs';
import { stakeTierFor } from './constants.mjs';
import { BOT_NAMES } from './holdem-bot.mjs';
import { basicStrategy } from '../public/js/bj-strategy.js';

const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
export const BLACKJACK_MAX_SPOTS = 3;
export const BLACKJACK_MAX_HANDS = 6;
export const BLACKJACK_MAX_AI = 3;

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

// ---------- side bets ----------
const RED = new Set(['♥', '♦']);
const ORDER = { A: 1, J: 11, Q: 12, K: 13 };
const rankNo = r => ORDER[r] ?? Number(r);

// Perfect Pairs on a box's first two cards: same rank only (K-Q is not a pair).
export const PERFECT_PAIRS = { PERFECT: 25, COLOURED: 12, MIXED: 6 };
export function perfectPairs([a, b]) {
  if (!a || !b || a.r !== b.r) return null;
  if (a.s === b.s) return 'PERFECT';
  return RED.has(a.s) === RED.has(b.s) ? 'COLOURED' : 'MIXED';
}

// 21+3: the box's two cards and the dealer's up card as a three-card poker hand.
export const TWENTY_ONE_3 = { SUITED_TRIPS: 100, STRAIGHT_FLUSH: 40, TRIPS: 30, STRAIGHT: 10, FLUSH: 5 };
export function twentyOne3(cards) {
  if (cards.length !== 3) return null;
  const flush = cards.every(c => c.s === cards[0].s);
  const trips = cards.every(c => c.r === cards[0].r);
  if (trips) return flush ? 'SUITED_TRIPS' : 'TRIPS';
  const n = cards.map(c => rankNo(c.r)).sort((x, y) => x - y);
  // The ace plays low (A-2-3) or high (Q-K-A), never round the corner.
  const straight = (n[1] === n[0] + 1 && n[2] === n[1] + 1) || (n[0] === 1 && n[1] === 12 && n[2] === 13);
  if (straight) return flush ? 'STRAIGHT_FLUSH' : 'STRAIGHT';
  return flush ? 'FLUSH' : null;
}

function settleSideBets(round) {
  for (const bet of round.sideBets) {
    const hand = round.hands.find(h => h.spot === bet.spot);
    const first = hand.cards.slice(0, 2);
    const hit = bet.kind === 'PP' ? perfectPairs(first) : twentyOne3([...first, round.dealer[0]]);
    const pays = hit ? (bet.kind === 'PP' ? PERFECT_PAIRS : TWENTY_ONE_3)[hit] : 0;
    bet.result = hit || 'LOSS';
    bet.pays = pays;
    bet.netPnl = hit ? bet.stake * pays : -bet.stake;
  }
}

// ---------- AI players ----------
// Display-only seats beside the player's boxes: dealt from the same shoe, played after the player,
// settled against the dealer, but never touching anyone's chips.
export const AI_TEMPERS = ['steady', 'cautious', 'reckless'];
const AI_UNITS = [1, 1, 2, 3, 5];
const chance = () => randInt(1000) / 1000;

// Who sits down this round. Most of last round's players stay; now and then one leaves or a new one joins.
export function blackjackAiRoster(previous = [], rand = chance) {
  const pick = list => list[Math.floor(rand() * list.length)];
  const seats = (Array.isArray(previous) ? previous : [])
    .filter(p => p && BOT_NAMES.includes(p.name) && AI_TEMPERS.includes(p.temper) && rand() > 0.12)
    .map(p => ({ name: p.name, temper: p.temper, unit: AI_UNITS.includes(p.unit) ? p.unit : 1 }));
  const want = previous?.length ? seats.length + (rand() < 0.25 ? 1 : 0) : 1 + Math.floor(rand() * BLACKJACK_MAX_AI);
  while (seats.length < Math.max(1, Math.min(BLACKJACK_MAX_AI, want))) {
    const free = BOT_NAMES.filter(n => !seats.some(p => p.name === n));
    seats.push({ name: pick(free), temper: pick(AI_TEMPERS), unit: pick(AI_UNITS) });
  }
  return seats.slice(0, BLACKJACK_MAX_AI);
}

function aiSeat(spec, baseStake) {
  if (!spec || !BOT_NAMES.includes(spec.name) || !AI_TEMPERS.includes(spec.temper)) throw new Error('INVALID_AI');
  const unit = AI_UNITS.includes(spec.unit) ? spec.unit : 1;
  const stake = (stakeTierFor(baseStake)?.minBet || baseStake) * unit;
  return { name: spec.name, temper: spec.temper, unit, stake, cards: [], doubled: false, status: 'PLAYING', log: [], result: null };
}

// Basic strategy with each temperament's habits. AI seats never split.
export function aiDecision(seat, up, rand = chance) {
  const { total, soft } = blackjackValue(seat.cards);
  const canDouble = seat.cards.length === 2;
  if (seat.temper === 'cautious') {
    if (!soft && total >= 12) return 'STAND';
    const play = basicStrategy(seat.cards, up, { canDouble, canSplit: false });
    return play === 'DOUBLE' && total !== 11 ? 'HIT' : play;
  }
  if (seat.temper === 'reckless') {
    if (soft && total === 18 && rand() < 0.5) return 'HIT';
    if (!soft && canDouble && total >= 9 && total <= 11) return 'DOUBLE';
  }
  return basicStrategy(seat.cards, up, { canDouble, canSplit: false });
}

function playAi(round, rand) {
  const up = round.dealer[0];
  for (const seat of round.ai || []) {
    while (seat.status === 'PLAYING') {
      const action = aiDecision(seat, up, rand);
      if (action === 'STAND') { seat.status = 'STAND'; seat.log.push({ action, total: blackjackValue(seat.cards).total }); break; }
      const card = round.deck.pop();
      seat.cards.push(card);
      const total = blackjackValue(seat.cards).total;
      seat.log.push({ action, card: cardText(card), total });
      if (action === 'DOUBLE') { seat.doubled = true; seat.stake *= 2; }
      if (total > 21) seat.status = 'BUST';
      else if (total === 21 || action === 'DOUBLE') seat.status = 'STAND';
    }
  }
}

// stakes: one number per betting box (1 to 3 boxes), or a single stake repeated over `spots` boxes.
// options.pairs / options.trips: Perfect Pairs and 21+3 stakes per box (0 for none), each at most
// that box's stake. options.ai: AI seats from blackjackAiRoster().
export function startBlackjackV2(stakes, spots = 1, { pairs = [], trips = [], ai = [] } = {}) {
  const list = Array.isArray(stakes) ? stakes.map(Number) : Array.from({ length: spots }, () => stakes);
  if (!validSpots(list.length)) throw new Error('INVALID_SPOTS');
  if (!list.every(s => Number.isSafeInteger(s) && s > 0)) throw new Error('INVALID_STAKE');
  const total = list.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) throw new Error('INVALID_STAKE');

  const sideBets = [];
  for (const [kind, amounts] of [['PP', pairs], ['T3', trips]]) {
    if (!Array.isArray(amounts) || amounts.length > list.length) throw new Error('INVALID_SIDE_BET');
    amounts.forEach((raw, i) => {
      const stake = Number(raw || 0);
      if (stake === 0) return;
      if (!Number.isSafeInteger(stake) || stake < 0 || stake > list[i]) throw new Error('INVALID_SIDE_BET');
      sideBets.push({ spot: i + 1, kind, stake, result: null, pays: 0, netPnl: 0 });
    });
  }
  const sideTotal = sideBets.reduce((a, b) => a + b.stake, 0);
  if (!Number.isSafeInteger(total + sideTotal)) throw new Error('INVALID_STAKE');
  if (!Array.isArray(ai) || ai.length > BLACKJACK_MAX_AI) throw new Error('INVALID_AI');

  const deck = freshDeck(6);
  const hands = list.map((stake, i) => ({ spot: i + 1, stake, cards: [] }));
  const seats = ai.map(spec => aiSeat(spec, list[0]));
  const dealer = [];
  // Real dealing order: a card to each of the player's boxes, then each AI seat, the dealer's up card, then round again.
  for (const hand of [...hands, ...seats]) hand.cards.push(deck.pop());
  dealer.push(deck.pop());
  for (const hand of [...hands, ...seats]) hand.cards.push(deck.pop());
  dealer.push(deck.pop());
  for (const seat of seats) if (blackjackValue(seat.cards).total === 21) seat.status = 'STAND';

  const round = {
    id: id('bj2'), game: 'Blackjack', engineVersion: 'MULTI_SPOT_V2', baseStake: list[0],
    stake: total + sideTotal, spots: list.length, deck, dealer,
    hands: hands.map(h => initialHand(h.stake, h.spot, h.cards)),
    insurance: null, sideBets, ai: seats,
    activeHand: 0, status: 'PLAYER', createdAt: new Date().toISOString()
  };
  // Side bets are decided by the first cards alone, so they settle the moment the deal is done.
  settleSideBets(round);

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

function aiPublic(seat, reveal) {
  return {
    name: seat.name, temper: seat.temper, stake: seat.stake, doubled: seat.doubled,
    cards: seat.cards.map(cardText), value: blackjackValue(seat.cards).total, status: seat.status,
    log: reveal ? seat.log.map(x => ({ ...x })) : [],
    result: seat.result ? { ...seat.result } : null
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
    sideBets: (round.sideBets || []).map(b => ({ ...b })),
    ai: (round.ai || []).map(seat => aiPublic(seat, reveal)),
    dealer,
    dealerValue: reveal ? blackjackValue(round.dealer).total : null,
    netPnl: round.status === 'SETTLED' ? round.netPnl : null
  };
}

function outcome(cards, isNatural, stake, dealerValue, dealerNatural) {
  const playerValue = blackjackValue(cards).total;
  if (playerValue > 21) return { result: 'BUST', netPnl: -stake };
  if (dealerNatural) return isNatural ? { result: 'PUSH', netPnl: 0 } : { result: 'DEALER_BLACKJACK', netPnl: -stake };
  if (isNatural) return { result: 'BLACKJACK', netPnl: Math.floor(stake * 1.5) };
  if (dealerValue.total > 21 || playerValue > dealerValue.total) return { result: 'WIN', netPnl: stake };
  if (playerValue < dealerValue.total) return { result: 'LOSS', netPnl: -stake };
  return { result: 'PUSH', netPnl: 0 };
}
const aiNatural = seat => !seat.doubled && seat.cards.length === 2 && blackjackValue(seat.cards).total === 21;

export function settleBlackjackV2(round, rand = chance) {
  if (round.status !== 'READY_TO_SETTLE') throw new Error('BAD_STATE');
  let dealerValue = blackjackValue(round.dealer);
  const dealerNatural = round.dealer.length === 2 && dealerValue.total === 21;
  const ai = round.ai || [];
  // The AI seats act after the player and before the dealer draws (not when the dealer already has blackjack).
  if (!dealerNatural) playAi(round, rand);
  const live = (cards, isNatural) => blackjackValue(cards).total <= 21 && !isNatural;
  const needsDealerPlay = round.hands.some(hand => live(hand.cards, natural(hand))) || ai.some(seat => live(seat.cards, aiNatural(seat)));

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
    const { result, netPnl: handPnl } = outcome(hand.cards, natural(hand), hand.stake, dealerValue, dealerNatural);
    hand.status = 'SETTLED';
    hand.result = { result, netPnl: handPnl };
    netPnl += handPnl;
    outcomes.push({ handId: hand.id, spot: hand.spot, result, netPnl: handPnl, playerValue });
  }

  if (round.insurance?.taken) {
    netPnl += round.insurance.netPnl;
    outcomes.push({ handId: null, spot: null, result: `INSURANCE_${round.insurance.result}`, netPnl: round.insurance.netPnl, playerValue: null });
  }
  for (const bet of round.sideBets || []) {
    netPnl += bet.netPnl;
    outcomes.push({ handId: null, spot: bet.spot, result: `${bet.kind}_${bet.result}`, netPnl: bet.netPnl, playerValue: null });
  }
  // AI results are for show only and stay out of netPnl.
  for (const seat of ai) seat.result = outcome(seat.cards, aiNatural(seat), seat.stake, dealerValue, dealerNatural);

  round.status = 'SETTLED';
  round.activeHand = -1;
  round.netPnl = netPnl;
  return { netPnl, totalStake: round.stake, outcomes, public: blackjackV2Public(round, true) };
}
