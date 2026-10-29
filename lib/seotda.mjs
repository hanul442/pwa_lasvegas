// 섯다 (two-card Seotda) for 2–5 seats. Everyone antes, one card each, a betting round in turn
// order, a second card, another round, then the showdown among the seats still in. Seats are
// plain objects so friends can take any of them later; each AI decides from its own cards only.
import { SEOTDA_DECK, cardById, shuffle, defaultRng } from './hwatu.mjs';
import { id } from './state.mjs';
import { MONEY_UNIT, isMoney, roundMoney, aiSkillFor } from './constants.mjs';

export const SEOTDA_ENGINE = 'SEOTDA_V2';
export const SEOTDA_MAX_RAISES = 2; // per betting round
export const SEOTDA_MIN_SEATS = 2, SEOTDA_MAX_SEATS = 5;
const MAX_REDEALS = 3; // after this many 구사 calls the live seats split the pot

// Opponents in seat order. Temperaments nudge how loose, pushy and bluffy each one plays.
export const SEOTDA_AI = [
  { name: '박사장', temper: 'bold' },
  { name: '김여사', temper: 'tight' },
  { name: '타짜 정', temper: 'tricky' },
  { name: '막내', temper: 'loose' }
];
const TEMPER = {
  bold: { loose: 0.05, aggr: 0.1, bluff: 0.1 },
  tight: { loose: -0.08, aggr: -0.05, bluff: 0.02 },
  tricky: { loose: 0, aggr: 0.04, bluff: 0.18 },
  loose: { loose: 0.12, aggr: 0, bluff: 0.06 },
  calm: { loose: 0, aggr: 0, bluff: 0.06 }
};

const card = x => cardById(x);
const count = round => round.hands.length;
const live = round => round.folded.map((f, s) => (f ? -1 : s)).filter(s => s >= 0);
const high = round => Math.max(...live(round).map(s => round.contrib[s]));

// Rounds saved by the two-seat engine carry no `folded`; everything else maps across as is.
function normalize(round) {
  if (!round.folded) round.folded = round.hands.map(() => false);
  if (!round.allin) round.allin = round.hands.map(() => false);
  if (!round.acted || round.acted.length !== count(round)) round.acted = round.hands.map((_, s) => Boolean(round.acted?.[s]));
  round.redeals ??= 0;
  return round;
}

// ---------- hand ranking ----------
const NAMED_PAIRS = [[1, 2, '알리', 706], [1, 4, '독사', 705], [1, 9, '구삥', 704], [1, 10, '장삥', 703], [4, 10, '장사', 702], [4, 6, '세륙', 701]];

export function seotdaHand(ids) {
  const [a, b] = ids.map(card);
  const lo = Math.min(a.month, b.month), hi = Math.max(a.month, b.month);
  const has = x => ids.includes(x);
  const gwang = a.kind === 'gwang' && b.kind === 'gwang';
  if (gwang && lo === 3 && hi === 8) return { rank: 1000, name: '38광땡' };
  if (gwang && (lo === 1 && (hi === 3 || hi === 8))) return { rank: 900, name: `${lo}${hi}광땡` };
  if (lo === hi) return { rank: 800 + lo, name: lo === 10 ? '장땡' : `${lo}땡` };
  if (has('04-1') && has('07-1')) return { rank: 601, name: '암행어사', special: 'amhaeng' };
  if (has('03-1') && has('07-1')) return { rank: 600, name: '땡잡이', special: 'ttaengjabi' };
  if (lo === 4 && hi === 9) return has('04-1') && has('09-1') ? { rank: 603, name: '멍텅구리구사', special: 'mgusa' } : { rank: 603, name: '구사', special: 'gusa' };
  const named = NAMED_PAIRS.find(([x, y]) => x === lo && y === hi);
  if (named) return { rank: named[3], name: named[2] };
  const kkut = (a.month + b.month) % 10;
  return { rank: 600 + kkut, name: kkut === 0 ? '망통' : kkut === 9 ? '갑오' : `${kkut}끗` };
}

