// Texas Hold'em table engine. Pure state machine over seats: it never knows whether a seat
// is a person or a bot, so the same engine can later run a friends' table where several
// seats are people. Every change is also written as a public event the client animates.
import crypto from 'node:crypto';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
export const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];

export const cardText = c => `${c.r}${c.s}`;

export function freshDeck(randInt = max => crypto.randomInt(0, max)) {
  const cards = [];
  for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  for (let i = cards.length - 1; i > 0; i--) { const j = randInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}

// ---------- hand evaluation ----------
export const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

function straightHigh(values) {
  // values: distinct, sorted high to low
  const v = values[0] === 14 ? [...values, 1] : values;
  for (let i = 0; i + 4 < v.length; i++) if (v[i] - v[i + 4] === 4) return v[i];
  return 0;
}

// Best five of 5–7 cards. Returns { score, cat, name } where a higher score is a better hand.
export function evaluate(cards) {
  const counts = new Map();
  const bySuit = new Map();
  for (const c of cards) {
    const v = RANK_VALUE[c.r];
    counts.set(v, (counts.get(v) || 0) + 1);
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s).push(v);
  }
  const distinct = [...counts.keys()].sort((a, b) => b - a);
  let flush = null;
  for (const vs of bySuit.values()) if (vs.length >= 5) flush = vs.sort((a, b) => b - a);
  let cat, kick;
  const sf = flush ? straightHigh([...new Set(flush)]) : 0;
  const groups = distinct.map(v => [counts.get(v), v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const st = straightHigh(distinct);
  if (sf) { cat = 8; kick = [sf]; }
  else if (groups[0][0] === 4) { cat = 7; kick = [groups[0][1], distinct.find(v => v !== groups[0][1])]; }
  else if (groups[0][0] === 3 && groups[1]?.[0] >= 2) { cat = 6; kick = [groups[0][1], groups[1][1]]; }
  else if (flush) { cat = 5; kick = flush.slice(0, 5); }
  else if (st) { cat = 4; kick = [st]; }
  else if (groups[0][0] === 3) { cat = 3; kick = [groups[0][1], ...distinct.filter(v => v !== groups[0][1]).slice(0, 2)]; }
  else if (groups[0][0] === 2 && groups[1]?.[0] === 2) { const hi = groups[0][1], lo = groups[1][1]; cat = 2; kick = [hi, lo, distinct.find(v => v !== hi && v !== lo)]; }
  else if (groups[0][0] === 2) { cat = 1; kick = [groups[0][1], ...distinct.filter(v => v !== groups[0][1]).slice(0, 3)]; }
  else { cat = 0; kick = distinct.slice(0, 5); }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] || 0);
  return { score, cat, name: HAND_NAMES[cat] };
}

// ---------- table ----------
// seats: [{ id, name, kind: 'human'|'bot', stack, style? }]
export function createTable({ seats, smallBlind, bigBlind, button = 0 }) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 9) throw new Error('INVALID_SEATS');
  if (!Number.isSafeInteger(bigBlind) || bigBlind <= 0 || !Number.isSafeInteger(smallBlind) || smallBlind <= 0) throw new Error('INVALID_BLINDS');
  return {
    smallBlind, bigBlind, button, handNo: 0,
    seats: seats.map(s => ({ id: s.id, name: s.name, kind: s.kind, style: s.style || null, stack: s.stack })),
    hand: null
  };
}

const live = table => table.seats.map((s, i) => i).filter(i => table.seats[i].stack > 0);
function nextFrom(table, from, pred) {
  const n = table.seats.length;
  for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (pred(i)) return i; }
  return -1;
}
const inHand = (h, i) => h.players[i] && !h.players[i].folded;
const canAct = (h, i) => inHand(h, i) && !h.players[i].allIn;

function emit(table, ev) { table.hand.events.push(ev); return ev; }

