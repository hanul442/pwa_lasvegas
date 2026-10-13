// Friends' rooms for 섯다 (2–5 seats), 고스톱 (3), 맞고 (2) and blackjack (2–4 against one dealer). A room has a
// four-letter code, a host who picks the 판돈/점당 and how many seats, and house AI in every seat
// nobody took. Each hand is one ordinary engine round with people in some seats: every person's
// ante or deposit is locked when the hand is dealt and settled through the ledger when it ends,
// exactly like the solo table, so the money a friend wins is money the other friend lost.
// A Worker has no timers, so the room moves lazily, the way Hold'em rooms do: any read or command
// first plays the AI seats, runs out a person's turn clock and deals the next hand when it is due.
// Every view is turned so the viewer sits in seat 0, which is where the solo screens draw "me".
import { id } from './state.mjs';
import { stakeTierFor, FLOORS } from './constants.mjs';
import { lockBet, increaseBetLock, settleLockedHouseGame } from './economy.mjs';
import { SEOTDA_ENGINE, SEOTDA_AI, SEOTDA_MIN_SEATS, SEOTDA_MAX_SEATS, startSeotda, seotdaActor, seotdaActionCost, seotdaOptions, seotdaAct, seotdaAiDecision, seotdaNet, seotdaPublic } from './seotda.mjs';
import { GOSTOP_ENGINE, GOSTOP_SEATS, GOSTOP_DEPOSIT_POINTS, GOSTOP_AI_NAMES, startGostop, gostopPublic, gostopNet } from './gostop.mjs';
import { BLACKJACK_ROOM_ENGINE, blackjackRoomAi, startBlackjackRoom, blackjackRoomActor, blackjackRoomCost, blackjackRoomAct, blackjackRoomBot, blackjackRoomNet, blackjackRoomPublic } from './blackjack-room.mjs';
import { MATGO_ENGINE, MATGO_DEPOSIT_POINTS, startMatgo, matgoActor, matgoAct, matgoAiDecision, matgoPublic, matgoNet } from './matgo.mjs';

export const TURN_MS = 25_000;
export const NEXT_HAND_MS = 7_000;
export const MISSED_TURNS_LIMIT = 3; // turns run out in a row before the table stands someone up
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- seat rotation ----------
// rot(arr, k)[j] is arr[k + j]: seat k becomes seat 0 and everyone keeps their order round the table.
const rot = (arr, k) => arr.map((_, j) => arr[(j + k) % arr.length]);
const turnSeat = (k, n) => s => (Number.isInteger(s) && s >= 0 ? (s - k + n) % n : s);

function rotateSeotdaResult(r, k, n) {
  if (!r) return r;
  const m = turnSeat(k, n);
  return { ...r, winner: m(r.winner), winners: r.winners.map(m), payouts: rot(r.payouts, k), hands: rot(r.hands, k) };
}
function rotateSeotda(round, k) {
  const n = round.hands.length, m = turnSeat(k, n);
  const r = structuredClone(round);
  for (const key of ['hands', 'contrib', 'folded', 'acted', 'seats']) if (Array.isArray(round[key])) r[key] = rot(round[key], k);
  r.first = m(round.first);
  r.turn = m(round.turn);
  r.history = round.history.map(h => ({ ...h, seat: m(h.seat) }));
  r.result = rotateSeotdaResult(round.result, k, n);
  return r;
}

function rotateGoResult(r, k, n) {
  if (!r) return r;
  const m = turnSeat(k, n);
  const out = { ...r, winner: m(r.winner) };
  if ('gobak' in r) out.gobak = m(r.gobak);
  if (r.shares) out.shares = r.shares.map(x => ({ ...x, seat: m(x.seat), payer: m(x.payer) }));
  return out;
}
function rotateGo(round, k) {
  const n = round.hands.length, m = turnSeat(k, n);
  const r = structuredClone(round);
  for (const key of ['hands', 'captured', 'goCount', 'goScore', 'shakes', 'seats']) r[key] = rot(round[key], k);
  if (round.opening) r.opening.hands = rot(round.opening.hands, k);
  r.goAt = Object.fromEntries(Object.entries(round.goAt || {}).map(([s, v]) => [m(Number(s)), v]));
  r.ppeok = Object.fromEntries(Object.entries(round.ppeok || {}).map(([month, s]) => [month, m(s)]));
  r.turn = m(round.turn);
  r.first = m(round.first);
  if (r.pending && 'seat' in r.pending) r.pending.seat = m(round.pending.seat);
  r.result = rotateGoResult(round.result, k, n);
  return r;
}

