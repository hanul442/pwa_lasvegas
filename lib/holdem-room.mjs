// Friends' Hold'em rooms: up to six people at one table, house bots in the seats nobody took.
// Each person's buy-in is locked in the ledger while they sit and settled when they get up,
// exactly like the solo table. A Worker has no timers, so the room moves lazily: any read or
// command first plays the bots, runs out a person's turn clock and deals the next hand when due.
// The whole room is plain data in the shared state, so it runs on the Node server and the
// Durable Object alike.
import { id, floorOpen } from './state.mjs';
import { stakeTierFor, FLOORS, MONEY_UNIT } from './constants.mjs';
import { lockBet, settleLockedHouseGame } from './economy.mjs';
import { createTable, startHand, applyAction, foldOut, legalActions, publicTable, cardText } from './holdem.mjs';
import { decide } from './holdem-bot.mjs';
import { HOLDEM_BLINDS, HOLDEM_ENGINE, activeHoldemSession, newBot } from './holdem-session.mjs';
import { seatedElsewhere } from './table-room.mjs';

export const ROOM_SEATS = 6;
export const TURN_MS = 25_000;
export const NEXT_HAND_MS = 9_000; // long enough to take in the showdown (and show a hand) before the next deal
export const SHOW_HOLD_MS = 4_000;
export const MISSED_TURNS_LIMIT = 3; // turns run out in a row before the table stands someone up
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
const GAME = "Hold'em";

const emptySeat = () => ({ id: null, name: '', kind: 'empty', stack: 0 });
const rooms = state => (Array.isArray(state.holdemRooms) ? state.holdemRooms : (state.holdemRooms = []));
const openRooms = state => (Array.isArray(state.holdemRooms) ? state.holdemRooms : []).filter(r => r.status === 'OPEN');
export const normalizeCode = code => String(code ?? '').trim().toUpperCase();

export function findRoom(state, code) {
  const room = openRooms(state).find(r => r.code === normalizeCode(code));
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}
export const roomOfUser = (state, userId) => openRooms(state).find(r => r.players[userId]) || null;

function newCode(state, rand) {
  const taken = new Set(openRooms(state).map(r => r.code));
  for (let tries = 0; tries < 200; tries++) {
    let code = '';
    for (let k = 0; k < 4; k++) code += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
    if (!taken.has(code)) return code;
  }
  throw new Error('ROOM_CODE_EXHAUSTED');
}

const humans = room => Object.values(room.players);
const seated = room => humans(room).filter(p => p.seat >= 0);
const handLive = t => Boolean(t.hand && !t.hand.over);

// A seat someone can take right now: empty, and not holding a hand that is still being played.
function freeSeat(room) {
  const t = room.table;
  return t.seats.findIndex((s, i) => s.kind === 'empty' && !(handLive(t) && t.hand.players[i]));
}

function sitDown(room, p, i) {
  if (room.table.seats[i].kind === 'bot') room.botOut += room.table.seats[i].stack;
  room.table.seats[i] = { id: p.userId, name: p.nickname, kind: 'human', stack: p.buyIn };
  p.seat = i;
}

function assertCanSit(state, user) {
  const mine = roomOfUser(state, user.id);
  if (mine) throw seatedElsewhere('holdem', mine);
  const other = (Array.isArray(state.tableRooms) ? state.tableRooms : []).find(r => r.status === 'OPEN' && r.players[user.id]); // a 섯다/고스톱/맞고/블랙잭 room
  if (other) throw seatedElsewhere(other.game, other);
  if (activeHoldemSession(state, user.id)) throw new Error('OPEN_HOLDEM_SESSION');
}

function addPlayer(state, room, user) {
  const p = { userId: user.id, nickname: user.nickname, ticket: id('hroom'), buyIn: room.buyIn, seat: -1, missed: 0, joinedAt: new Date().toISOString() };
  // Each person's stay at the table is one ledger round: locked now, settled when they get up.
  lockBet(state, user, { stake: room.buyIn, game: GAME, roundId: p.ticket, metadata: { engineVersion: HOLDEM_ENGINE, room: room.code } });
  room.players[user.id] = p;
  return p;
}