function post(table, i, amount, kind) {
  const seat = table.seats[i], p = table.hand.players[i];
  const pay = Math.min(amount, seat.stack);
  seat.stack -= pay; p.bet += pay; p.committed += pay;
  if (seat.stack === 0) p.allIn = true;
  emit(table, { t: 'blind', seat: i, kind, amount: pay, stack: seat.stack, bet: p.bet });
  return pay;
}

export function startHand(table, deck = freshDeck()) {
  if (table.hand && !table.hand.over) throw new Error('HAND_IN_PROGRESS');
  const seated = live(table);
  if (seated.length < 2) throw new Error('NOT_ENOUGH_PLAYERS');
  table.handNo += 1;
  const isLive = i => table.seats[i].stack > 0;
  if (table.handNo > 1 || !isLive(table.button)) table.button = nextFrom(table, table.button, isLive);
  const players = table.seats.map((s, i) => (s.stack > 0 ? { cards: [], bet: 0, committed: 0, folded: false, allIn: false, acted: false } : null));
  table.hand = {
    no: table.handNo, deck: [...deck], board: [], street: 'PREFLOP', players,
    currentBet: 0, minRaise: table.bigBlind, toAct: -1, seq: 0, over: false, events: [], results: null
  };
  const h = table.hand;
  const headsUp = seated.length === 2;
  const sb = headsUp ? table.button : nextFrom(table, table.button, isLive);
  const bb = nextFrom(table, sb, isLive);
  emit(table, { t: 'hand', no: h.no, button: table.button, sb, bb, smallBlind: table.smallBlind, bigBlind: table.bigBlind, seats: seated });
  post(table, sb, table.smallBlind, 'SB');
  post(table, bb, table.bigBlind, 'BB');
  h.currentBet = table.bigBlind;
  const order = [];
  for (let k = 0; k < table.seats.length; k++) { const i = (sb + k) % table.seats.length; if (players[i]) order.push(i); }
  // Two passes round the table from the small blind, one card at a time, like a real dealer.
  for (let pass = 0; pass < 2; pass++) for (const i of order) players[i].cards.push(h.deck.pop());
  emit(table, { t: 'deal', order });
  h.toAct = nextFrom(table, bb, i => canAct(h, i));
  settleIfDone(table);
  return table;
}

export function legalActions(table, i) {
  const h = table.hand;
  if (!h || h.over || h.toAct !== i) return null;
  const seat = table.seats[i], p = h.players[i];
  const toCall = Math.min(h.currentBet - p.bet, seat.stack);
  const maxTo = p.bet + seat.stack;
  const minTo = Math.min(h.currentBet + h.minRaise, maxTo);
  const othersCanAct = h.players.some((q, j) => j !== i && q && !q.folded && !q.allIn);
  return {
    toCall, canCheck: toCall === 0, canCall: toCall > 0,
    canRaise: maxTo > h.currentBet && othersCanAct,
    minRaiseTo: minTo, maxRaiseTo: maxTo, currentBet: h.currentBet, pot: potTotal(table)
  };
}

export const potTotal = table => (table.hand ? table.hand.players.reduce((a, p) => a + (p ? p.committed : 0), 0) : 0);