// Settles a table of two-card hands (null for a seat that is out). Returns { redeal: true } when
// a 구사 calls the hand off, otherwise the winning seat indices (several on a split).
// 땡잡이 only catches when the best hand on the table is 1~9땡, 암행어사 only a 13·18광땡.
export function seotdaShowdown(hands, { redeal = true } = {}) {
  const rated = hands.map(h => (h ? seotdaHand(h) : null));
  const seats = rated.map((h, s) => (h ? s : -1)).filter(s => s >= 0);
  const bestOther = s => Math.max(0, ...seats.filter(o => o !== s).map(o => rated[o].rank));
  for (const s of redeal ? seats : []) {
    const h = rated[s], top = bestOther(s);
    if ((h.special === 'gusa' && top <= 706) || (h.special === 'mgusa' && top <= 809)) return { redeal: true, seat: s };
  }
  const top = Math.max(...seats.map(s => rated[s].rank));
  const eff = h => (h.special === 'ttaengjabi' && top >= 801 && top <= 809 ? 809.5 : h.special === 'amhaeng' && top === 900 ? 950 : h.rank);
  const best = Math.max(...seats.map(s => eff(rated[s])));
  return { redeal: false, winners: seats.filter(s => eff(rated[s]) === best) };
}

// 1 when `a` wins, -1 when `b` wins, 0 for a split, 'REDEAL' when 구사 calls the hand off.
export function seotdaCompare(aIds, bIds) {
  const r = seotdaShowdown([aIds, bIds]);
  if (r.redeal) return 'REDEAL';
  return r.winners.length === 2 ? 0 : r.winners[0] === 0 ? 1 : -1;
}

// ---------- setup ----------
export function seotdaSeats(players = 4, human = { kind: 'human' }) {
  const n = Number(players);
  if (!Number.isInteger(n) || n < SEOTDA_MIN_SEATS || n > SEOTDA_MAX_SEATS) throw new Error('INVALID_PLAYERS');
  return [human, ...SEOTDA_AI.slice(0, n - 1).map(a => ({ kind: 'ai', ...a }))];
}

export function startSeotda({ stake, seats, rng = defaultRng, first = null, events = [] }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  seats = seats || seotdaSeats(2);
  const n = seats.length;
  if (n < SEOTDA_MIN_SEATS || n > SEOTDA_MAX_SEATS) throw new Error('INVALID_PLAYERS');
  const lead = Number.isInteger(first) && first >= 0 && first < n ? first : rng(n);
  const round = {
    id: id('sd'), game: 'Seotda', engineVersion: SEOTDA_ENGINE, stake, players: n, seats,
    deck: [], hands: seats.map(() => []), contrib: seats.map(() => stake), folded: seats.map(() => false), allin: seats.map(() => false), pot: stake * n,
    first: lead, turn: lead, street: 1, raises: 0, acted: seats.map(() => false), redeals: 0,
    status: 'PLAYING', phase: 'BET', history: [], result: null, createdAt: new Date().toISOString()
  };
  dealFirst(round, rng, events);
  return round;
}

// Seats from `from` round the table, skipping the ones who folded.
const order = (round, from) => Array.from({ length: count(round) }, (_, i) => (from + i) % count(round)).filter(s => !round.folded[s]);

function dealFirst(round, rng, events) {
  round.deck = shuffle(SEOTDA_DECK.map(c => c.id), rng);
  round.hands = round.hands.map(() => []);
  for (const s of order(round, round.first)) {
    const c = round.deck.pop();
    round.hands[s].push(c);
    events.push({ type: 'deal', seat: s, card: c, street: 1 });
  }
  return passTurn(round, round.first, events, rng);
}

export function seotdaActor(round) { return round.status === 'PLAYING' ? round.turn : -1; }
export function seotdaToCall(round, seat) { normalize(round); return round.folded[seat] ? 0 : high(round) - round.contrib[seat]; }

// What a seat can still put in: people bring their wallet (set by the caller as round.stacks
// before acting), the house AI never runs dry.
export const seotdaStack = (round, seat) => (Number.isFinite(round.stacks?.[seat]) ? Math.max(0, round.stacks[seat]) : Infinity);
// Seats still betting: in the hand and with chips behind.
const actors = round => live(round).filter(s => !round.allin[s]);

