// 섯다 (two-card Seotda) for two seats. One card, a betting round, a second card, another
// betting round, then the showdown. Seats are plain objects so a friend can take seat 1 later;
// the AI decides from its own cards only.
import { SEOTDA_DECK, cardById, shuffle, defaultRng } from './hwatu.mjs';
import { id } from './state.mjs';

export const SEOTDA_ENGINE = 'SEOTDA_V1';
export const SEOTDA_MAX_RAISES = 2; // per betting round

const other = seat => 1 - seat;
const card = x => cardById(x);

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

// 1 when `a` wins, -1 when `b` wins, 0 for a split, 'REDEAL' when 구사 calls the hand off.
export function seotdaCompare(aIds, bIds) {
  const a = seotdaHand(aIds), b = seotdaHand(bIds);
  for (const [x, y] of [[a, b], [b, a]]) {
    if ((x.special === 'gusa' && y.rank <= 706) || (x.special === 'mgusa' && y.rank <= 809)) return 'REDEAL';
  }
  if (a.special === 'amhaeng' && b.rank === 900) return 1;
  if (b.special === 'amhaeng' && a.rank === 900) return -1;
  if (a.special === 'ttaengjabi' && b.rank >= 801 && b.rank <= 809) return 1;
  if (b.special === 'ttaengjabi' && a.rank >= 801 && a.rank <= 809) return -1;
  return a.rank > b.rank ? 1 : a.rank < b.rank ? -1 : 0;
}

// ---------- setup ----------
export function startSeotda({ stake, seats, rng = defaultRng, first = null }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  const deck = shuffle(SEOTDA_DECK.map(c => c.id), rng);
  const lead = first ?? rng(2);
  const round = {
    id: id('sd'), game: 'Seotda', engineVersion: SEOTDA_ENGINE, stake,
    seats: seats || [{ kind: 'human' }, { kind: 'ai', name: '하우스 AI' }],
    deck, hands: [[], []], contrib: [stake, stake], pot: stake * 2,
    first: lead, turn: lead, street: 1, toCall: 0, raises: 0, acted: [false, false],
    status: 'PLAYING', phase: 'BET', history: [], result: null, createdAt: new Date().toISOString()
  };
  for (const s of [lead, other(lead)]) round.hands[s].push(round.deck.pop());
  return round;
}

export function seotdaActor(round) { return round.status === 'PLAYING' ? round.turn : -1; }

const roundTo = (value, unit) => Math.max(unit, Math.ceil(value / unit) * unit);

// What each action would put in the pot for the seat to act.
export function seotdaOptions(round, seat) {
  if (seotdaActor(round) !== seat) return [];
  const unit = Math.max(1, Math.round(round.stake / 10));
  const call = round.toCall;
  const half = call + roundTo((round.pot + call) / 2, unit);
  const canRaise = round.raises < SEOTDA_MAX_RAISES;
  const out = [{ action: 'DIE', cost: 0 }];
  if (call === 0) {
    out.push({ action: 'CHECK', cost: 0 });
    if (canRaise) out.push({ action: 'BBING', cost: round.stake }, { action: 'HALF', cost: half });
  } else {
    out.push({ action: 'CALL', cost: call });
    if (canRaise) out.push({ action: 'HALF', cost: half });
  }
  return out;
}

export function seotdaActionCost(round, seat, action) {
  const opt = seotdaOptions(round, seat).find(o => o.action === action);
  if (!opt) throw new Error(seotdaActor(round) === seat ? 'INVALID_ACTION' : 'NOT_YOUR_TURN');
  return opt.cost;
}

export function seotdaAct(round, seat, action, events = []) {
  if (round.status !== 'PLAYING') throw new Error('ROUND_NOT_ACTIONABLE');
  const cost = seotdaActionCost(round, seat, action);
  round.contrib[seat] += cost;
  round.pot += cost;
  round.history.push({ street: round.street, seat, action, cost });
  events.push({ type: 'bet', seat, action, cost, pot: round.pot });
  if (action === 'DIE') return finish(round, other(seat), events, 'FOLD');
  round.acted[seat] = true;
  if (action === 'BBING' || action === 'HALF') {
    round.raises++;
    round.toCall = round.contrib[seat] - round.contrib[other(seat)];
    round.acted[other(seat)] = false;
  } else round.toCall = 0;
  if (round.acted[0] && round.acted[1] && round.toCall === 0) return nextStreet(round, events);
  round.turn = other(seat);
  events.push({ type: 'turn', seat: round.turn });
  return events;
}

