// 7포커 (Korean seven-card stud) table engine. Like the Hold'em engine (lib/holdem.mjs) it is a
// pure state machine over seats that never knows whether a seat is a person or a bot, and every
// change is also written as a public event the client animates.
//
// The house rules (the rules sheet in public/js/guides.js says the same):
// - Everyone antes. Three cards are dealt face down; each player turns one of them up (오픈).
// - 4th, 5th and 6th street come face up, 7th (히든) face down: 3 hidden cards and 4 open ones.
// - A betting round follows 4th, 5th, 6th and 7th street. The best open hand acts first (선);
//   equal open hands go to the highest open card by suit (♠ > ♦ > ♥ > ♣).
// - No bet yet: 체크, 삥 (the ante), 쿼터 (a quarter of the pot), 하프 (half the pot).
//   Facing a bet: 콜, 따당 (double the bet), 쿼터 / 하프 (call, then a quarter / half of the pot on top).
//   다이 gives the hand up. A bet and at most two raises per street (MAX_RAISES).
// - Best five of seven at showdown (lib/holdem.mjs evaluate); all-ins split into side pots.
import { freshDeck, evaluate, buildPots, cardText, RANK_VALUE, HAND_NAMES } from './holdem.mjs';

export { freshDeck, evaluate, buildPots, HAND_NAMES };
export const STREET_NAMES = { 3: '오픈', 4: '4구', 5: '5구', 6: '6구', 7: '히든' };
export const MAX_RAISES = 3; // aggressive moves per street, the opening bet included
export const BET_ACTIONS = ['BBING', 'DDADANG', 'QUARTER', 'HALF'];
const SUIT_RANK = { '♠': 4, '♦': 3, '♥': 2, '♣': 1 };
const UP_AT = [false, false, true, true, true, true, false]; // card position -> dealt face up (after the open)

// seats: [{ id, name, kind: 'human'|'bot', stack, style? }]; ante: what everyone puts in before the
// deal (and the size of a 삥); unit: the smallest amount a bet or a split pot moves in.
export function createTable({ seats, ante, unit = 1, level = null }) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 7) throw new Error('INVALID_SEATS');
  if (!Number.isSafeInteger(ante) || ante <= 0) throw new Error('INVALID_ANTE');
  return {
    ante, unit, level, handNo: 0, button: -1,
    seats: seats.map(s => ({ id: s.id, name: s.name, kind: s.kind, style: s.style || null, stack: s.stack })),
    hand: null
  };
}

const n = table => table.seats.length;
function nextFrom(table, from, pred) {
  for (let k = 1; k <= n(table); k++) { const i = (((from + k) % n(table)) + n(table)) % n(table); if (pred(i)) return i; }
  return -1;
}
const inHand = (h, i) => Boolean(h.players[i]) && !h.players[i].folded;
const canAct = (h, i) => inHand(h, i) && !h.players[i].allIn;
const emit = (table, ev) => { table.hand.events.push(ev); return ev; };
const ceilTo = (x, unit) => Math.ceil(x / unit) * unit;
export const potTotal = table => (table.hand ? table.hand.players.reduce((a, p) => a + (p ? p.committed : 0), 0) : 0);

// The open cards a player shows, and how they rank: a score on the open cards first, then the
// highest open card by rank and suit for ties.
export const upCards = p => p.cards.filter((c, k) => p.up[k]);
export function showing(cards) {
  if (!cards.length) return { score: -1, tie: 0, name: '' };
  const ev = evaluate(cards);
  const tie = Math.max(...cards.map(c => RANK_VALUE[c.r] * 5 + SUIT_RANK[c.s]));
  return { score: ev.score, tie, name: ev.name };
}
const beats = (a, b) => a.score > b.score || (a.score === b.score && a.tie > b.tie);

// The seat that bets first this street: the best open hand among players who can still bet.
export function leadSeat(table) {
  const h = table.hand;
  let best = -1, top = null;
  h.players.forEach((p, i) => {
    if (!canAct(h, i)) return;
    const s = showing(upCards(p));
    if (best < 0 || beats(s, top)) { best = i; top = s; }
  });
  return best;
}