const roundTo = (value, unit) => Math.max(unit, Math.ceil(value / unit) * unit);

// What each action would put in the pot for the seat to act.
export function seotdaOptions(round, seat) {
  if (seotdaActor(round) !== seat) return [];
  // Raises move in tenths of the stake, never less than 100만 at a real table.
  const unit = isMoney(round.stake) ? Math.max(MONEY_UNIT, roundMoney(round.stake / 10)) : Math.max(1, Math.round(round.stake / 10));
  const call = seotdaToCall(round, seat);
  const half = call + roundTo((round.pot + call) / 2, unit);
  const stack = seotdaStack(round, seat);
  // A raise only means something while someone else can still answer it.
  const canRaise = round.raises < SEOTDA_MAX_RAISES && actors(round).some(s => s !== seat);
  const out = [{ action: 'DIE', cost: 0 }];
  // Short of the call: 다이 or 올인 with what is left (the rest of the pot goes to a side pot).
  if (call > 0 && stack <= call) return stack > 0 ? [...out, { action: 'ALLIN', cost: stack }] : out;
  if (call === 0) {
    out.push({ action: 'CHECK', cost: 0 });
    if (canRaise) out.push({ action: 'BBING', cost: round.stake }, { action: 'HALF', cost: half });
  } else {
    // 따당: call and put the same again (twice what was bet in front of me).
    out.push({ action: 'CALL', cost: call });
    if (canRaise) out.push({ action: 'DDADANG', cost: call * 2 }, { action: 'HALF', cost: Math.max(half, call * 2) });
  }
  if (!Number.isFinite(stack)) return out;
  // Bets past the wallet turn into one 올인 for everything left.
  const fits = out.filter(o => o.cost <= stack);
  if (fits.length < out.length && canRaise && stack > call) fits.push({ action: 'ALLIN', cost: stack });
  return fits;
}

export function seotdaActionCost(round, seat, action) {
  const opt = seotdaOptions(round, seat).find(o => o.action === action);
  if (!opt) throw new Error(seotdaActor(round) === seat ? 'INVALID_ACTION' : 'NOT_YOUR_TURN');
  return opt.cost;
}

const RAISES = new Set(['BBING', 'DDADANG', 'HALF']);

export function seotdaAct(round, seat, action, events = [], rng = defaultRng) {
  if (round.status !== 'PLAYING') throw new Error('ROUND_NOT_ACTIONABLE');
  normalize(round);
  const cost = seotdaActionCost(round, seat, action);
  round.contrib[seat] += cost;
  round.pot += cost;
  const before = high(round);
  round.history.push({ street: round.street, seat, action, cost });
  if (cost > 0 && cost >= seotdaStack(round, seat)) round.allin[seat] = true;
  if (cost > 0 && Number.isFinite(round.stacks?.[seat])) round.stacks[seat] -= cost;
  events.push({ type: 'bet', seat, action, cost, pot: round.pot, contrib: round.contrib[seat] });
  if (action === 'DIE') {
    round.folded[seat] = true;
    const left = live(round);
    if (left.length === 1) return finish(round, left, events, 'FOLD');
  } else {
    round.acted[seat] = true;
    if (RAISES.has(action) || (action === 'ALLIN' && round.contrib[seat] > before)) {
      round.raises++;
      for (const s of live(round)) if (s !== seat) round.acted[s] = false;
    }
  }
  return passTurn(round, seat + 1, events, rng);
}

// The next seat that still owes a bet, from `from` round the table. With nobody left who can
// bet against anyone (everyone else all in), the cards just run out to the showdown.
function passTurn(round, from, events, rng) {
  const top = high(round);
  const next = order(round, from).find(s => !round.allin[s] && (!round.acted[s] || round.contrib[s] < top));
  if (next === undefined || (actors(round).length <= 1 && round.contrib[next] >= top)) return nextStreet(round, events, rng);
  round.turn = next;
  events.push({ type: 'turn', seat: next });
  return events;
}