function rotateBlackjack(round, k) {
  if (!k) return round;
  const n = round.seats.length;
  const r = { ...round, seats: rot(round.seats, k), players: rot(round.players, k), turn: turnSeat(k, n)(round.turn) };
  if (round.result) r.result = { ...round.result, nets: rot(round.result.nets, k) };
  return r;
}

const intRng = rand => max => Math.min(max - 1, Math.floor(rand() * max));
const goMove = body => ({ type: body.type, card: body.card, target: body.target, month: body.month, shake: Boolean(body.shake) });

// ---------- the games ----------
// deposit: what each person locks when a hand is dealt. cost: what a move adds on top of it.
// bot: the house AI's move for a seat, deciding from that seat's own view. timeout: the move made
// for a person whose clock ran out (never one that costs money).
const GAMES = {
  seotda: {
    game: 'Seotda', engine: SEOTDA_ENGINE, min: SEOTDA_MIN_SEATS, max: SEOTDA_MAX_SEATS, size: 4,
    deposit: stake => stake,
    ai: n => SEOTDA_AI.slice(0, n).map(a => ({ kind: 'ai', ...a })),
    start: (stake, seats, events, rng) => startSeotda({ stake, seats, events, rng }),
    actor: seotdaActor,
    move: body => ({ action: String(body.action ?? '') }),
    cost: (r, s, mv) => seotdaActionCost(r, s, mv.action),
    act: (r, s, mv, events, rng) => seotdaAct(r, s, mv.action, events, rng),
    bot: (r, s, rng) => ({ action: seotdaAiDecision(r, s, rng) }),
    timeout: (r, s) => ({ action: seotdaOptions(r, s).some(o => o.action === 'CHECK') ? 'CHECK' : 'DIE' }),
    away: () => ({ action: 'DIE' }),
    net: seotdaNet,
    // Only my own cards are dealt face up to me; the rest arrive as backs until the showdown.
    view: (r, s) => seotdaPublic(rotateSeotda(r, s), 0),
    event: (e, k, n) => {
      const m = turnSeat(k, n);
      const out = { ...e };
      if ('seat' in e) out.seat = m(e.seat);
      if (e.type === 'deal' && out.seat !== 0) out.card = 'HIDDEN';
      if (e.type === 'reveal') { out.hands = rot(e.hands, k); out.names = rot(e.names, k); }
      if (e.type === 'end') out.result = rotateSeotdaResult(e.result, k, n);
      return out;
    },
    details: r => ({ winners: r.result?.winners, reason: r.result?.reason, players: r.hands.length })
  },
  gostop: {
    game: 'Gostop', engine: GOSTOP_ENGINE, min: GOSTOP_SEATS, max: GOSTOP_SEATS, size: GOSTOP_SEATS,
    deposit: stake => stake * GOSTOP_DEPOSIT_POINTS,
    ai: n => GOSTOP_AI_NAMES.slice(0, n).map(name => ({ kind: 'ai', name })),
    start: (stake, seats, events, rng, double) => startGostop({ stake, seats, rng, double }),
    actor: matgoActor,
    move: goMove,
    cost: () => 0,
    act: (r, s, mv, events) => matgoAct(r, s, mv, events),
    bot: (r, s, rng) => matgoAiDecision(r, s, rng),
    timeout: (r, s, rng) => (r.phase === 'GO_STOP' ? { type: 'STOP' } : matgoAiDecision(r, s, rng)),
    net: gostopNet,
    view: (r, s) => gostopPublic(rotateGo(r, s), 0),
    event: goEvent,
    details: r => ({ points: r.result?.points ?? 0, reason: r.result?.reason, gobak: r.result?.gobak ?? null })
  },
  matgo: {
    game: 'Matgo', engine: MATGO_ENGINE, min: 2, max: 2, size: 2,
    deposit: stake => stake * MATGO_DEPOSIT_POINTS,
    ai: n => (n ? [{ kind: 'ai', name: '하우스 AI' }] : []),
    start: (stake, seats, events, rng, double) => startMatgo({ stake, seats, rng, double }),
    actor: matgoActor,
    move: goMove,
    cost: () => 0,
    act: (r, s, mv, events) => matgoAct(r, s, mv, events),
    bot: (r, s, rng) => matgoAiDecision(r, s, rng),
    timeout: (r, s, rng) => (r.phase === 'GO_STOP' ? { type: 'STOP' } : matgoAiDecision(r, s, rng)),
    net: matgoNet,
    view: (r, s) => matgoPublic(rotateGo(r, s), 0),
    event: goEvent,
    details: r => ({ points: r.result?.points ?? 0, reason: r.result?.reason })
  }
};
GAMES.blackjack = {
  game: 'Blackjack', engine: BLACKJACK_ROOM_ENGINE, min: 2, max: 4, size: 4,
  deposit: stake => stake,
  ai: (n, rng) => blackjackRoomAi(n, rng),
  start: (stake, seats, events, rng) => startBlackjackRoom({ stake, seats, events, rng }),
  actor: blackjackRoomActor,
  move: body => ({ action: String(body.action ?? '') }),
  cost: (r, s, mv) => blackjackRoomCost(r, s, mv.action),
  act: (r, s, mv, events) => blackjackRoomAct(r, s, mv.action, events),
  bot: (r, s, rng) => ({ action: blackjackRoomBot(r, s, () => rng(1000) / 1000) }),
  timeout: () => ({ action: 'STAND' }),
  away: () => ({ action: 'STAND' }),
  net: blackjackRoomNet,
  view: (r, s) => blackjackRoomPublic(rotateBlackjack(r, s), 0),
  event: (e, k, n) => {
    const out = { ...e };
    if ('seat' in e) out.seat = turnSeat(k, n)(e.seat);
    if (e.type === 'end') { out.nets = rot(e.nets, k); out.hands = rot(e.hands, k); }
    return out;
  },
  details: r => ({ dealer: r.result?.dealer })
};
GAMES.gostop.away = GAMES.gostop.timeout;
GAMES.matgo.away = GAMES.matgo.timeout;
export const ROOM_GAMES = Object.keys(GAMES);