// ctx: { now, rand, validateStake(user, floor, stake) }
export function createRoom(state, user, { buyIn, floor, size = ROOM_SEATS }, ctx) {
  const rand = ctx.rand || Math.random;
  assertCanSit(state, user);
  const tier = stakeTierFor(buyIn)?.slug;
  const blinds = HOLDEM_BLINDS[tier];
  if (!blinds) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  if (!Number.isSafeInteger(buyIn) || buyIn < blinds.big * 5) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const seats = Number(size);
  if (!(Number.isInteger(seats) && seats >= 3 && seats <= ROOM_SEATS)) throw new Error('INVALID_ROOM_SIZE');
  ctx.validateStake(user, floor, buyIn);
  const room = {
    id: id('hrm'), code: newCode(state, rand), floor, tier, buyIn, size: seats, hostId: user.id,
    status: 'OPEN', started: false, createdAt: new Date(ctx.now).toISOString(),
    table: createTable({ seats: Array.from({ length: ROOM_SEATS }, emptySeat), smallBlind: blinds.small, bigBlind: blinds.big, button: 0, unit: MONEY_UNIT }),
    players: {}, turn: null, nextAt: null, prev: null,
    botIn: 0, botOut: 0 // house chips that came to the table with bots, and left with them
  };
  sitDown(room, addPlayer(state, room, user), 0);
  rooms(state).push(room);
  return room;
}

export function joinRoom(state, user, code, ctx) {
  const room = findRoom(state, code);
  assertCanSit(state, user);
  if (humans(room).length >= ROOM_SEATS) throw new Error('ROOM_FULL');
  ctx.validateStake(user, room.floor, room.buyIn);
  const p = addPlayer(state, room, user);
  const t = room.table;
  let i = freeSeat(room);
  // Between hands a bot gives up its chair at once; mid-hand the person waits for the next deal.
  if (i < 0 && !handLive(t)) i = t.seats.findIndex(s => s.kind === 'bot');
  if (i >= 0) sitDown(room, p, i);
  tick(state, room, ctx);
  return room;
}

// Busted bots leave, waiting people sit (a bot stands up if the table is full), then bots fill
// the table back up to the size the host picked.
function seatForHand(room, rand) {
  const t = room.table;
  t.seats.forEach((s, i) => { if (s.kind === 'bot' && s.stack <= 0) t.seats[i] = emptySeat(); });
  for (const p of humans(room).filter(x => x.seat < 0)) {
    let i = freeSeat(room);
    if (i < 0) i = t.seats.findIndex(s => s.kind === 'bot');
    if (i >= 0) sitDown(room, p, i);
  }
  const occupied = () => t.seats.filter(s => s.kind !== 'empty').length;
  for (let i = t.seats.length - 1; i >= 0 && occupied() > room.size; i--) {
    if (t.seats[i].kind === 'bot') { room.botOut += t.seats[i].stack; t.seats[i] = emptySeat(); }
  }
  while (occupied() < room.size) {
    const i = freeSeat(room);
    if (i < 0) break;
    const bot = newBot({ seats: t.seats, buyIn: room.buyIn, big: t.bigBlind }, rand);
    room.botIn += bot.stack;
    t.seats[i] = bot;
  }
}

// Standing up settles stack minus buy-in through the same ledger path as the solo table.
function standUp(state, room, userId) {
  const p = room.players[userId];
  const t = room.table;
  let cashOut = p.buyIn; // never sat down: the buy-in comes straight back
  if (p.seat >= 0) {
    if (handLive(t)) foldOut(t, p.seat);
    cashOut = t.seats[p.seat].stack;
    t.seats[p.seat] = emptySeat();
  }
  const user = state.users[userId];
  const netPnl = cashOut - p.buyIn;
  settleLockedHouseGame(state, user, { game: GAME, stake: p.buyIn, netPnl, roundId: p.ticket, details: { engineVersion: HOLDEM_ENGINE, room: room.code, hands: t.handNo, cashOut } });
  delete room.players[userId];
  if (room.hostId === userId) room.hostId = seated(room)[0]?.userId ?? humans(room)[0]?.userId ?? null;
  if (!humans(room).length) {
    room.status = 'CLOSED';
    state.holdemRooms = rooms(state).filter(r => r !== room);
  }
  return { cashOut, netPnl };
}