function nextStreet(round, events, rng) {
  if (round.street === 2) return showdown(round, events, rng);
  round.street = 2;
  round.raises = 0;
  round.acted = round.acted.map(() => false);
  for (const s of order(round, round.first)) {
    const c = round.deck.pop();
    round.hands[s].push(c);
    events.push({ type: 'deal', seat: s, card: c, street: 2 });
  }
  return passTurn(round, round.first, events, rng);
}

function showdown(round, events, rng) {
  const hands = round.hands.map((h, s) => (round.folded[s] ? null : h));
  const r = seotdaShowdown(hands);
  events.push({ type: 'reveal', hands: hands.map(h => (h ? [...h] : null)), names: hands.map(h => (h ? seotdaHand(h).name : null)), redeal: r.redeal });
  if (!r.redeal) return finish(round, r.winners, events, r.winners.length > 1 ? 'TIE' : 'SHOWDOWN');
  if (round.redeals >= MAX_REDEALS) return finish(round, live(round), events, 'TIE', { callOff: true });
  // 재경기: the pot stays, the seats still in get fresh cards and bet again.
  round.redeals++;
  round.street = 1;
  round.raises = 0;
  round.acted = round.acted.map(() => false);
  events.push({ type: 'redeal', seat: r.seat, name: seotdaHand(round.hands[r.seat]).name, pot: round.pot });
  dealFirst(round, rng, events);
  return events;
}

function finish(round, winners, events, reason, { callOff = false } = {}) {
  round.status = 'READY_TO_SETTLE';
  round.phase = 'ENDED';
  round.turn = -1;
  // The pot is cut in layers at each all-in seat's level: a seat only wins the layers it paid
  // into all the way (메인 팟, then side pots). Without an all-in there is one layer, the whole pot.
  // Who takes a layer: the best hand among the seats in it, or everyone in it on a split call-off.
  const rank = reason !== 'FOLD' && !callOff;
  const best = seats => (rank ? seotdaShowdown(round.hands.map((h, x) => (seats.includes(x) ? h : null)), { redeal: false }).winners : seats);
  const payouts = round.hands.map(() => 0);
  const step = isMoney(round.pot) ? MONEY_UNIT : 1;
  const levels = [...new Set(live(round).map(s => round.contrib[s]))].sort((x, y) => x - y);
  let prev = 0;
  levels.forEach((level, i) => {
    const last = i === levels.length - 1;
    // Folded seats' money above the top live level (never expected) stays with the last layer.
    const layer = round.contrib.reduce((sum, c) => sum + Math.max(0, (last ? c : Math.min(c, level)) - prev), 0);
    const takers = best(live(round).filter(s => round.contrib[s] >= level));
    // Even shares in 100만s; the odd 100만s go to the first taker round the table from the lead.
    const share = Math.floor(layer / takers.length / step) * step;
    takers.forEach(s => { payouts[s] += share; });
    payouts[order(round, round.first).find(s => takers.includes(s)) ?? takers[0]] += layer - share * takers.length;
    prev = level;
  });
  const shown = reason !== 'FOLD';
  round.result = {
    winner: winners.length === 1 ? winners[0] : null, winners: [...winners], reason, pot: round.pot, payouts,
    hands: round.hands.map((h, s) => (shown && h.length === 2 && !round.folded[s] ? seotdaHand(h).name : null))
  };
  events.push({ type: 'end', result: round.result });
  return events;
}

// 선 for the next hand: the last winner (the first winner round the table on a split), and the
// same 선 again when nobody won.
export const seotdaNextLead = round => {
  const r = round?.result;
  if (!r) return null;
  return r.winners?.length ? order(round, round.first).find(s => r.winners.includes(s)) ?? r.winners[0] : round.first;
};

// What `seat` takes from the pot minus what it put in. The house never takes a cut.
export function seotdaNet(round, seat = 0) {
  const r = round.result;
  if (!r) return 0;
  return (r.payouts?.[seat] ?? 0) - round.contrib[seat];
}