function goEvent(e, k, n) {
  const m = turnSeat(k, n);
  const out = { ...e };
  if ('seat' in e) out.seat = m(e.seat);
  if ('from' in e) out.from = m(e.from);
  if (e.type === 'end') out.result = rotateGoResult(e.result, k, n);
  return out;
}

// ---------- rooms ----------
const rooms = state => (Array.isArray(state.tableRooms) ? state.tableRooms : (state.tableRooms = []));
const openRooms = state => (Array.isArray(state.tableRooms) ? state.tableRooms : []).filter(r => r.status === 'OPEN');
export const normalizeCode = code => String(code ?? '').trim().toUpperCase();
const people = room => Object.values(room.players);
const handLive = room => Boolean(room.round && room.round.status === 'PLAYING');

export function findRoom(state, code, game = null) {
  const room = openRooms(state).find(r => r.code === normalizeCode(code) && (!game || r.game === game));
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}
export const tableRoomOf = (state, userId) => openRooms(state).find(r => r.players[userId]) || null;

function newCode(state, rand) {
  const taken = new Set([...openRooms(state), ...(Array.isArray(state.holdemRooms) ? state.holdemRooms : [])].map(r => r.code));
  for (let tries = 0; tries < 200; tries++) {
    let code = '';
    for (let k = 0; k < 4; k++) code += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
    if (!taken.has(code)) return code;
  }
  throw new Error('ROOM_CODE_EXHAUSTED');
}

// One table at a time: a friends' room of any kind, or the solo game of the same name.
// The error says which room holds the seat, so the screen can offer to go back there or leave it.
export const seatedElsewhere = (game, room) => Object.assign(new Error('ALREADY_IN_ROOM'), { where: { game, code: room.code, tier: room.tier } });
function assertCanSit(state, user, spec) {
  const mine = tableRoomOf(state, user.id);
  if (mine) throw seatedElsewhere(mine.game, mine);
  const holdem = (Array.isArray(state.holdemRooms) ? state.holdemRooms : []).find(r => r.status === 'OPEN' && r.players[user.id]);
  if (holdem) throw seatedElsewhere('holdem', holdem);
  if (state.rounds.some(r => r.userId === user.id && r.game === spec.game && r.status !== 'SETTLED')) throw new Error('OPEN_SOLO_ROUND');
}

function addPlayer(room, user, now) {
  room.players[user.id] = { userId: user.id, nickname: user.nickname, seat: -1, missed: 0, joinedAt: now, order: room.joins++ };
}