export function startHand(table, deck = freshDeck()) {
  if (table.hand && !table.hand.over) throw new Error('HAND_IN_PROGRESS');
  const seated = table.seats.map((s, i) => i).filter(i => table.seats[i].stack > 0);
  if (seated.length < 2) throw new Error('NOT_ENOUGH_PLAYERS');
  table.handNo += 1;
  const players = table.seats.map(s => (s.stack > 0 ? { cards: [], up: [], chosen: false, bet: 0, committed: 0, folded: false, allIn: false, acted: false } : null));
  table.hand = {
    no: table.handNo, deck: [...deck], street: 3, phase: 'CHOOSE', players,
    currentBet: 0, raises: 0, lead: -1, toAct: -1, seq: 0, over: false, events: [], results: null
  };
  const h = table.hand;
  emit(table, { t: 'hand', no: h.no, button: -1, seats: seated, ante: table.ante });
  for (const i of seated) {
    const seat = table.seats[i], p = players[i];
    const pay = Math.min(table.ante, seat.stack);
    seat.stack -= pay; p.bet += pay; p.committed += pay;
    if (seat.stack === 0) p.allIn = true;
    emit(table, { t: 'blind', seat: i, kind: 'ANTE', amount: pay, stack: seat.stack, bet: p.bet });
  }
  collect(table);
  for (let pass = 0; pass < 3; pass++) for (const i of seated) { players[i].cards.push(h.deck.pop()); players[i].up.push(false); }
  emit(table, { t: 'deal3', order: seated });
  return table;
}

// Each player turns one of their three cards up. Once everyone has, the open cards are shown
// together and 4th street is dealt. The chosen card moves to the third place, so a hand always
// reads hidden, hidden, open, open, open, open, hidden.
export function chooseOpen(table, i, index) {
  const h = table.hand;
  if (!h || h.over || h.phase !== 'CHOOSE') throw new Error('HAND_NOT_ACTIVE');
  const p = h.players[i];
  if (!p || p.folded) throw new Error('NOT_YOUR_TURN');
  if (p.chosen) throw new Error('ALREADY_CHOSEN');
  const k = Number(index);
  if (![0, 1, 2].includes(k)) throw new Error('INVALID_OPEN');
  const [card] = p.cards.splice(k, 1);
  p.cards.splice(2, 0, card);
  p.up[2] = true;
  p.chosen = true;
  p.openFrom = k;
  h.seq += 1;
  if (h.players.every(q => !q || q.folded || q.chosen)) {
    h.phase = 'BET';
    emit(table, { t: 'open', cards: h.players.map((q, j) => (q && !q.folded ? { seat: j, card: cardText(q.cards[2]), from: q.openFrom } : null)).filter(Boolean) });
    nextStreet(table);
  }
  return table;
}
export const waitingToChoose = (table, i) => Boolean(table.hand && !table.hand.over && table.hand.phase === 'CHOOSE' && table.hand.players[i] && !table.hand.players[i].folded && !table.hand.players[i].chosen);

// The bets on offer to the seat to act, each with the level it brings the bet to ("to") and
// what it costs. Every amount is a multiple of the table unit; one that runs past the stack is
// an all-in for what is left, and sizes that land on the same amount show once (the first name).
export function legalActions(table, i) {
  const h = table.hand;
  if (!h || h.over) return null;
  if (h.phase === 'CHOOSE') return waitingToChoose(table, i) ? { phase: 'CHOOSE', options: [] } : null;
  if (h.toAct !== i) return null;
  const seat = table.seats[i], p = h.players[i];
  const unit = table.unit || 1, ante = table.ante;
  const pot = potTotal(table);
  const toCall = Math.min(h.currentBet - p.bet, seat.stack);
  const maxTo = p.bet + seat.stack;
  const othersCanAct = h.players.some((q, j) => j !== i && q && !q.folded && !q.allIn);
  const canRaise = h.raises < MAX_RAISES && maxTo > h.currentBet && othersCanAct;
  const options = [{ action: 'FOLD', to: p.bet, cost: 0 }];
  if (toCall === 0) options.push({ action: 'CHECK', to: p.bet, cost: 0 });
  else options.push({ action: 'CALL', to: p.bet + toCall, cost: toCall, allIn: toCall >= seat.stack });
  if (canRaise) {
    const floor = h.currentBet + ante;
    const sizes = h.currentBet === 0
      ? [['BBING', ante], ['QUARTER', ceilTo(pot / 4, unit)], ['HALF', ceilTo(pot / 2, unit)]]
      : [['DDADANG', 2 * h.currentBet], ['QUARTER', h.currentBet + ceilTo((pot + toCall) / 4, unit)], ['HALF', h.currentBet + ceilTo((pot + toCall) / 2, unit)]];
    const seen = new Set();
    for (const [action, raw] of sizes) {
      const to = Math.min(maxTo, Math.max(floor, raw));
      if (seen.has(to)) continue;
      seen.add(to);
      options.push({ action, to, cost: to - p.bet, allIn: to === maxTo });
    }
  }
  return { phase: 'BET', toCall, canCheck: toCall === 0, currentBet: h.currentBet, pot, raises: h.raises, maxRaises: MAX_RAISES, options };
}