// ---------- AI ----------
function strength(ids) {
  if (ids.length === 1) {
    const c = card(ids[0]);
    return Math.min(1, (c.kind === 'gwang' ? 0.55 : 0.25) + c.month / 40 + (c.month === 10 ? 0.15 : 0));
  }
  const h = seotdaHand(ids);
  if (h.rank >= 900) return 1;
  if (h.rank >= 801) return 0.8 + (h.rank - 800) / 60;
  if (h.rank >= 701) return 0.7 + (h.rank - 700) / 60;
  if (h.special === 'amhaeng' || h.special === 'ttaengjabi' || h.special?.includes('gusa')) return 0.5;
  return 0.15 + (h.rank - 600) * 0.055;
}

export function seotdaAiDecision(round, seat, rng = defaultRng) {
  normalize(round);
  const t = TEMPER[round.seats[seat]?.temper] || TEMPER.calm;
  const rivals = live(round).length - 1;
  // Each extra rival still in makes a middling hand worth less.
  // Low floors misjudge their hands both ways; high floors read them true.
  const sloppy = 1 - aiSkillFor(round);
  const misread = sloppy > 0 ? (rng(100) / 100 - 0.5) * 0.4 * sloppy : 0;
  const s = strength(round.hands[seat]) - 0.05 * Math.max(0, rivals - 1) + t.loose + misread;
  const roll = rng(100) / 100;
  const opts = new Map(seotdaOptions(round, seat).map(o => [o.action, o]));
  const pressure = seotdaToCall(round, seat) / Math.max(1, round.pot);
  if (opts.has('CALL')) {
    if (opts.has('HALF') && s > 0.82 - t.aggr && roll < 0.6) return roll < 0.25 ? 'DDADANG' : 'HALF';
    if (s < 0.2 + pressure * 0.5 && roll > 0.15 + t.bluff) return 'DIE';
    return 'CALL';
  }
  if (opts.has('HALF') && (s > 0.75 - t.aggr || roll < t.bluff)) return roll < 0.5 ? 'HALF' : 'BBING';
  if (opts.has('BBING') && s > 0.5 - t.aggr && roll < 0.5) return 'BBING';
  return 'CHECK';
}

export function runSeotdaAi(round, events = [], rng = defaultRng) {
  for (let guard = 0; guard < 400; guard++) {
    const seat = seotdaActor(round);
    if (seat < 0 || round.seats[seat]?.kind !== 'ai') break;
    seotdaAct(round, seat, seotdaAiDecision(round, seat, rng), events, rng);
  }
  return events;
}

// ---------- views ----------
export function seotdaPublic(round, seat = 0) {
  normalize(round);
  const ended = round.status !== 'PLAYING';
  const shown = s => s === seat || (ended && Boolean(round.result?.hands?.[s]) && round.result.reason !== 'FOLD');
  const last = s => [...round.history].reverse().find(h => h.seat === s) || null;
  return {
    id: round.id, game: round.game, engineVersion: round.engineVersion, stake: round.stake,
    status: round.status, phase: round.phase, you: seat, turn: round.turn, street: round.street, first: round.first, redeals: round.redeals,
    seats: round.seats.map(s => ({ kind: s.kind, name: s.name || null, temper: s.temper || null })),
    players: round.seats.map((s, i) => ({
      kind: s.kind, name: s.name || null, contrib: round.contrib[i], folded: round.folded[i], allin: round.allin[i],
      cards: shown(i) ? [...round.hands[i]] : round.hands[i].map(() => 'HIDDEN'),
      handName: shown(i) && round.hands[i].length === 2 ? seotdaHand(round.hands[i]).name : null,
      last: last(i) && { action: last(i).action, cost: last(i).cost, street: last(i).street }
    })),
    hand: [...round.hands[seat]],
    handName: round.hands[seat].length === 2 ? seotdaHand(round.hands[seat]).name : null,
    pot: round.pot, contrib: [...round.contrib], toCall: seotdaActor(round) === seat ? seotdaToCall(round, seat) : 0,
    options: seotdaOptions(round, seat),
    history: round.history.map(h => ({ ...h })),
    result: round.result ? { ...round.result, hands: round.result.hands.map((x, i) => (shown(i) ? x : null)) } : null,
    netPnl: round.status === 'SETTLED' ? round.netPnl : null
  };
}