// ctx: { now, rand, validateStake(user, floor, stake) }
export function createRoom(state, user, { game, stake, floor, size }, ctx) {
  const spec = GAMES[game];
  if (!spec) throw new Error('UNKNOWN_GAME');
  assertCanSit(state, user, spec);
  const seats = Number(size ?? spec.size);
  if (!(Number.isInteger(seats) && seats >= spec.min && seats <= spec.max)) throw new Error('INVALID_ROOM_SIZE');
  ctx.validateStake(user, floor, stake);
  if (user.account.available < spec.deposit(stake)) throw new Error('INSUFFICIENT_BANKROLL');
  const room = {
    id: id('trm'), code: newCode(state, ctx.rand || Math.random), game, floor, tier: stakeTierFor(stake)?.slug ?? null, stake, size: seats,
    hostId: user.id, status: 'OPEN', started: false, createdAt: new Date(ctx.now).toISOString(),
    players: {}, joins: 0, handNo: 0, round: null, events: [], prev: null, turn: null, nextAt: null
  };
  addPlayer(room, user, ctx.now);
  rooms(state).push(room);
  return room;
}

export function joinRoom(state, user, code, ctx) {
  const room = findRoom(state, code);
  const spec = GAMES[room.game];
  if (room.players[user.id]) return room;
  assertCanSit(state, user, spec);
  if (people(room).length >= room.size) throw new Error('ROOM_FULL');
  // Friends sit together whatever floors each has reached or outgrown; only the chips count.
  if (user.account.available < spec.deposit(room.stake)) throw new Error('INSUFFICIENT_BANKROLL');
  addPlayer(room, user, ctx.now);
  tick(state, room, ctx);
  return room;
}

export function startRoom(state, user, code, ctx) {
  const room = findRoom(state, code);
  if (room.hostId !== user.id) throw new Error('NOT_HOST');
  if (room.started) throw new Error('HAND_IN_PROGRESS');
  room.started = true;
  room.nextAt = ctx.now;
  tick(state, room, ctx);
  return room;
}

// Getting up between hands costs nothing. Mid-hand the seat is played out for the person who
// left (섯다 dies at its next turn, 고스톱 and 맞고 play on automatically) and settled when the
// hand ends, so nobody can walk away from a pot they are losing.
export function leaveRoom(state, user, code, ctx) {
  const room = findRoom(state, code);
  const p = room.players[user.id];
  if (!p) throw new Error('NOT_IN_ROOM');
  let pending = false;
  if (handLive(room) && p.seat >= 0 && room.round.seats[p.seat]?.userId === user.id) {
    room.round.seats[p.seat].kind = 'away';
    pending = true;
  }
  removePlayer(state, room, user.id);
  tick(state, room, ctx);
  return { room, pending };
}

function removePlayer(state, room, userId) {
  delete room.players[userId];
  if (room.hostId === userId) room.hostId = [...people(room)].sort((a, b) => a.order - b.order)[0]?.userId ?? null;
}

function closeIfEmpty(state, room) {
  if (people(room).length || handLive(room)) return false;
  room.status = 'CLOSED';
  state.tableRooms = rooms(state).filter(r => r !== room);
  return true;
}

export function roomAction(state, user, code, { handNo, seq, ...body }, ctx) {
  const room = findRoom(state, code);
  const p = room.players[user.id];
  if (!p) throw new Error('NOT_IN_ROOM');
  tick(state, room, ctx); // a turn that already ran out is gone before this command is weighed
  const spec = GAMES[room.game], r = room.round;
  if (!handLive(room) || room.handNo !== Number(handNo) || room.events.length !== Number(seq)) throw new Error('STALE_ACTION');
  if (p.seat < 0 || spec.actor(r) !== p.seat) throw new Error('NOT_YOUR_TURN');
  const move = spec.move(body);
  const cost = spec.cost(r, p.seat, move);
  if (cost > 0) {
    if (user.account.available < cost) throw new Error('INSUFFICIENT_BANKROLL');
    increaseBetLock(state, user, { stake: cost, game: spec.game, roundId: r.id, metadata: { room: room.code, action: move.action } });
    r.locked[user.id] += cost;
  }
  spec.act(r, p.seat, move, room.events, intRng(ctx.rand || Math.random));
  p.missed = 0;
  tick(state, room, ctx);
  return room;
}