// action: { type: 'OPEN', index } while choosing, else { type: 'FOLD'|'CHECK'|'CALL'|'BBING'|'DDADANG'|'QUARTER'|'HALF' }.
export function applyAction(table, i, action) {
  const h = table.hand;
  if (!h || h.over) throw new Error('HAND_NOT_ACTIVE');
  if (action?.type === 'OPEN') return chooseOpen(table, i, action.index);
  if (h.phase !== 'BET') throw new Error('CHOOSE_FIRST');
  if (h.toAct !== i) throw new Error('NOT_YOUR_TURN');
  const legal = legalActions(table, i);
  const type = action?.type === 'DIE' ? 'FOLD' : action?.type;
  const opt = legal.options.find(o => o.action === type);
  if (!opt) throw new Error(type === 'CHECK' ? 'CANNOT_CHECK' : 'INVALID_ACTION');
  const seat = table.seats[i], p = h.players[i];
  if (type === 'FOLD') {
    p.folded = true;
    emit(table, { t: 'act', seat: i, action: 'FOLD' });
  } else if (type === 'CHECK') {
    emit(table, { t: 'act', seat: i, action: 'CHECK' });
  } else {
    const before = h.currentBet;
    seat.stack -= opt.cost; p.bet += opt.cost; p.committed += opt.cost;
    if (seat.stack === 0) p.allIn = true;
    if (p.bet > before) {
      h.currentBet = p.bet;
      h.raises += 1;
      h.players.forEach((q, j) => { if (q && j !== i) q.acted = false; });
    }
    emit(table, { t: 'act', seat: i, action: p.allIn ? 'ALL_IN' : type, kind: type, amount: opt.cost, bet: p.bet, stack: seat.stack });
  }
  p.acted = true;
  h.seq += 1;
  advance(table, i);
  return table;
}

// Takes a seat out of the hand whether or not it is their turn (a player leaving the table).
export function foldOut(table, i) {
  const h = table.hand;
  if (!h || h.over || !inHand(h, i)) return table;
  if (h.phase === 'BET' && h.toAct === i) return applyAction(table, i, { type: 'FOLD' });
  h.players[i].folded = true;
  h.seq += 1;
  emit(table, { t: 'act', seat: i, action: 'FOLD' });
  if (h.phase === 'CHOOSE') {
    if (settleIfDone(table)) return table;
    if (h.players.every(q => !q || q.folded || q.chosen)) { h.phase = 'BET'; emit(table, { t: 'open', cards: h.players.map((q, j) => (q && !q.folded ? { seat: j, card: cardText(q.cards[2]), from: q.openFrom } : null)).filter(Boolean) }); nextStreet(table); }
    return table;
  }
  settleIfDone(table);
  return table;
}

const streetDone = h => h.players.every(p => !p || p.folded || p.allIn || (p.acted && p.bet === h.currentBet));

function collect(table) {
  const h = table.hand;
  const bets = h.players.map(p => (p ? p.bet : 0));
  if (bets.some(Boolean)) emit(table, { t: 'collect', bets, pot: potTotal(table) });
  h.players.forEach(p => { if (p) { p.bet = 0; p.acted = false; } });
  h.currentBet = 0;
  h.raises = 0;
}