// action: { type: 'FOLD'|'CHECK'|'CALL'|'RAISE'|'ALL_IN', amount? } where amount is the raise-to level.
export function applyAction(table, i, action) {
  const h = table.hand;
  if (!h || h.over) throw new Error('HAND_NOT_ACTIVE');
  if (h.toAct !== i) throw new Error('NOT_YOUR_TURN');
  const legal = legalActions(table, i);
  const seat = table.seats[i], p = h.players[i];
  let type = action?.type;
  if (type === 'ALL_IN') type = legal.canRaise ? 'RAISE' : legal.canCall ? 'CALL' : 'CHECK';
  const amountTo = action?.type === 'ALL_IN' ? legal.maxRaiseTo : Number(action?.amount);
  if (type === 'CHECK' && !legal.canCheck) throw new Error('CANNOT_CHECK');
  if (type === 'CALL' && !legal.canCall) type = 'CHECK';
  if (type === 'FOLD') {
    p.folded = true;
    emit(table, { t: 'act', seat: i, action: 'FOLD' });
  } else if (type === 'CHECK') {
    emit(table, { t: 'act', seat: i, action: 'CHECK' });
  } else if (type === 'CALL') {
    const pay = legal.toCall;
    seat.stack -= pay; p.bet += pay; p.committed += pay;
    if (seat.stack === 0) p.allIn = true;
    emit(table, { t: 'act', seat: i, action: p.allIn ? 'ALL_IN' : 'CALL', amount: pay, bet: p.bet, stack: seat.stack });
  } else if (type === 'RAISE') {
    if (!legal.canRaise) throw new Error('CANNOT_RAISE');
    if (!Number.isSafeInteger(amountTo) || amountTo > legal.maxRaiseTo || (amountTo < legal.minRaiseTo && amountTo !== legal.maxRaiseTo)) throw new Error('INVALID_RAISE');
    const pay = amountTo - p.bet;
    const increment = amountTo - h.currentBet;
    const wasBet = h.currentBet === 0;
    seat.stack -= pay; p.bet = amountTo; p.committed += pay;
    if (seat.stack === 0) p.allIn = true;
    if (increment >= h.minRaise) h.minRaise = increment;
    h.currentBet = amountTo;
    h.players.forEach((q, j) => { if (q && j !== i) q.acted = false; });
    emit(table, { t: 'act', seat: i, action: p.allIn ? 'ALL_IN' : wasBet ? 'BET' : 'RAISE', amount: pay, bet: p.bet, stack: seat.stack });
  } else throw new Error('INVALID_ACTION');
  p.acted = true;
  h.seq += 1;
  advance(table, i);
  return table;
}

// Takes a seat out of the hand whether or not it is their turn (a player leaving the table).
// Their chips already in the pot stay there; the hand carries on, or ends if one player is left.
export function foldOut(table, i) {
  const h = table.hand;
  if (!h || h.over || !inHand(h, i)) return table;
  if (h.toAct === i) return applyAction(table, i, { type: 'FOLD' });
  h.players[i].folded = true;
  h.seq += 1;
  emit(table, { t: 'act', seat: i, action: 'FOLD' });
  settleIfDone(table);
  return table;
}

function streetDone(h) {
  return h.players.every(p => !p || p.folded || p.allIn || (p.acted && p.bet === h.currentBet));
}

function collect(table) {
  const h = table.hand;
  const bets = h.players.map(p => (p ? p.bet : 0));
  if (bets.some(Boolean)) emit(table, { t: 'collect', bets, pot: potTotal(table) });
  h.players.forEach(p => { if (p) { p.bet = 0; p.acted = false; } });
  h.currentBet = 0;
  h.minRaise = table.bigBlind;
}

function dealStreet(table) {
  const h = table.hand;
  const next = STREETS[STREETS.indexOf(h.street) + 1];
  h.deck.pop(); // burn
  const cards = next === 'FLOP' ? [h.deck.pop(), h.deck.pop(), h.deck.pop()] : [h.deck.pop()];
  h.board.push(...cards);
  h.street = next;
  emit(table, { t: 'street', street: next, cards: cards.map(cardText) });
}

function advance(table, from) {
  const h = table.hand;
  if (settleIfDone(table)) return;
  if (!streetDone(h)) { h.toAct = nextFrom(table, from, i => canAct(h, i) && (!h.players[i].acted || h.players[i].bet < h.currentBet)); return; }
  nextStreet(table);
}

function nextStreet(table) {
  const h = table.hand;
  collect(table);
  if (h.street === 'RIVER') return showdown(table);
  dealStreet(table);
  const actors = h.players.filter(p => p && !p.folded && !p.allIn).length;
  if (actors < 2) return nextStreet(table); // everyone is all in: run the board out
  h.toAct = nextFrom(table, table.button, i => canAct(h, i));
}