// ---------- the hand ----------
// People sit in the order they joined; anyone who can no longer cover the deposit gets up.
function deal(state, room, rand) {
  const spec = GAMES[room.game];
  const deposit = spec.deposit(room.stake);
  for (const p of people(room)) {
    if (state.users[p.userId].account.available < deposit) removePlayer(state, room, p.userId);
  }
  const sitting = people(room).sort((a, b) => a.order - b.order).slice(0, room.size);
  if (!sitting.length) return false;
  const rng = intRng(rand);
  const seats = [...sitting.map(p => ({ kind: 'human', userId: p.userId, name: p.nickname })), ...spec.ai(room.size - sitting.length, rng)];
  const events = [];
  const round = spec.start(room.stake, seats, events, rng, room.double || 1);
  round.room = room.code;
  round.venue = room.floor; // casino floor: its level sets how well the AI seats play
  round.locked = {};
  round.nets = {};
  people(room).forEach(p => { p.seat = -1; });
  sitting.forEach((p, i) => {
    p.seat = i;
    lockBet(state, state.users[p.userId], { stake: deposit, game: spec.game, roundId: round.id, metadata: { room: room.code, engineVersion: spec.engine } });
    round.locked[p.userId] = deposit;
  });
  if (room.round) room.prev = { no: room.handNo, round: room.round, events: room.events };
  room.handNo += 1;
  room.round = round;
  room.events = events;
  room.turn = null;
  room.nextAt = null;
  return true;
}

// Every person who played the hand is paid or charged, including anyone who left during it.
// A 고스톱/맞고 loss past the deposit comes out of the rest of the bankroll as far as it goes.
function settle(state, room) {
  const spec = GAMES[room.game], r = room.round;
  r.seats.forEach((seat, i) => {
    if (!seat.userId || r.nets[seat.userId] !== undefined) return;
    const user = state.users[seat.userId];
    let net = spec.net(r, i);
    let locked = r.locked[seat.userId];
    if (net < -locked) {
      const extra = Math.min(user.account.available, -net - locked);
      if (extra > 0) { increaseBetLock(state, user, { stake: extra, game: spec.game, roundId: r.id, metadata: { reason: 'POINTS_OVER_DEPOSIT', room: room.code } }); locked += extra; }
      net = Math.max(net, -locked);
    }
    const wagered = room.game === 'seotda' || room.game === 'blackjack' ? locked : Math.max(r.stake, Math.abs(net));
    settleLockedHouseGame(state, user, { game: spec.game, stake: locked, netPnl: net, roundId: r.id, wagered, details: { room: room.code, seat: i, ...spec.details(r) } });
    r.nets[seat.userId] = net;
  });
  r.status = 'SETTLED';
  // 묻고 더블로 가: in a room a 나가리 always carries over; any finished hand resets it.
  if (room.game === 'matgo' || room.game === 'gostop') room.double = r.result?.winner === null ? (r.result.nextDouble || 1) : 1;
}

// When a hand ends: people who let their clock run out too often get up.
function afterHand(state, room) {
  for (const p of people(room)) if (p.missed >= MISSED_TURNS_LIMIT) removePlayer(state, room, p.userId);
}

// Would a tick change anything right now? Lets a plain poll skip the write.
export function roomDue(room, now) {
  if (room.status !== 'OPEN') return false;
  const spec = GAMES[room.game], r = room.round;
  if (handLive(room)) {
    const s = spec.actor(r);
    if (r.seats[s]?.kind !== 'human') return true;
    return !room.turn || room.turn.handNo !== room.handNo || room.turn.seq !== room.events.length || now - room.turn.at >= TURN_MS;
  }
  if (r && r.status !== 'SETTLED') return true;
  return room.started && people(room).length > 0 && room.nextAt !== null && now >= room.nextAt;
}