function dealStreet(table) {
  const h = table.hand;
  h.street += 1;
  const up = UP_AT[h.street - 1];
  const dealt = [];
  // Round the table from the lead of the last street (or seat 0), one card each.
  for (let k = 0; k < n(table); k++) {
    const i = (Math.max(0, h.lead) + k) % n(table);
    if (!inHand(h, i)) continue;
    const c = h.deck.pop();
    h.players[i].cards.push(c);
    h.players[i].up.push(up);
    dealt.push({ seat: i, card: up ? cardText(c) : 'HIDDEN' });
  }
  const lead = leadSeat(table);
  if (lead >= 0) h.lead = lead;
  const names = {};
  h.players.forEach((p, i) => { if (inHand(h, i)) names[i] = showing(upCards(p)).name; });
  emit(table, { t: 'street', street: h.street, up, cards: dealt, lead, showing: names });
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
  if (h.street === 7) return showdown(table);
  dealStreet(table);
  const actors = h.players.filter(p => p && !p.folded && !p.allIn).length;
  if (actors < 2) return nextStreet(table); // nobody left to bet against: deal the rest out
  h.toAct = h.lead;
  emit(table, { t: 'turn', seat: h.toAct });
}

// Ends the hand when one player is left, or deals the rest out when nobody can bet any more.
function settleIfDone(table) {
  const h = table.hand;
  const remaining = h.players.map((p, i) => i).filter(i => inHand(h, i));
  if (remaining.length === 1) {
    collect(table);
    award(table, [{ amount: potTotal(table), eligible: remaining }], null);
    return true;
  }
  if (h.phase !== 'BET') return false;
  const actors = remaining.filter(i => !h.players[i].allIn);
  if (actors.length === 0 || (actors.length === 1 && h.players[actors[0]].bet >= h.currentBet && streetDone(h))) {
    nextStreet(table);
    return true;
  }
  return false;
}

function showdown(table) {
  const h = table.hand;
  const shown = new Map();
  const from = Math.max(0, h.lead);
  for (let k = 0; k < n(table); k++) {
    const i = (from + k) % n(table);
    if (!inHand(h, i)) continue;
    const ev = evaluate(h.players[i].cards);
    shown.set(i, ev);
    emit(table, { t: 'show', seat: i, cards: h.players[i].cards.map(cardText), hand: ev.name });
  }
  award(table, buildPots(h.players), shown);
}

function award(table, pots, shown) {
  const h = table.hand;
  const won = table.seats.map(() => 0);
  const winners = [];
  const from = Math.max(0, h.lead);
  const order = i => (i - from + n(table)) % n(table);
  pots.forEach((pot, index) => {
    let best = pot.eligible;
    if (shown && pot.eligible.length > 1) {
      const top = Math.max(...pot.eligible.map(i => shown.get(i).score));
      best = pot.eligible.filter(i => shown.get(i).score === top);
    }
    const unit = table.unit || 1;
    const share = Math.floor(pot.amount / best.length / unit) * unit;
    let odd = pot.amount - share * best.length;
    // Odd units go to the winners nearest the lead.
    for (const i of [...best].sort((a, b) => order(a) - order(b))) {
      const extra = Math.min(odd, unit);
      const amount = share + extra;
      odd -= extra;
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

// What a given seat may see: everyone's open cards, its own hidden ones, and every hand shown
// at showdown. `up` marks which of a seat's cards lie face up on the table.
export function publicTable(table, viewer = -1) {
  const h = table.hand;
  const shownSeats = new Set(h ? h.events.filter(e => e.t === 'show').map(e => e.seat) : []);
  return {
    handNo: table.handNo, ante: table.ante, button: -1, board: [],
    street: h?.street ?? null, phase: h ? (h.over ? 'OVER' : h.phase) : null, pot: potTotal(table),
    toAct: h && !h.over ? h.toAct : -1, lead: h?.lead ?? -1, seq: h?.seq ?? 0, handOver: h ? h.over : true,
    results: h?.results ?? null,
    seats: table.seats.map((s, i) => {
      const p = h?.players[i];
      const all = p && (i === viewer || shownSeats.has(i));
      // A chosen card stays face down to the others until everyone has chosen and they turn up together.
      const up = p ? p.up.map(u => u && (h.phase !== 'CHOOSE' || i === viewer)) : [];
      return {
        id: s.id, name: s.name, kind: s.kind, style: s.style, stack: s.stack,
        inHand: Boolean(p), folded: Boolean(p?.folded), allIn: Boolean(p?.allIn), bet: p?.bet ?? 0, committed: p?.committed ?? 0,
        chosen: Boolean(p?.chosen),
        cards: p ? p.cards.map((c, k) => (all || up[k] ? cardText(c) : 'HIDDEN')) : [],
        up,
        showing: p && !p.folded && h.phase !== 'CHOOSE' ? showing(upCards(p)).name : ''
      };
    }),
    legal: viewer >= 0 ? legalActions(table, viewer) : null
  };
}
