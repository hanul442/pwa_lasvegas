// Blackjack for a friends' room: several seats against one dealer, out of one shoe. Each seat
// plays one box at the room's stake and may double or split (up to four hands); seats act in
// turn, then the dealer turns the hole card and draws to 17. No insurance or side bets here.
// Seats are plain objects, so a person, a house AI or a seat someone left can sit in any of them;
// the AI plays the solo table's basic strategy with its temperament.
import { id } from './state.mjs';
import { payout } from './constants.mjs';
import { blackjackValue, aiDecision, AI_TEMPERS } from './blackjack-v2.mjs';
import { BOT_NAMES } from './holdem-bot.mjs';

export const BLACKJACK_ROOM_ENGINE = 'BJ_ROOM_V1';
export const BLACKJACK_ROOM_MAX_HANDS = 4; // per seat, after splits
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const cardText = c => `${c.r}${c.s}`;
const total = cards => blackjackValue(cards).total;
const tenValue = c => (['10', 'J', 'Q', 'K'].includes(c.r) ? '10' : c.r);

function shoe(rng, decks = 6) {
  const cards = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  for (let i = cards.length - 1; i > 0; i--) { const j = rng(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}

const newHand = (stake, cards = []) => ({ id: id('bjh'), cards, stake, doubled: false, fromSplit: false, status: 'PLAYING', result: null });
const isNatural = h => !h.fromSplit && !h.doubled && h.cards.length === 2 && total(h.cards) === 21;

// House players for the seats nobody took, each with a temperament. rng(max) → integer.
export function blackjackRoomAi(n, rng) {
  const names = [...BOT_NAMES];
  return Array.from({ length: n }, () => ({ kind: 'ai', name: names.splice(rng(names.length), 1)[0], temper: AI_TEMPERS[rng(AI_TEMPERS.length)] }));
}

export function startBlackjackRoom({ stake, seats, events = [], rng }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  const deck = shoe(rng);
  const round = {
    id: id('bjr'), game: 'Blackjack', engineVersion: BLACKJACK_ROOM_ENGINE, stake, seats,
    deck, dealer: [], players: seats.map(() => ({ hands: [newHand(stake)], active: 0 })),
    turn: -1, status: 'PLAYING', result: null, createdAt: new Date().toISOString()
  };
  // A card to every seat, the dealer's up card, a second card round, then the hole card.
  for (const pass of [0, 1]) {
    round.players.forEach((p, s) => { const c = deck.pop(); p.hands[0].cards.push(c); events.push({ type: 'deal', seat: s, hand: 0, card: cardText(c) }); });
    const c = deck.pop();
    round.dealer.push(c);
    events.push({ type: 'deal', seat: -1, card: pass ? 'HIDDEN' : cardText(c) });
  }
  round.players.forEach(p => { if (total(p.hands[0].cards) === 21) p.hands[0].status = 'STAND'; });
  // The dealer peeks under an ace or a ten: a blackjack ends the round before anyone acts.
  if (total(round.dealer) === 21) {
    round.players.forEach(p => p.hands.forEach(h => { h.status = 'STAND'; }));
    dealerPlays(round, events);
  } else advance(round, 0, events);
  return round;
}

export function blackjackRoomActor(round) { return round.status === 'PLAYING' ? round.turn : -1; }

function activeHand(round, seat) {
  if (blackjackRoomActor(round) !== seat) throw new Error('NOT_YOUR_TURN');
  return round.players[seat].hands[round.players[seat].active];
}
const canSplit = (round, seat, h) => h.cards.length === 2 && tenValue(h.cards[0]) === tenValue(h.cards[1]) && round.players[seat].hands.length < BLACKJACK_ROOM_MAX_HANDS;
const canDouble = h => h.cards.length === 2 && !h.doubled;

export function blackjackRoomOptions(round, seat) {
  if (blackjackRoomActor(round) !== seat) return null;
  const h = activeHand(round, seat);
  return { hand: round.players[seat].active, canDouble: canDouble(h), canSplit: canSplit(round, seat, h), stake: h.stake };
}

export function blackjackRoomCost(round, seat, action) {
  const h = activeHand(round, seat);
  if (action === 'HIT' || action === 'STAND') return 0;
  if (action === 'DOUBLE') { if (!canDouble(h)) throw new Error('DOUBLE_NOT_ALLOWED'); return h.stake; }
  if (action === 'SPLIT') { if (!canSplit(round, seat, h)) throw new Error('SPLIT_NOT_ALLOWED'); return h.stake; }
  throw new Error('INVALID_ACTION');
}

export function blackjackRoomAct(round, seat, action, events = []) {
  blackjackRoomCost(round, seat, action);
  const p = round.players[seat], idx = p.active, h = p.hands[idx];
  if (action === 'HIT') {
    const c = round.deck.pop();
    h.cards.push(c);
    const t = total(h.cards);
    if (t > 21) h.status = 'BUST'; else if (t === 21) h.status = 'STAND';
    events.push({ type: 'act', seat, hand: idx, action, card: cardText(c), total: t, status: h.status });
  } else if (action === 'STAND') {
    h.status = 'STAND';
    events.push({ type: 'act', seat, hand: idx, action, total: total(h.cards), status: h.status });
  } else if (action === 'DOUBLE') {
    const c = round.deck.pop();
    h.doubled = true;
    h.stake *= 2;
    h.cards.push(c);
    h.status = total(h.cards) > 21 ? 'BUST' : 'STAND';
    events.push({ type: 'act', seat, hand: idx, action, card: cardText(c), total: total(h.cards), status: h.status, stake: h.stake });
  } else {
    // Split: the second card starts a new hand at the same stake; split aces take one card each.
    const moved = h.cards.pop();
    const aces = h.cards[0].r === 'A' && moved.r === 'A';
    const sibling = newHand(h.stake, [moved]);
    h.fromSplit = sibling.fromSplit = true;
    p.hands.splice(idx + 1, 0, sibling);
    const a = round.deck.pop(), b = round.deck.pop();
    h.cards.push(a);
    sibling.cards.push(b);
    for (const x of [h, sibling]) x.status = aces || total(x.cards) === 21 ? 'STAND' : 'PLAYING';
    events.push({ type: 'split', seat, hand: idx, id: sibling.id, cards: [cardText(a), cardText(b)], stake: h.stake });
  }
  return advance(round, seat, events);
}

// The next hand still to play: this seat's own split hands first, then round the table.
function advance(round, from, events) {
  for (let s = Math.max(0, from); s < round.players.length; s++) {
    const p = round.players[s];
    const i = p.hands.findIndex(h => h.status === 'PLAYING');
    if (i < 0) continue;
    p.active = i;
    round.turn = s;
    events.push({ type: 'turn', seat: s, hand: i });
    return events;
  }
  return dealerPlays(round, events);
}

function dealerPlays(round, events) {
  round.turn = -1;
  events.push({ type: 'reveal', card: cardText(round.dealer[1]) });
  const dealerNatural = total(round.dealer) === 21;
  const live = round.players.some(p => p.hands.some(h => h.status !== 'BUST' && !isNatural(h)));
  if (!dealerNatural && live) {
    while (total(round.dealer) < 17) {
      const c = round.deck.pop();
      round.dealer.push(c);
      events.push({ type: 'draw', card: cardText(c), total: total(round.dealer) });
    }
  }
  const d = total(round.dealer);
  round.players.forEach(p => p.hands.forEach(h => {
    const v = total(h.cards);
    let result, net;
    if (v > 21) { result = 'BUST'; net = -h.stake; }
    else if (dealerNatural) { result = isNatural(h) ? 'PUSH' : 'DEALER_BLACKJACK'; net = isNatural(h) ? 0 : -h.stake; }
    else if (isNatural(h)) { result = 'BLACKJACK'; net = payout(h.stake, h.stake * 1.5); }
    else if (d > 21 || v > d) { result = 'WIN'; net = h.stake; }
    else if (v < d) { result = 'LOSS'; net = -h.stake; }
    else { result = 'PUSH'; net = 0; }
    h.status = 'SETTLED';
    h.result = { result, netPnl: net };
  }));
  round.status = 'READY_TO_SETTLE';
  round.result = { dealer: d, nets: round.players.map(p => p.hands.reduce((a, h) => a + h.result.netPnl, 0)) };
  events.push({ type: 'end', dealer: round.dealer.map(cardText), total: d, nets: [...round.result.nets], hands: round.players.map(p => p.hands.map(h => ({ id: h.id, ...h.result }))) });
  return events;
}

export const blackjackRoomNet = (round, seat) => round.result?.nets[seat] ?? 0;

export function blackjackRoomBot(round, seat, rand) {
  const h = activeHand(round, seat);
  const move = aiDecision({ cards: h.cards, temper: round.seats[seat].temper || 'steady' }, round.dealer[0], rand);
  return move === 'DOUBLE' && !canDouble(h) ? 'HIT' : move;
}

// The round as `seat` sees it: everyone's cards are face up at blackjack, only the hole card hides.
export function blackjackRoomPublic(round, seat) {
  const shown = round.status !== 'PLAYING';
  return {
    id: round.id, game: round.game, engineVersion: round.engineVersion, stake: round.stake,
    status: round.status, turn: round.turn, you: seat,
    dealer: shown ? round.dealer.map(cardText) : [cardText(round.dealer[0]), 'HIDDEN'],
    dealerValue: shown ? total(round.dealer) : null,
    seats: round.seats.map((s, i) => ({
      kind: s.kind, name: s.name || null, temper: s.temper || null,
      active: round.players[i].active,
      hands: round.players[i].hands.map(h => ({ id: h.id, cards: h.cards.map(cardText), value: total(h.cards), stake: h.stake, doubled: h.doubled, status: h.status, result: h.result ? { ...h.result } : null }))
    })),
    options: blackjackRoomOptions(round, seat),
    result: round.result ? { ...round.result, nets: [...round.result.nets] } : null
  };
}