// Plays everything that is due: AI moves, run-out turn clocks, the end of a hand, the next deal.
export function tick(state, room, { now, rand = Math.random }) {
  const spec = GAMES[room.game];
  const rng = intRng(rand);
  for (let guard = 0; guard < 2000 && room.status === 'OPEN'; guard++) {
    const r = room.round;
    if (handLive(room)) {
      const s = spec.actor(r), seat = r.seats[s];
      if (seat.kind === 'ai') { spec.act(r, s, spec.bot(r, s, rng), room.events, rng); continue; }
      if (seat.kind === 'away') { spec.act(r, s, spec.away(r, s, rng), room.events, rng); continue; }
      const seq = room.events.length;
      if (!room.turn || room.turn.handNo !== room.handNo || room.turn.seq !== seq) room.turn = { handNo: room.handNo, seq, seat: s, at: now };
      if (now - room.turn.at < TURN_MS) return room;
      const from = room.events.length;
      spec.act(r, s, spec.timeout(r, s, rng), room.events, rng);
      if (room.events[from]) room.events[from].timeout = true;
      const p = room.players[seat.userId];
      if (p) p.missed += 1;
      room.turn = null;
      continue;
    }
    room.turn = null;
    if (r && r.status !== 'SETTLED') {
      settle(state, room);
      room.nextAt = now + NEXT_HAND_MS;
      afterHand(state, room);
      if (closeIfEmpty(state, room)) return room;
      continue;
    }
    if (closeIfEmpty(state, room)) return room;
    if (!room.started || room.nextAt === null || now < room.nextAt) return room;
    if (!deal(state, room, rand)) return room;
  }
  return room;
}

// ---------- views ----------
const seatIn = (round, userId) => (round ? round.seats.findIndex(s => s.userId === userId) : -1);

// The hand as `userId` sees it from seat 0, or null when they are not playing it.
function handView(room, round, events, userId) {
  const spec = GAMES[room.game];
  const k = seatIn(round, userId);
  if (k < 0) return null;
  const n = round.seats.length;
  return { k, n, round: spec.view(round, k), events: events.map(e => spec.event(e, k, n)), netPnl: round.nets?.[userId] ?? null };
}

// Events since the client's cursor. When the hand rolled over since its last look it also gets
// the rest of the previous hand with its final view, so that hand's ending still plays out.
export function roomView(room, userId, { hand, from } = {}, now = Date.now()) {
  const me = room.players[userId];
  const cur = handView(room, room.round, room.events, userId);
  const at = Math.max(0, Number(from) || 0);
  let events = null, prev = null;
  if (cur && hand !== undefined && Number(hand) === room.handNo) events = cur.events.slice(at);
  else if (cur && hand !== undefined && Number(hand) === room.handNo - 1) {
    events = cur.events;
    const old = room.prev && handView(room, room.prev.round, room.prev.events, userId);
    if (old) prev = { round: old.round, events: old.events.slice(at), netPnl: old.netPnl };
  }
  const spec = GAMES[room.game];
  const turn = handLive(room) && room.turn && room.turn.handNo === room.handNo && room.turn.seq === room.events.length && cur
    ? { seat: turnSeat(cur.k, cur.n)(room.turn.seat), deadline: room.turn.at + TURN_MS, ms: TURN_MS }
    : null;
  return {
    game: room.game, code: room.code, floor: room.floor, tier: room.tier, stake: room.stake, size: room.size,
    deposit: spec.deposit(room.stake), double: room.double || 1,
    hostId: room.hostId, isHost: room.hostId === userId, started: room.started, status: room.status,
    seated: Boolean(me), playing: Boolean(cur), waiting: Boolean(me && !cur),
    players: people(room).sort((a, b) => a.order - b.order).map(p => ({ userId: p.userId, nickname: p.nickname, host: p.userId === room.hostId, me: p.userId === userId })),
    handNo: room.handNo, seq: room.events.length,
    round: cur ? cur.round : null, netPnl: cur ? cur.netPnl : null,
    turn, nextAt: room.nextAt, serverNow: now,
    cursor: { hand: room.handNo, from: room.events.length },
    events, prev
  };
}

// Open rooms of one game with a free chair. Friends sit together whatever floors each has reached.
export function listRooms(state, user, game) {
  return openRooms(state)
    .filter(r => (!game || r.game === game) && (people(r).length < r.size || r.players[user.id]))
    .map(r => ({
      game: r.game, code: r.code, floor: r.floor, tier: r.tier, stake: r.stake, size: r.size, started: r.started,
      host: state.users[r.hostId]?.nickname ?? '', people: people(r).sort((a, b) => a.order - b.order).map(p => p.nickname), mine: Boolean(r.players[user.id])
    }));
}

