// 하이로우: one shuffled 54-card deck (52 + two jokers). A card is turned; the player calls whether
// the next is strictly higher or lower. A joker, or the same rank again, loses the stake
// (한서 2026-11-04 "조커 뜨면 몰수, 같은 거 뜨면 몰수"). Each right call multiplies the prize by the honest odds of that call on the
// cards still in the deck, less the house's cut; the player can take the prize (챙기기) after any
// right call, or lose the stake on a wrong one. Up to three cards a round may be skipped.
// Every amount the table shows is whole chips: the prize is rounded down to the table's unit.
import crypto from 'node:crypto';
import { id } from './state.mjs';

export const HILO_GAME = 'High-Low';
export const HILO_ENGINE = 'hilo-v2';
// The house keeps 3% of each call's fair price.
export const HILO_EDGE = 0.03;
export const HILO_SKIPS = 3;
// The prize stops at 1000× the stake: it is taken for the player there.
export const HILO_MAX_MULT = 1000;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
export const JOKERS = ['JKR', 'JKB'];
export const isJoker = card => card.startsWith('JK');
export const rankOf = card => (isJoker(card) ? 0 : RANKS.indexOf(card.slice(0, -1)) + 1); // joker 0, A=1 … K=13

const defaultRng = () => crypto.randomInt(0, 2 ** 47) / 2 ** 47;
export function shuffledDeck(rng = defaultRng) {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  deck.push(...JOKERS);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

// The two calls on a card: strictly higher or strictly lower. A tie and a joker (rank 0) lose
// both. On an A nothing is lower and on a K nothing is higher, so that side is closed.
export function callsFor(rank) {
  const note = '같은 숫자·조커는 몰수';
  return {
    HIGH: { test: r => r >= 1 && r > rank, label: '높게', note: rank === 13 ? 'K보다 높은 카드 없음' : note },
    LOW: { test: r => r >= 1 && r < rank, label: '낮게', note: rank === 1 ? 'A보다 낮은 카드 없음' : note }
  };
}

// Turns the next card that is not a joker (start and 넘기기): a joker met on the way is burned.
function turnCard(round, kind) {
  while (round.deck.length) {
    const card = round.deck.shift();
    if (isJoker(card)) { round.trail.push({ card, kind: 'BURN' }); continue; }
    round.card = card;
    round.trail.push({ card, kind });
    return card;
  }
  throw new Error('HILO_DECK_EMPTY');
}
const liveLeft = deck => deck.some(c => !isJoker(c));

// How many of each rank are left (index 0 = A … 12 = K): the count the table shows.
export function rankCounts(deck) {
  const n = Array(13).fill(0);
  for (const c of deck) if (!isJoker(c)) n[rankOf(c) - 1]++;
  return n;
}

export function callChance(deck, rank, call) {
  if (!deck.length) return 0;
  const test = callsFor(rank)[call].test;
  return deck.filter(c => test(rankOf(c))).length / deck.length;
}
// What a right call multiplies the prize by: the fair price less the edge (0 when it can't win).
export const callFactor = p => (p > 0 ? (1 - HILO_EDGE) / p : 0);

const unitFloor = (x, unit) => Math.floor(x / unit + 1e-9) * unit;
// The prize right now, in whole units.
export const hiloValue = round => Math.min(round.stake * HILO_MAX_MULT, unitFloor(round.stake * round.mult, round.unit));

export function startHilo({ stake, unit, floor }, rng = defaultRng) {
  const round = {
    id: id('hilo'), game: HILO_GAME, engineVersion: HILO_ENGINE, status: 'PLAYING',
    stake, unit, floor, deck: shuffledDeck(rng), card: null, mult: 1, wins: 0, skips: HILO_SKIPS, seq: 0,
    trail: [], createdAt: new Date().toISOString()
  };
  turnCard(round, 'START');
  return round;
}

// Plays one move: HIGH, LOW, SKIP or CASH. Returns the event for the screen.
export function hiloMove(round, move) {
  if (round.status !== 'PLAYING') throw new Error('ROUND_NOT_PLAYING');
  if (move === 'CASH') {
    if (round.wins < 1) throw new Error('HILO_NOTHING_TO_TAKE');
    round.status = 'READY_TO_SETTLE';
    round.result = { kind: 'CASH', value: hiloValue(round) };
    round.seq++;
    return { type: 'cash', value: round.result.value };
  }
  if (move === 'SKIP') {
    if (round.skips < 1) throw new Error('HILO_NO_SKIPS');
    if (!liveLeft(round.deck)) throw new Error('HILO_DECK_EMPTY');
    round.skips--;
    const from = round.trail.length;
    const card = turnCard(round, 'SKIP');
    round.seq++;
    return { type: 'skip', card, burned: round.trail.slice(from, -1).map(t => t.card) };
  }
  if (move !== 'HIGH' && move !== 'LOW') throw new Error('INVALID_MOVE');
  if (!round.deck.length) throw new Error('HILO_DECK_EMPTY');
  const rank = rankOf(round.card);
  const p = callChance(round.deck, rank, move);
  const factor = callFactor(p);
  if (factor <= 1) throw new Error('HILO_CALL_PAYS_NOTHING');
  const card = round.deck.shift();
  const won = callsFor(rank)[move].test(rankOf(card));
  round.card = card;
  round.seq++;
  if (!won) {
    // Why it lost: a joker, the same rank again, or simply the other way.
    const why = isJoker(card) ? 'JOKER' : rankOf(card) === rank ? 'SAME' : 'WRONG';
    round.trail.push({ card, kind: 'MISS', call: move });
    round.status = 'READY_TO_SETTLE';
    round.result = { kind: 'MISS', value: 0, why };
    return { type: 'miss', card, call: move, why };
  }
  round.mult *= factor;
  round.wins++;
  round.trail.push({ card, kind: 'HIT', call: move });
  // The prize tops out at 1000×, or no card that could win is left: either way it is taken.
  const live = liveLeft(round.deck);
  if (round.stake * round.mult >= round.stake * HILO_MAX_MULT || !live) {
    round.status = 'READY_TO_SETTLE';
    round.result = { kind: live ? 'MAX' : 'DECK', value: hiloValue(round) };
  }
  return { type: 'hit', card, call: move, value: hiloValue(round) };
}

export const hiloNet = round => (round.result?.value ?? 0) - round.stake;

// What the player sees: no deck order, only how many of each rank are left, and what each call
// would pay in whole units if it comes in.
export function hiloPublic(round) {
  if (!round) return null;
  const rank = rankOf(round.card), deck = round.deck || [];
  const calls = callsFor(rank);
  const playing = round.status === 'PLAYING';
  const options = Object.fromEntries(['HIGH', 'LOW'].map(k => {
    const p = callChance(deck, rank, k), f = callFactor(p);
    const pays = Math.min(round.stake * HILO_MAX_MULT, unitFloor(round.stake * round.mult * f, round.unit));
    return [k, { label: calls[k].label, note: calls[k].note, chance: Math.round(p * 100), pays, open: playing && f > 1 && deck.length > 0 }];
  }));
  return {
    id: round.id, status: round.status, stake: round.stake, floor: round.floor, card: round.card,
    value: hiloValue(round), wins: round.wins, skips: round.skips, seq: round.seq,
    left: deck.length, counts: rankCounts(deck), jokers: deck.filter(isJoker).length, trail: round.trail.slice(-24),
    options, result: round.result || null, netPnl: round.status === 'SETTLED' ? round.netPnl : null
  };
}