export function leaveRoom(state, user, code, ctx) {
  const room = findRoom(state, code);
  if (!room.players[user.id]) throw new Error('NOT_IN_ROOM');
  const result = standUp(state, room, user.id);
  if (room.status === 'OPEN') tick(state, room, ctx);
  return { room, ...result };
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

export function roomAction(state, user, code, { handNo, seq, action, amount }, ctx) {
  const room = findRoom(state, code);
  const p = room.players[user.id];
  if (!p) throw new Error('NOT_IN_ROOM');
  tick(state, room, ctx); // a turn that already ran out is gone before this command is weighed
  const t = room.table, h = t.hand;
  if (!h || h.over || h.no !== Number(handNo) || h.seq !== Number(seq)) throw new Error('STALE_ACTION');
  if (p.seat < 0 || h.toAct !== p.seat) throw new Error('NOT_YOUR_TURN');
  applyAction(t, p.seat, { type: action, amount: amount === undefined || amount === null ? undefined : Number(amount) });
  p.missed = 0;
  tick(state, room, ctx);
  return room;
}

// When a hand ends, people who let their clock run out too often get up. Someone who lost
// everything stays in the chair until the next deal, so they can watch the showdown that broke
// them (and show their cards) before the table stands them up.
function afterHand(state, room) {
  for (const p of seated(room)) {
    if (p.missed >= MISSED_TURNS_LIMIT) standUp(state, room, p.userId);
    if (room.status !== 'OPEN') return;
  }
}
function standBusted(state, room) {
  for (const p of seated(room)) {
    if (room.table.seats[p.seat].stack <= 0) standUp(state, room, p.userId);
    if (room.status !== 'OPEN') return;
  }
}

// After a hand, a player may turn their cards face up for the table, folded or not.
export function showCards(state, user, code, ctx) {
  const room = findRoom(state, code);
  const p = room.players[user.id];
  if (!p) throw new Error('NOT_IN_ROOM');
  tick(state, room, ctx);
  const h = room.table.hand;
  if (!h || !h.over || p.seat < 0 || !h.players[p.seat]) throw new Error('HAND_NOT_ACTIVE');
  if (h.events.some(e => e.t === 'show' && e.seat === p.seat)) throw new Error('ALREADY_SHOWN');
  h.events.push({ t: 'show', seat: p.seat, cards: h.players[p.seat].cards.map(cardText), voluntary: true });
  // Give the table a moment to take it in before the next deal.
  if (room.nextAt !== null) room.nextAt = Math.max(room.nextAt, ctx.now + SHOW_HOLD_MS);
  return room;
}

// Would a tick change anything right now? Lets a plain poll skip the write.
export function roomDue(room, now) {
  const t = room.table, h = t.hand;
  if (room.status !== 'OPEN') return false;
  if (handLive(t)) {
    if (t.seats[h.toAct].kind !== 'human') return true;
    return !room.turn || room.turn.handNo !== h.no || room.turn.seq !== h.seq || now - room.turn.at >= TURN_MS;
  }
  if (h && room.endedNo !== h.no) return true;
  return room.started && humans(room).length > 0 && room.nextAt !== null && now >= room.nextAt;
}

// Plays everything that is due: bot moves, run-out turn clocks, the end of a hand, the next deal.
export function tick(state, room, { now, rand = Math.random }) {
  const t = room.table;
  for (let guard = 0; guard < 1000 && room.status === 'OPEN'; guard++) {
    const h = t.hand;
    if (handLive(t)) {
      const i = h.toAct, seat = t.seats[i];
      if (seat.kind === 'bot') { applyAction(t, i, decide(t, i, rand)); continue; }
      if (seat.kind !== 'human') { foldOut(t, i); continue; } // a chair emptied mid-turn
      if (!room.turn || room.turn.handNo !== h.no || room.turn.seq !== h.seq) room.turn = { handNo: h.no, seq: h.seq, seat: i, at: now };
      if (now - room.turn.at < TURN_MS) return room;
      // Out of time: check if it's free, otherwise fold.
      const from = h.events.length;
      applyAction(t, i, { type: legalActions(t, i).canCheck ? 'CHECK' : 'FOLD' });
      h.events[from].timeout = true;
      const p = room.players[seat.id];
      if (p) p.missed += 1;
      room.turn = null;
      continue;
    }
    room.turn = null;
    if (h && room.endedNo !== h.no) {
      room.endedNo = h.no;
      room.nextAt = now + NEXT_HAND_MS;
      afterHand(state, room);
      continue;
    }
    if (!room.started || room.nextAt === null || now < room.nextAt || !humans(room).length) return room;
    standBusted(state, room);
    if (room.status !== 'OPEN') return room;
    seatForHand(room, rand);
    if (!seated(room).length || t.seats.filter(s => s.stack > 0).length < 2) return room;
    room.prev = h ? { no: h.no, events: h.events } : null;
    startHand(t);
    room.nextAt = null;
  }
  return room;
}

// ---------- views ----------
// Events since the client's cursor. When the hand rolled over since its last look it also
// gets the tail of the previous hand (prevCount of them), so the showdown still plays out.
function eventsSince(room, hand, from) {
  const h = room.table.hand;
  if (!h) return { events: [], prevCount: 0 };
  const at = Math.max(0, Number(from) || 0);
  if (Number(hand) === h.no) return { events: h.events.slice(at), prevCount: 0 };
  if (room.prev && Number(hand) === room.prev.no) {
    const tail = room.prev.events.slice(at);
    return { events: [...tail, ...h.events], prevCount: tail.length };
  }
  return { events: null, prevCount: 0 }; // too far behind: draw the table as it is
}

export function roomView(room, userId, { hand, from } = {}, now = Date.now()) {
  const t = room.table;
  const me = room.players[userId];
  const seat = me ? me.seat : -1;
  const table = publicTable(t, seat);
  // A chair left mid-hand shows as empty, not as a folded hand.
  table.seats.forEach((s, i) => { if (t.seats[i].kind === 'empty') Object.assign(s, { inHand: false, folded: false, cards: [] }); });
  const h = t.hand;
  const { events, prevCount } = hand === undefined ? { events: null, prevCount: 0 } : eventsSince(room, hand, from);
  return {
    code: room.code, floor: room.floor, tier: room.tier, buyIn: room.buyIn, size: room.size,
    hostId: room.hostId, isHost: room.hostId === userId, started: room.started, status: room.status,
    me: seat, waiting: Boolean(me && seat < 0), seated: Boolean(me),
    players: humans(room).map(p => ({ userId: p.userId, nickname: p.nickname, seat: p.seat, host: p.userId === room.hostId })),
    table,
    turn: handLive(t) && room.turn && room.turn.seq === h.seq && room.turn.handNo === h.no ? { seat: room.turn.seat, deadline: room.turn.at + TURN_MS, ms: TURN_MS } : null,
    nextAt: room.nextAt, serverNow: now,
    cursor: { hand: h?.no ?? 0, from: h?.events.length ?? 0 },
    events, prevCount
  };
}

// Open rooms a person may join: anyone's table on a floor open to them (unlocked, not outgrown), with a free chair.
export function listRooms(state, user) {
  return openRooms(state)
    .filter(r => floorOpen(user, FLOORS.find(f => f.slug === r.floor)) && (humans(r).length < ROOM_SEATS || r.players[user.id]))
    .map(r => ({
      code: r.code, floor: r.floor, tier: r.tier, buyIn: r.buyIn, size: r.size, started: r.started,
      host: state.users[r.hostId]?.nickname ?? '', people: humans(r).map(p => p.nickname), mine: Boolean(r.players[user.id])
    }));
}

// Every chip on the table, for audits: stacks plus whatever sits in the current pot.
export function tableChips(room) {
  const t = room.table;
  const stacks = t.seats.reduce((a, s) => a + s.stack, 0);
  const pot = t.hand && !t.hand.over ? t.hand.players.reduce((a, p) => a + (p ? p.committed : 0), 0) : 0;
  return stacks + pot;
}

// ---------- routes ----------
const ERRORS = { ROOM_NOT_FOUND: 404, NOT_IN_ROOM: 409, ALREADY_IN_ROOM: 409, ROOM_FULL: 409, NOT_HOST: 403, INVALID_ROOM_SIZE: 400, ROOM_CODE_EXHAUSTED: 503, ALREADY_SHOWN: 409 };
const cmdLog = state => (state.holdemRoomCmds && typeof state.holdemRoomCmds === 'object' ? state.holdemRoomCmds : (state.holdemRoomCmds = {}));

// Returns a response for /api/holdem/room(s)/*, or null for any other path.
export async function handleHoldemRoom(req, url, { mutate, loadState, getUser, summarize, validateStake, normalizeKey, now = () => Date.now() }) {
  if (!/^\/api\/holdem\/rooms?(\/|$)/.test(url.pathname)) return null;
  try {
    const p = url.pathname;
    const ctx = () => ({ now: now(), rand: Math.random, validateStake });
    if (p === '/api/holdem/rooms' && req.method === 'GET') {
      const state = await loadState();
      const user = getUser(state, req);
      return { status: 200, data: { rooms: listRooms(state, user), mine: roomOfUser(state, user.id)?.code ?? null } };
    }
    // The poll: only writes when something is due (a bot to move, a clock run out, a deal).
    if (p === '/api/holdem/room' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const cursor = url.searchParams.has('hand') ? { hand: Number(url.searchParams.get('hand')), from: Number(url.searchParams.get('from')) } : {};
      const state = await loadState();
      const user = getUser(state, req);
      const room = findRoom(state, code);
      if (!roomDue(room, now())) return { status: 200, data: { room: roomView(room, user.id, cursor, now()) } };
      const data = await mutate(s => {
        const r = findRoom(s, code);
        tick(s, r, ctx());
        return { room: roomView(r, user.id, cursor, now()) };
      });
      return { status: 200, data };
    }
    if (req.method !== 'POST') return null;
    const verb = { '/api/holdem/rooms': 'create', '/api/holdem/rooms/join': 'join', '/api/holdem/rooms/start': 'start', '/api/holdem/rooms/action': 'act', '/api/holdem/rooms/leave': 'leave', '/api/holdem/rooms/show': 'show' }[p];
    if (!verb) return null;
    const body = await req.body();
    const key = normalizeKey(req.header('x-idempotency-key'));
    const cursor = body.cursor && typeof body.cursor === 'object' ? { hand: Number(body.cursor.hand), from: Number(body.cursor.from) } : {};
    const data = await mutate(state => {
      const user = getUser(state, req);
      const fingerprint = JSON.stringify({ verb, code: normalizeCode(body.code), buyIn: body.buyIn ?? null, floor: body.floor ?? null, size: body.size ?? null, handNo: body.handNo ?? null, seq: body.seq ?? null, action: body.action ?? null, amount: body.amount ?? null });
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
      if (verb === 'create') room = createRoom(state, user, { buyIn: Number(body.buyIn), floor: body.floor || FLOORS[0].slug, size: body.size ?? ROOM_SEATS }, ctx());
      else if (verb === 'join') room = joinRoom(state, user, body.code, ctx());
      else if (verb === 'start') room = startRoom(state, user, body.code, ctx());
      else if (verb === 'act') room = roomAction(state, user, body.code, body, ctx());
      else if (verb === 'show') room = showCards(state, user, body.code, ctx());
      else {
        const out = leaveRoom(state, user, body.code, ctx());
        room = out.room;
        result = { cashOut: out.cashOut, netPnl: out.netPnl };
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