// Ends the hand early when only one player is left, or starts the run-out when nobody can bet.
function settleIfDone(table) {
  const h = table.hand;
  const remaining = h.players.map((p, i) => i).filter(i => inHand(h, i));
  if (remaining.length === 1) {
    collect(table);
    award(table, [{ amount: potTotal(table), eligible: remaining }], null);
    return true;
  }
  const actors = remaining.filter(i => !h.players[i].allIn);
  if (actors.length === 0 || (actors.length === 1 && h.players[actors[0]].bet >= h.currentBet && streetDone(h))) {
    nextStreet(table);
    return true;
  }
  return false;
}

export function buildPots(players) {
  const levels = [...new Set(players.filter(p => p && p.committed > 0).map(p => p.committed))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    const eligible = [];
    players.forEach((p, i) => {
      if (!p) return;
      amount += Math.max(0, Math.min(p.committed, level) - prev);
      if (!p.folded && p.committed >= level) eligible.push(i);
    });
    if (amount > 0) {
      const last = pots[pots.length - 1];
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  return pots;
}

function showdown(table) {
  const h = table.hand;
  const shown = new Map();
  // Last aggressor would show first in a real room; clockwise from the button is close enough.
  for (let k = 1; k <= table.seats.length; k++) {
    const i = (table.button + k) % table.seats.length;
    if (!inHand(h, i)) continue;
    const ev = evaluate([...h.players[i].cards, ...h.board]);
    shown.set(i, ev);
    emit(table, { t: 'show', seat: i, cards: h.players[i].cards.map(cardText), hand: ev.name });
  }
  award(table, buildPots(h.players), shown);
}

function award(table, pots, shown) {
  const h = table.hand;
  const won = table.seats.map(() => 0);
  const winners = [];
  pots.forEach((pot, index) => {
    let best = pot.eligible;
    if (shown && pot.eligible.length > 1) {
      const top = Math.max(...pot.eligible.map(i => shown.get(i).score));
      best = pot.eligible.filter(i => shown.get(i).score === top);
    }
    const share = Math.floor(pot.amount / best.length);
    let odd = pot.amount - share * best.length;
    // Odd chips go to the first winner left of the button.
    const ordered = [...best].sort((a, b) => ((a - table.button - 1 + 99 * table.seats.length) % table.seats.length) - ((b - table.button - 1 + 99 * table.seats.length) % table.seats.length));
    for (const i of ordered) {
      const amount = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      table.seats[i].stack += amount;
      won[i] += amount;
      const uncalled = Boolean(shown) && pot.eligible.length === 1;
      emit(table, { t: 'win', seat: i, amount, pot: index, hand: shown && !uncalled ? shown.get(i).name : null, uncalled, stack: table.seats[i].stack });
      winners.push(i);
    }
  });
  h.over = true;
  h.toAct = -1;
  h.results = { winners: [...new Set(winners)], won, showdown: Boolean(shown) };
  emit(table, { t: 'end', no: h.no, stacks: table.seats.map(s => s.stack) });
}

// What a given seat may see: its own cards, plus anything shown at showdown.
export function publicTable(table, viewer = -1) {
  const h = table.hand;
  const shownSeats = new Set(h ? h.events.filter(e => e.t === 'show').map(e => e.seat) : []);
  return {
    handNo: table.handNo, button: table.button, smallBlind: table.smallBlind, bigBlind: table.bigBlind,
    street: h?.street ?? null, board: h ? h.board.map(cardText) : [], pot: potTotal(table),
    toAct: h && !h.over ? h.toAct : -1, seq: h?.seq ?? 0, handOver: h ? h.over : true,
    results: h?.results ?? null,
    seats: table.seats.map((s, i) => {
      const p = h?.players[i];
      const visible = p && (i === viewer || shownSeats.has(i));
      return {
        id: s.id, name: s.name, kind: s.kind, style: s.style, stack: s.stack,
        inHand: Boolean(p), folded: Boolean(p?.folded), allIn: Boolean(p?.allIn), bet: p?.bet ?? 0, committed: p?.committed ?? 0,
        cards: p ? (visible ? p.cards.map(cardText) : p.cards.map(() => 'HIDDEN')) : []
      };
    }),
    legal: viewer >= 0 ? legalActions(table, viewer) : null
  };
}