function nextStreet(round, events) {
  if (round.street === 2) return showdown(round, events);
  round.street = 2;
  round.raises = 0;
  round.acted = [false, false];
  round.toCall = 0;
  for (const s of [round.first, other(round.first)]) {
    const c = round.deck.pop();
    round.hands[s].push(c);
    events.push({ type: 'deal', seat: s, card: c });
  }
  round.turn = round.first;
  events.push({ type: 'turn', seat: round.turn });
  return events;
}

function showdown(round, events) {
  const cmp = seotdaCompare(round.hands[0], round.hands[1]);
  events.push({ type: 'reveal', hands: round.hands.map(h => [...h]) });
  if (cmp === 'REDEAL') return finish(round, null, events, 'REDEAL');
  if (cmp === 0) return finish(round, null, events, 'TIE');
  return finish(round, cmp === 1 ? 0 : 1, events, 'SHOWDOWN');
}

function finish(round, winner, events, reason) {
  round.status = 'READY_TO_SETTLE';
  round.phase = 'ENDED';
  round.turn = -1;
  round.result = { winner, reason, pot: round.pot, hands: round.hands.map(h => (h.length === 2 ? seotdaHand(h).name : null)) };
  events.push({ type: 'end', result: round.result });
  return events;
}

// Net CH for the human in `seat`: the opponent's money when winning, own money when losing.
export function seotdaNet(round, seat = 0) {
  const r = round.result;
  if (!r || r.winner === null) return 0;
  return r.winner === seat ? round.contrib[other(seat)] : -round.contrib[seat];
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
  const s = strength(round.hands[seat]);
  const roll = rng(100) / 100;
  const opts = new Map(seotdaOptions(round, seat).map(o => [o.action, o]));
  const pressure = round.toCall / Math.max(1, round.pot);
  if (opts.has('CALL')) {
    if (opts.has('HALF') && s > 0.82 && roll < 0.6) return 'HALF';
    if (s < 0.2 + pressure * 0.5 && roll > 0.15) return 'DIE';
    return 'CALL';
  }
  if (opts.has('HALF') && (s > 0.75 || roll < 0.08)) return roll < 0.5 ? 'HALF' : 'BBING';
  if (opts.has('BBING') && s > 0.5 && roll < 0.5) return 'BBING';
  return 'CHECK';
}

export function runSeotdaAi(round, events = [], rng = defaultRng) {
  for (let guard = 0; guard < 20; guard++) {
    const seat = seotdaActor(round);
    if (seat < 0 || round.seats[seat].kind !== 'ai') break;
    seotdaAct(round, seat, seotdaAiDecision(round, seat, rng), events);
  }
  return events;
}

// ---------- views ----------
export function seotdaPublic(round, seat = 0) {
  const ended = round.status !== 'PLAYING';
  const showOpp = ended && round.result?.reason !== 'FOLD';
  const opp = other(seat);
  return {
    id: round.id, game: round.game, engineVersion: round.engineVersion, stake: round.stake,
    status: round.status, phase: round.phase, you: seat, turn: round.turn, street: round.street, first: round.first,
    seats: round.seats.map(s => ({ kind: s.kind, name: s.name || null })),
    hand: [...round.hands[seat]],
    handName: round.hands[seat].length === 2 ? seotdaHand(round.hands[seat]).name : null,
    opponent: showOpp ? [...round.hands[opp]] : round.hands[opp].map(() => 'HIDDEN'),
    pot: round.pot, contrib: [...round.contrib], toCall: seotdaActor(round) === seat ? round.toCall : 0,
    options: seotdaOptions(round, seat),
    history: round.history.map(h => ({ ...h })),
    result: round.result ? { ...round.result, hands: round.result.hands.map((x, i) => (i === seat || showOpp ? x : null)) } : null,
    netPnl: round.status === 'SETTLED' ? round.netPnl : null
  };
}