// ---------- routes ----------
const ERRORS = { ROOM_NOT_FOUND: 404, NOT_IN_ROOM: 409, ALREADY_IN_ROOM: 409, OPEN_SOLO_ROUND: 409, ROOM_FULL: 409, NOT_HOST: 403, INVALID_ROOM_SIZE: 400, UNKNOWN_GAME: 400, ROOM_CODE_EXHAUSTED: 503 };
const cmdLog = state => (state.tableRoomCmds && typeof state.tableRoomCmds === 'object' ? state.tableRoomCmds : (state.tableRoomCmds = {}));
const MOVE_KEYS = ['action', 'type', 'card', 'target', 'month', 'shake'];

// Returns a response for /api/rooms and /api/room, or null for any other path.
export async function handleTableRoom(req, url, { mutate, loadState, getUser, summarize, validateStake, normalizeKey, now = () => Date.now() }) {
  if (!/^\/api\/rooms?(\/|$)/.test(url.pathname)) return null;
  try {
    const p = url.pathname;
    const context = () => ({ now: now(), rand: Math.random, validateStake });
    if (p === '/api/rooms' && req.method === 'GET') {
      const state = await loadState();
      const user = getUser(state, req);
      const mine = tableRoomOf(state, user.id);
      return { status: 200, data: { rooms: listRooms(state, user, url.searchParams.get('game')), mine: mine ? { code: mine.code, game: mine.game } : null } };
    }
    // The poll: only writes when something is due (an AI to move, a clock run out, a deal).
    if (p === '/api/room' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const cursor = url.searchParams.has('hand') ? { hand: Number(url.searchParams.get('hand')), from: Number(url.searchParams.get('from')) } : {};
      const state = await loadState();
      const user = getUser(state, req);
      const room = findRoom(state, code);
      // `available` keeps the wallet on screen current between the player's own moves.
      if (!roomDue(room, now())) return { status: 200, data: { room: roomView(room, user.id, cursor, now()), available: user.account.available } };
      const data = await mutate(s => {
        const r = findRoom(s, code);
        tick(s, r, context());
        return { room: r.status === 'OPEN' ? roomView(r, user.id, cursor, now()) : null, available: s.users[user.id].account.available };
      });
      if (!data.room) throw new Error('ROOM_NOT_FOUND');
      return { status: 200, data };
    }
    if (req.method !== 'POST') return null;
    const verb = { '/api/rooms': 'create', '/api/rooms/join': 'join', '/api/rooms/start': 'start', '/api/rooms/action': 'act', '/api/rooms/leave': 'leave' }[p];
    if (!verb) return null;
    const body = await req.body();
    const key = normalizeKey(req.header('x-idempotency-key'));
    const cursor = body.cursor && typeof body.cursor === 'object' ? { hand: Number(body.cursor.hand), from: Number(body.cursor.from) } : {};
    const data = await mutate(state => {
      const user = getUser(state, req);
      const fingerprint = JSON.stringify({ verb, code: normalizeCode(body.code), game: body.game ?? null, stake: body.stake ?? null, floor: body.floor ?? null, size: body.size ?? null, handNo: body.handNo ?? null, seq: body.seq ?? null, ...Object.fromEntries(MOVE_KEYS.map(k => [k, body[k] ?? null])) });
      const reply = (code, result, replayed) => {
        const room = code ? openRooms(state).find(r => r.code === code) : null;
        return { room: room ? roomView(room, user.id, cursor, now()) : null, result, replayed, state: summarize(state, user) };
      };
      const last = cmdLog(state)[user.id];
      if (key && last?.key === key) {
        if (last.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
        return reply(last.code, last.result, true);
      }
      let room, result = null;
      if (verb === 'create') room = createRoom(state, user, { game: body.game, stake: Number(body.stake), floor: body.floor || FLOORS[0].slug, size: body.size }, context());
      else if (verb === 'join') room = joinRoom(state, user, body.code, context());
      else if (verb === 'start') room = startRoom(state, user, body.code, context());
      else if (verb === 'act') room = roomAction(state, user, body.code, body, context());
      else {
        const out = leaveRoom(state, user, body.code, context());
        room = out.room;
        result = { pending: out.pending };
      }
      cmdLog(state)[user.id] = { key, fingerprint, code: room.code, result };
      return reply(room.code, result, false);
    });
    return { status: verb === 'create' ? 201 : 200, data };
  } catch (e) {
    if (ERRORS[e.message]) return { status: ERRORS[e.message], data: { error: e.message, ...(e.where && { where: e.where }) } };
    throw e;
  }
}
