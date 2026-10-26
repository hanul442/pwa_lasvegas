// Baccarat for a friends' room: everyone at the table backs Player, Banker or Tie on the same coup,
// one seat after another, at the room's stake. Then the dealer turns the cards (Player, then
// Banker; no squeeze, 한서 took that out in #133), third cards follow the usual drawing rules, and
// every seat is paid against the house: Player 1:1, Banker 0.95:1, Tie 8:1, and a tie gives
// Player and Banker bets back. Seats are plain objects, so a person, a house AI or a seat someone
// left can sit in any of them.
import { id } from './state.mjs';
import { payout } from './constants.mjs';
import { baccaratScore, baccaratCardValue, baccaratShouldBankerDraw } from './games.mjs';
import { BOT_NAMES } from './holdem-bot.mjs';

export const BACCARAT_ROOM_ENGINE = 'BAC_ROOM_V1';
export const BACCARAT_SIDES = ['PLAYER', 'BANKER', 'TIE'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const cardText = c => `${c.r}${c.s}`;

function shoe(rng, decks = 8) {
  const cards = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  for (let i = cards.length - 1; i > 0; i--) { const j = rng(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}

// House players for the seats nobody took. rng(max) → integer.
export function baccaratRoomAi(n, rng) {
  const names = [...BOT_NAMES];
  return Array.from({ length: n }, () => ({ kind: 'ai', name: names.splice(rng(names.length), 1)[0] }));
}

export function startBaccaratRoom({ stake, seats, events = [], rng }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  const round = {
    id: id('bacr'), game: 'Baccarat', engineVersion: BACCARAT_ROOM_ENGINE, stake, seats,
    deck: shoe(rng), bets: seats.map(() => null), phase: 'BET', turn: -1,
    player: [], banker: [],
    playerScore: null, bankerScore: null, winner: null, trace: { natural: false },
    status: 'PLAYING', result: null, createdAt: new Date().toISOString()
  };
  events.push({ type: 'betting' });
  nextBettor(round, events, rng);
  return round;
}

export const baccaratRoomActor = round => (round.status === 'PLAYING' ? round.turn : -1);

export function baccaratRoomOptions(round, seat) {
  return baccaratRoomActor(round) === seat ? { sides: [...BACCARAT_SIDES] } : null;
}

// Choosing a side never costs more than the stake already locked.
export function baccaratRoomCost(round, seat, action) {
  if (baccaratRoomActor(round) !== seat) throw new Error('NOT_YOUR_TURN');
  if (!BACCARAT_SIDES.includes(action)) throw new Error('INVALID_ACTION');
  return 0;
}

export function baccaratRoomAct(round, seat, action, events = [], rng = max => Math.floor(Math.random() * max)) {
  baccaratRoomCost(round, seat, action);
  round.bets[seat] = action;
  events.push({ type: 'bet', seat, side: action });
  return nextBettor(round, events, rng);
}

function nextBettor(round, events, rng) {
  const s = round.bets.findIndex(b => b === null);
  if (s >= 0) {
    round.turn = s;
    events.push({ type: 'turn', seat: s });
    return events;
  }
  return finish(round, events, rng);
}

// Everyone is in: Player, Banker, Player, Banker, then the dealer turns each side and draws.
function finish(round, events, rng) {
  round.phase = 'DONE';
  round.turn = -1;
  for (let i = 0; i < 2; i++) for (const side of ['PLAYER', 'BANKER']) {
    (side === 'PLAYER' ? round.player : round.banker).push(round.deck.pop());
    events.push({ type: 'deal', side, card: 'HIDDEN' });
  }
  for (const side of ['PLAYER', 'BANKER']) {
    const cards = side === 'PLAYER' ? round.player : round.banker;
    events.push({ type: 'open', side, cards: cards.map(cardText), score: baccaratScore(cards) });
  }
  let ps = baccaratScore(round.player), bs = baccaratScore(round.banker);
  if (ps >= 8 || bs >= 8) round.trace.natural = true;
  else {
    let third = null;
    if (ps <= 5) {
      const c = round.deck.pop();
      round.player.push(c);
      third = baccaratCardValue(c);
      ps = baccaratScore(round.player);
      events.push({ type: 'third', side: 'PLAYER', card: cardText(c), score: ps });
    }
    if (baccaratShouldBankerDraw(bs, third)) {
      const c = round.deck.pop();
      round.banker.push(c);
      bs = baccaratScore(round.banker);
      events.push({ type: 'third', side: 'BANKER', card: cardText(c), score: bs });
    }
  }
  const winner = ps > bs ? 'PLAYER' : bs > ps ? 'BANKER' : 'TIE';
  const rand = () => rng(1_000_000) / 1_000_000;
  const nets = round.bets.map(b => {
    if (winner === 'TIE') return b === 'TIE' ? round.stake * 8 : 0;
    if (b !== winner) return -round.stake;
    return b === 'BANKER' ? payout(round.stake, round.stake * 0.95, rand) : round.stake;
  });
  Object.assign(round, { playerScore: ps, bankerScore: bs, winner, status: 'READY_TO_SETTLE' });
  round.result = { winner, playerScore: ps, bankerScore: bs, nets };
  events.push({ type: 'end', winner, player: round.player.map(cardText), banker: round.banker.map(cardText), playerScore: ps, bankerScore: bs, natural: round.trace.natural, bets: [...round.bets], nets: [...nets] });
  return events;
}

export const baccaratRoomNet = (round, seat) => round.result?.nets[seat] ?? 0;

// The house regulars mostly ride the shoe: Banker a little more often than Player, now and then a Tie.
export function baccaratRoomBot(round, seat, rng) {
  const roll = rng(100);
  return roll < 9 ? 'TIE' : roll < 55 ? 'BANKER' : 'PLAYER';
}

// The coup as `seat` sees it: the bets are on the felt for all to see; no card is out until
// everyone has bet, and then the whole coup plays out at once.
export function baccaratRoomPublic(round, seat) {
  return {
    id: round.id, game: round.game, engineVersion: round.engineVersion, stake: round.stake,
    status: round.status, phase: round.phase, turn: round.turn, you: seat,
    seats: round.seats.map((s, i) => ({ kind: s.kind, name: s.name || null, bet: round.bets[i] })),
    player: round.player.map(cardText), banker: round.banker.map(cardText),
    playerScore: round.player.length ? baccaratScore(round.player) : null,
    bankerScore: round.banker.length ? baccaratScore(round.banker) : null,
    options: baccaratRoomOptions(round, seat),
    result: round.result ? { ...round.result, nets: [...round.result.nets] } : null
  };
}
