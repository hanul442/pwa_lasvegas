// Friends' Hold'em rooms: up to six people at one table, house bots in the seats nobody took.
// Each person's buy-in is locked in the ledger while they sit and settled when they get up,
// exactly like the solo table. A Worker has no timers, so the room moves lazily: any read or
// command first plays the bots, runs out a person's turn clock and deals the next hand when due.
// The whole room is plain data in the shared state, so it runs on the Node server and the
// Durable Object alike.
import { watchersOf, assertCanWatch, noteWatcher } from './watch.mjs';
import { id, newAccountRoomRefusal } from './state.mjs';
import { stakeTierFor, FLOORS, MONEY_UNIT, levelForFloor } from './constants.mjs';
import { lockBet, settleLockedHouseGame } from './economy.mjs';
import { noteFriendHand } from './friend-record.mjs';
import { notePokerHand } from './hand-book.mjs';
import * as holdem from './holdem.mjs';
import { cardText } from './holdem.mjs';
import { decide as decideHoldem } from './holdem-bot.mjs';
import * as seven from './sevenpoker.mjs';
import { decide as decideSeven, pickOpen } from './sevenpoker-bot.mjs';
import { SEVEN_ANTES, SEVEN_ENGINE, SEVEN_GAME, MIN_ANTES, activeSevenSession } from './sevenpoker-session.mjs';
import { HOLDEM_BLINDS, HOLDEM_ENGINE, activeHoldemSession, newBot } from './holdem-session.mjs';
import { seatedElsewhere } from './table-room.mjs';
import { postChat, chatView } from './room-chat.mjs';
import { nightlyAfterHand, leaveNightly, nightlyTourneyView } from './nightly-tourney.mjs';
import { TOURNEY, newTourney, enterTourney, beginTourney, beforeDeal, recordBusts, tourneyDecided, forfeitEntry, finishTourney, tourneyPublic } from './holdem-tourney.mjs';

export const ROOM_SEATS = 6;
export const TURN_MS = 25_000;
export const NEXT_HAND_MS = 9_000; // long enough to take in the showdown (and show a hand) before the next deal
export const SHOW_HOLD_MS = 4_000;
export const MISSED_TURNS_LIMIT = 3; // turns run out in a row before the table stands someone up
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
const GAME = "Hold'em";

// The same room runs 7포커 too (room.variant 'seven'): one list of poker rooms means every
// "one table at a time" check, the season reset and the sweep cover both games.
const HOLDEM_RULES = { ...holdem, decide: decideHoldem, game: GAME, engine: HOLDEM_ENGINE, screen: 'holdem' };
const SEVEN_RULES = { ...seven, decide: decideSeven, game: SEVEN_GAME, engine: SEVEN_ENGINE, screen: 'sevenpoker' };
const rules = room => (room.variant === 'seven' ? SEVEN_RULES : HOLDEM_RULES);
export const roomGame = room => rules(room).screen;
const isSeven = room => room.variant === 'seven';
// The smallest stack a friend may sit with: five big blinds, or ten antes at 7포커.
const minBuyIn = room => (isSeven(room) ? room.table.ante * MIN_ANTES : room.table.bigBlind * 5);
const botBig = room => (isSeven(room) ? room.table.ante * 2 : room.table.bigBlind);
const choosing = t => Boolean(t.hand && !t.hand.over && t.hand.phase === 'CHOOSE');

const emptySeat = () => ({ id: null, name: '', kind: 'empty', stack: 0 });
const rooms = state => (Array.isArray(state.holdemRooms) ? state.holdemRooms : (state.holdemRooms = []));
const openRooms = state => (Array.isArray(state.holdemRooms) ? state.holdemRooms : []).filter(r => r.status === 'OPEN');
export const normalizeCode = code => String(code ?? '').trim().toUpperCase();

// A finished tournament ('DONE') can still be read for its results, but nobody is seated in it.
const viewableRooms = state => (Array.isArray(state.holdemRooms) ? state.holdemRooms : []).filter(r => r.status === 'OPEN' || r.status === 'DONE');
export function findRoom(state, code) {
  const room = viewableRooms(state).find(r => r.code === normalizeCode(code));
  if (!room) throw new Error('ROOM_NOT_FOUND');
  return room;
}
export const roomOfUser = (state, userId) => openRooms(state).find(r => r.players[userId]) || null;

export function newCode(state, rand = Math.random) {
  const taken = new Set(viewableRooms(state).map(r => r.code));
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
  if (mine) throw seatedElsewhere(roomGame(mine), mine);
  const other = (Array.isArray(state.tableRooms) ? state.tableRooms : []).find(r => r.status === 'OPEN' && r.players[user.id]); // a 섯다/고스톱/맞고/블랙잭 room
  if (other) throw seatedElsewhere(other.game, other);
  if (activeHoldemSession(state, user.id)) throw new Error('OPEN_HOLDEM_SESSION');
  if (activeSevenSession(state, user.id)) throw new Error('OPEN_SEVENPOKER_SESSION');
}

function addPlayer(state, room, user, buyIn = room.buyIn) {
  const p = { userId: user.id, nickname: user.nickname, ticket: id('hroom'), buyIn, seat: -1, missed: 0, joinedAt: new Date().toISOString() };
  // Each person's stay at the table is one ledger round: locked now, settled when they get up.
  lockBet(state, user, { stake: buyIn, game: rules(room).game, roundId: p.ticket, metadata: { engineVersion: rules(room).engine, room: room.code } });
  room.players[user.id] = p;
  return p;
}

// ctx: { now, rand, validateStake(user, floor, stake) }
// mode 'tourney' makes a sit & go (lib/holdem-tourney.mjs); bots: fill empty chairs with AI at the start.
export function createRoom(state, user, { buyIn, floor, size = ROOM_SEATS, mode = 'cash', bots = true, game = 'holdem' }, ctx) {
  const rand = ctx.rand || Math.random;
  pruneDone(state, ctx.now);
  assertCanSit(state, user);
  if (game === 'sevenpoker') return createSevenRoom(state, user, { buyIn, floor, size }, ctx);
  if (mode === 'tourney') return createTourneyRoom(state, user, { buyIn, floor, size, bots }, ctx);
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
    table: holdem.createTable({ seats: Array.from({ length: ROOM_SEATS }, emptySeat), smallBlind: blinds.small, bigBlind: blinds.big, button: 0, unit: MONEY_UNIT, level: levelForFloor(floor, buyIn) }),
    players: {}, turn: null, nextAt: null, prev: null,
    botIn: 0, botOut: 0 // house chips that came to the table with bots, and left with them
  };
  sitDown(room, addPlayer(state, room, user), 0);
  rooms(state).push(room);
  return room;
}

// 7포커 rooms are cash tables only: everyone antes, ten antes is the smallest buy-in.
function createSevenRoom(state, user, { buyIn, floor, size }, ctx) {
  const rand = ctx.rand || Math.random;
  const tier = stakeTierFor(buyIn)?.slug;
  const ante = SEVEN_ANTES[tier];
  if (!ante || !Number.isSafeInteger(buyIn) || buyIn < ante * MIN_ANTES) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const seats = Number(size);
  if (!(Number.isInteger(seats) && seats >= 2 && seats <= ROOM_SEATS)) throw new Error('INVALID_ROOM_SIZE');
  ctx.validateStake(user, floor, buyIn);
  const room = {
    id: id('hrm'), code: newCode(state, rand), variant: 'seven', floor, tier, buyIn, size: seats, hostId: user.id,
    status: 'OPEN', started: false, createdAt: new Date(ctx.now).toISOString(),
    table: seven.createTable({ seats: Array.from({ length: ROOM_SEATS }, emptySeat), ante, unit: MONEY_UNIT, level: levelForFloor(floor, buyIn) }),
    players: {}, turn: null, nextAt: null, prev: null, botIn: 0, botOut: 0
  };
  sitDown(room, addPlayer(state, room, user), 0);
  rooms(state).push(room);
  return room;
}

export function joinRoom(state, user, code, ctx) {
  const room = findRoom(state, code);
  if (room.nightly) throw new Error('NIGHTLY_TABLE'); // seats there come only from registering
  assertCanSit(state, user);
  const young = newAccountRoomRefusal(user, FLOORS.find(f => f.slug === room.floor));
  if (young) throw new Error(young);
  if (room.tourney) return joinTourney(state, room, user, ctx);
  if (humans(room).length >= ROOM_SEATS) throw new Error('ROOM_FULL');
  // A friend sits whatever floors they have reached or outgrown, with the room's buy-in or, when
  // that is more than they have, with everything they have (at least five big blinds).
  const buyIn = Math.min(room.buyIn, Math.floor(user.account.available / MONEY_UNIT) * MONEY_UNIT);
  if (buyIn < minBuyIn(room)) throw new Error('INSUFFICIENT_BANKROLL');
  const p = addPlayer(state, room, user, buyIn);
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
    const bot = newBot({ seats: t.seats, buyIn: room.buyIn, big: botBig(room), level: t.level ?? undefined }, rand);
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
    if (handLive(t)) rules(room).foldOut(t, p.seat);
    cashOut = t.seats[p.seat].stack;
    t.seats[p.seat] = emptySeat();
  }
  const user = state.users[userId];
  const netPnl = cashOut - p.buyIn;
  settleLockedHouseGame(state, user, { game: rules(room).game, stake: p.buyIn, netPnl, roundId: p.ticket, details: { engineVersion: rules(room).engine, room: room.code, hands: t.handNo, cashOut } });
  // 친구 전적: a cash stay ends one person at a time, so it lists who was there without a winner.
  if (p.seat >= 0) noteFriendHand(user, { game: rules(room).game, room: room.code, net: netPnl, compare: false, others: humans(room).filter(o => o.userId !== userId).map(o => ({ id: o.userId, nickname: o.nickname })) });
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
  const result = room.nightly ? leaveNightly(state, room, user.id) : room.tourney ? leaveTourney(state, room, user.id, ctx) : standUp(state, room, user.id);
  if (room.status === 'OPEN') tick(state, room, ctx);
  return { room, ...result };
}

export function startRoom(state, user, code, ctx) {
  const room = findRoom(state, code);
  if (room.hostId !== user.id) throw new Error('NOT_HOST');
  if (room.started) throw new Error('HAND_IN_PROGRESS');
  if (room.tourney) startTourney(room, ctx);
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
  if (room.status !== 'OPEN') throw new Error('STALE_ACTION'); // the tournament was decided
  const t = room.table, h = t.hand;
  const value = amount === undefined || amount === null ? undefined : Number(amount);
  // 7포커's open card: everyone picks at once, so only the hand has to match, not the move count.
  if (choosing(t)) {
    if (h.no !== Number(handNo) || action !== 'OPEN') throw new Error('STALE_ACTION');
    if (p.seat < 0 || !seven.waitingToChoose(t, p.seat)) throw new Error('NOT_YOUR_TURN');
    seven.applyAction(t, p.seat, { type: 'OPEN', index: value });
    p.missed = 0;
    tick(state, room, ctx);
    return room;
  }
  if (!h || h.over || h.no !== Number(handNo) || h.seq !== Number(seq)) throw new Error('STALE_ACTION');
  if (p.seat < 0 || h.toAct !== p.seat) throw new Error('NOT_YOUR_TURN');
  rules(room).applyAction(t, p.seat, { type: action, amount: value });
  p.missed = 0;
  tick(state, room, ctx);
  return room;
}

// When a hand ends, people who let their clock run out too often get up. Someone who lost
// everything stays in the chair until the next deal, so they can watch the showdown that broke
// them (and show their cards) before the table stands them up.
function afterHand(state, room) {
  for (const p of seated(room)) {
    if (p.missed >= MISSED_TURNS_LIMIT && room.tourney) p.away = true; // a tournament seat is never cashed out; it sits out
    else if (p.missed >= MISSED_TURNS_LIMIT) standUp(state, room, p.userId);
    if (room.status !== 'OPEN') return;
  }
}
function standBusted(state, room) {
  if (room.tourney) return; // eliminated players keep their chair (and place) till the end
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
  if (choosing(t)) {
    if (t.seats.some((s, i) => s.kind !== 'human' && seven.waitingToChoose(t, i))) return true;
    return !room.turn || room.turn.handNo !== h.no || room.turn.phase !== 'CHOOSE' || now - room.turn.at >= TURN_MS;
  }
  if (handLive(t)) {
    if (t.seats[h.toAct].kind !== 'human' || sittingOut(room, t.seats[h.toAct])) return true;
    return !room.turn || room.turn.handNo !== h.no || room.turn.seq !== h.seq || now - room.turn.at >= TURN_MS;
  }
  if (h && room.endedNo !== h.no) return true;
  return room.started && (humans(room).length > 0 || Boolean(room.nightly)) && room.nextAt !== null && (now >= room.nextAt || aiOnly(room));
}

// Rooms nobody is watching don't move on their own (the Worker has no timers): a hand left by
// everyone who could poll it would hold their chips forever. Every state change first plays out
// whatever is due at every open table, the same as a poll from someone sitting there would.
export function sweepRooms(state, { now, rand = Math.random }) {
  for (const room of openRooms(state)) if (roomDue(room, now)) tick(state, room, { now, rand });
}

// Plays everything that is due: bot moves, run-out turn clocks, the end of a hand, the next deal.
export function tick(state, room, { now, rand = Math.random }) {
  const t = room.table;
  const { applyAction, foldOut, legalActions, decide, startHand } = rules(room);
  for (let guard = 0; guard < 1000 && room.status === 'OPEN'; guard++) {
    const h = t.hand;
    // 7포커's open: bots pick at once; people share one clock, and a pick that runs out is made for them.
    if (choosing(t)) {
      const other = t.seats.findIndex((s, i) => s.kind !== 'human' && seven.waitingToChoose(t, i));
      if (other >= 0) { if (t.seats[other].kind === 'bot') applyAction(t, other, decide(t, other, rand)); else foldOut(t, other); continue; }
      if (!room.turn || room.turn.handNo !== h.no || room.turn.phase !== 'CHOOSE') room.turn = { handNo: h.no, seq: h.seq, phase: 'CHOOSE', seat: -1, at: now };
      if (now - room.turn.at < TURN_MS) return room;
      for (let i = 0; i < t.seats.length; i++) {
        if (!seven.waitingToChoose(t, i)) continue;
        applyAction(t, i, { type: 'OPEN', index: pickOpen(h.players[i].cards, 1, rand) });
        const p = room.players[t.seats[i].id];
        if (p) p.missed += 1;
      }
      room.turn = null;
      continue;
    }
    if (handLive(t)) {
      const i = h.toAct, seat = t.seats[i];
      if (seat.kind === 'bot') { applyAction(t, i, decide(t, i, rand)); continue; }
      if (seat.kind !== 'human') { foldOut(t, i); continue; } // a chair emptied mid-turn
      if (sittingOut(room, seat)) { applyAction(t, i, { type: legalActions(t, i).canCheck ? 'CHECK' : 'FOLD' }); continue; }
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
      t.seats.forEach((s, i) => { if (s.kind === 'human' && state.users[s.id]) notePokerHand(state, state.users[s.id], h, i); });
      room.nextAt = now + NEXT_HAND_MS;
      if (room.nightly) { if (nightlyAfterHand(state, room, now)) return room; afterHand(state, room); continue; }
      if (room.tourney && tourneyAfterHand(state, room, now)) return room;
      afterHand(state, room);
      continue;
    }
    if (!room.started || room.nextAt === null || (now < room.nextAt && !aiOnly(room)) || (!humans(room).length && !room.nightly)) return room;
    standBusted(state, room);
    if (room.status !== 'OPEN') return room;
    if (!room.tourney) seatForHand(room, rand);
    if ((!seated(room).length && !room.nightly) || t.seats.filter(s => s.stack > 0).length < 2) return room;
    if (room.tourney) beforeDeal(room.tourney, t, now);
    room.prev = h ? { no: h.no, events: h.events } : null;
    startHand(t);
    room.nextAt = null;
  }
  return room;
}

// ---------- tournaments (lib/holdem-tourney.mjs) ----------
// A sit & go: the same felt and clock, but every chair gets the same tournament stack, the seats
// are fixed once the host deals, and the money moves only when the tournament is decided.
// A nightly table where only AI still hold chips plays straight through, with nobody to wait for.
const aiOnly = room => Boolean(room.nightly) && !room.table.seats.some(s => s.kind === 'human' && s.stack > 0);
const sittingOut = (room, seat) => Boolean(room.tourney && seat.kind === 'human' && (!room.players[seat.id] || room.players[seat.id].away));

function createTourneyRoom(state, user, { buyIn, floor, size, bots }, ctx) {
  const rand = ctx.rand || Math.random;
  const tier = stakeTierFor(buyIn)?.slug;
  const blinds = HOLDEM_BLINDS[tier];
  if (!blinds || !Number.isSafeInteger(buyIn)) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const seats = Number(size);
  if (!(Number.isInteger(seats) && seats >= TOURNEY.minSeats && seats <= ROOM_SEATS)) throw new Error('INVALID_ROOM_SIZE');
  ctx.validateStake(user, floor, buyIn);
  const tourney = newTourney({ base: blinds.big, fillBots: bots !== false });
  const room = {
    id: id('hrm'), code: newCode(state, rand), floor, tier, buyIn, size: seats, hostId: user.id,
    status: 'OPEN', started: false, createdAt: new Date(ctx.now).toISOString(),
    table: holdem.createTable({ seats: Array.from({ length: seats }, emptySeat), smallBlind: blinds.small, bigBlind: blinds.big, button: 0, unit: MONEY_UNIT, level: levelForFloor(floor, buyIn) }),
    players: {}, turn: null, nextAt: null, prev: null, botIn: 0, botOut: 0, tourney
  };
  takeTourneySeat(state, room, user, 0);
  rooms(state).push(room);
  return room;
}

// Everyone pays the full buy-in and gets the same stack; nobody sits once the cards are out.
function takeTourneySeat(state, room, user, i) {
  const p = addPlayer(state, room, user, room.buyIn);
  room.table.seats[i] = { id: p.userId, name: p.nickname, kind: 'human', stack: room.tourney.stack };
  p.seat = i;
  enterTourney(room.tourney, p);
}

function joinTourney(state, room, user, ctx) {
  if (room.started) throw new Error('TOURNEY_STARTED');
  if (humans(room).length >= room.size) throw new Error('ROOM_FULL');
  if (user.account.available < room.buyIn) throw new Error('INSUFFICIENT_BANKROLL');
  const i = room.table.seats.findIndex(s => s.kind === 'empty');
  if (i < 0) throw new Error('ROOM_FULL');
  takeTourneySeat(state, room, user, i);
  tick(state, room, ctx);
  return room;
}

// The host deals: AI take the empty chairs (when the host asked for them), or the table closes up.
function startTourney(room, ctx) {
  const rand = ctx.rand || Math.random;
  const t = room.table, tn = room.tourney;
  if (humans(room).length < TOURNEY.minPeople) throw new Error('NOT_ENOUGH_PLAYERS');
  if (tn.fillBots) {
    t.seats.forEach((s, i) => {
      if (s.kind !== 'empty') return;
      const bot = newBot({ seats: t.seats, buyIn: room.buyIn, big: t.bigBlind, level: t.level ?? undefined }, rand);
      t.seats[i] = { ...bot, stack: tn.stack }; // tournament chips: an AI seat brings no money
    });
  } else {
    const keep = t.seats.map((s, i) => i).filter(i => t.seats[i].kind !== 'empty');
    t.seats = keep.map(i => t.seats[i]);
    for (const p of humans(room)) { p.seat = keep.indexOf(p.seat); tn.entries[p.userId].seat = p.seat; }
  }
  t.button = Math.floor(rand() * t.seats.length);
  beginTourney(tn, t, ctx.now);
}

// After each hand: the busted are out with their place; when at most one person is left in the
// running, the money is decided and paid. Returns true when the tournament is over.
function tourneyAfterHand(state, room, now) {
  recordBusts(room.tourney, room.table);
  return endTourneyIfDecided(state, room, now);
}
function endTourneyIfDecided(state, room, now) {
  if (!tourneyDecided(room.tourney)) return false;
  finishTourney(state, room.tourney, room.table, room.code, now);
  room.status = 'DONE';
  room.turn = null;
  room.nextAt = null;
  if (!humans(room).length) state.holdemRooms = rooms(state).filter(r => r !== room);
  return true;
}

// Getting up: before the deal the buy-in comes back; with chips in play it is a forfeit (the chips
// sit out and blind away); once busted or finished it just frees the person to go elsewhere.
function leaveTourney(state, room, userId, ctx) {
  const p = room.players[userId], tn = room.tourney, e = tn.entries[userId];
  let out = { cashOut: 0, netPnl: 0, tourney: { pending: false, forfeit: false } };
  if (!room.started) {
    room.table.seats[p.seat] = emptySeat();
    settleLockedHouseGame(state, state.users[userId], { game: GAME, stake: p.buyIn, netPnl: 0, roundId: p.ticket, details: { engineVersion: HOLDEM_ENGINE, room: room.code, tourney: true, cashOut: p.buyIn } });
    delete tn.entries[userId];
    out = { cashOut: p.buyIn, netPnl: 0, tourney: { pending: false, forfeit: false } };
  } else if (forfeitEntry(state, tn, userId, room.code)) {
    out = { cashOut: 0, netPnl: -p.buyIn, tourney: { pending: false, forfeit: true } };
  } else if (e && !e.settled) {
    out = { cashOut: 0, netPnl: 0, tourney: { pending: true, forfeit: false } }; // busted: the place is settled when the tournament ends
  } else if (e) {
    out = { cashOut: e.payout, netPnl: e.payout - e.buyIn, tourney: { pending: false, forfeit: e.forfeit, place: e.place } };
  }
  delete room.players[userId];
  if (room.hostId === userId) room.hostId = humans(room)[0]?.userId ?? null;
  if (room.status === 'OPEN' && room.started) endTourneyIfDecided(state, room, ctx.now);
  if (!humans(room).length) {
    if (room.status === 'OPEN' && !room.started) room.status = 'CLOSED';
    state.holdemRooms = rooms(state).filter(r => r !== room);
  }
  return out;
}

// Back from sitting out (the clock ran out too often): play my own turns again.
export function backToSeat(state, user, code, ctx) {
  const room = findRoom(state, code);
  const p = room.players[user.id];
  if (!p) throw new Error('NOT_IN_ROOM');
  p.away = false;
  p.missed = 0;
  tick(state, room, ctx);
  return room;
}

// Finished tournaments stay readable a while for their results, then go.
function pruneDone(state, now) {
  if (!Array.isArray(state.holdemRooms)) return;
  state.holdemRooms = state.holdemRooms.filter(r => r.status !== 'DONE' || (humans(r).length && now - (r.tourney?.endedAt ?? 0) < TOURNEY.doneTtlMs));
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

// `state` lets a nightly table (lib/nightly-tourney.mjs) show the whole field, not just its own chairs.
// watch: a friend's id when `userId` is only watching (lib/watch.mjs): the table from their chair,
// with nothing to play.
export function roomView(room, userId, { hand, from } = {}, now = Date.now(), state = null, { watch = null } = {}) {
  const t = room.table;
  const eye = watch || userId;
  const me = room.players[eye];
  const seat = me ? me.seat : -1;
  const table = rules(room).publicTable(t, seat);
  if (watch) table.legal = null;
  // A chair left mid-hand shows as empty, not as a folded hand.
  table.seats.forEach((s, i) => { if (t.seats[i].kind === 'empty') Object.assign(s, { inHand: false, folded: false, cards: [] }); });
  const h = t.hand;
  const { events, prevCount } = hand === undefined ? { events: null, prevCount: 0 } : eventsSince(room, hand, from);
  return {
    code: room.code, game: roomGame(room), floor: room.floor, tier: room.tier, buyIn: room.buyIn, size: room.size,
    hostId: room.hostId, isHost: !watch && room.hostId === userId, started: room.started, status: room.status,
    mode: room.tourney ? 'tourney' : 'cash', nightly: room.nightly || null, movedTo: room.moved?.[eye] ?? null,
    tourney: room.nightly ? nightlyTourneyView(state, room, eye, now) : room.tourney ? tourneyPublic(room.tourney, t, eye, now) : null, away: Boolean(me?.away),
    me: seat, waiting: Boolean(me && seat < 0), seated: Boolean(me),
    watching: watch ? { userId: watch, nickname: me?.nickname ?? '' } : null,
    watchers: watchersOf(room.code, now),
    players: humans(room).map(p => ({ userId: p.userId, nickname: p.nickname, seat: p.seat, host: p.userId === room.hostId })),
    table,
    turn: choosing(t) && room.turn?.phase === 'CHOOSE' && room.turn.handNo === h.no ? { seat: seat >= 0 && seven.waitingToChoose(t, seat) ? seat : -1, deadline: room.turn.at + TURN_MS, ms: TURN_MS, choose: true }
      : handLive(t) && room.turn && room.turn.seq === h.seq && room.turn.handNo === h.no ? { seat: room.turn.seat, deadline: room.turn.at + TURN_MS, ms: TURN_MS } : null,
    nextAt: room.nextAt, serverNow: now,
    cursor: { hand: h?.no ?? 0, from: h?.events.length ?? 0 },
    events, prevCount,
    chat: chatView(room, eye)
  };
}

// Open rooms with a free chair, on any floor: friends sit together whatever floors each has reached.
export function listRooms(state, user, game = 'holdem') {
  return openRooms(state)
    .filter(r => !r.nightly && roomGame(r) === game)
    .filter(r => r.tourney || humans(r).length < ROOM_SEATS || r.players[user.id])
    .map(r => ({
      code: r.code, floor: r.floor, tier: r.tier, buyIn: r.buyIn, size: r.size, started: r.started,
      mode: r.tourney ? 'tourney' : 'cash', joinable: r.tourney ? !r.started && humans(r).length < r.size : true,
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
const ERRORS = { WATCH_GONE: 409, WATCH_NOT_FRIEND: 403, WATCH_CONFLICT: 403, OPEN_SEVENPOKER_SESSION: 409, OPEN_HOLDEM_SESSION: 409, NIGHTLY_TABLE: 409, TOURNEY_STARTED: 409, NOT_ENOUGH_PLAYERS: 409, ROOM_NOT_FOUND: 404, NOT_IN_ROOM: 409, ALREADY_IN_ROOM: 409, ROOM_FULL: 409, NOT_HOST: 403, INVALID_ROOM_SIZE: 400, ROOM_CODE_EXHAUSTED: 503, CHAT_EMPTY: 400, CHAT_TOO_FAST: 429, ALREADY_SHOWN: 409 };
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
      // `mine` only names a room of this game: a seat at the other poker table is the seat-elsewhere dialog's job.
      const game = url.searchParams.get('game') === 'sevenpoker' ? 'sevenpoker' : 'holdem';
      const mine = roomOfUser(state, user.id);
      return { status: 200, data: { rooms: listRooms(state, user, game), mine: mine && roomGame(mine) === game ? mine.code : null } };
    }
    // The poll: only writes when something is due (a bot to move, a clock run out, a deal).
    if (p === '/api/holdem/room' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const cursor = url.searchParams.has('hand') ? { hand: Number(url.searchParams.get('hand')), from: Number(url.searchParams.get('from')) } : {};
      const state = await loadState();
      const user = getUser(state, req);
      const room = findRoom(state, code);
      // ?watch=<friend id>: only watching a friend's chair (lib/watch.mjs).
      const watchId = url.searchParams.get('watch');
      const opts = watchId ? { watch: assertCanWatch(state, user, room, watchId) } : {};
      if (watchId) noteWatcher(room.code, user, now());
      if (!roomDue(room, now())) return { status: 200, data: { room: roomView(room, user.id, cursor, now(), state, opts) } };
      const data = await mutate(s => {
        const r = findRoom(s, code);
        tick(s, r, ctx());
        if (watchId && !r.players[watchId]) throw new Error('WATCH_GONE');
        return { room: roomView(r, user.id, cursor, now(), s, opts) };
      });
      return { status: 200, data };
    }
    if (req.method !== 'POST') return null;
    // Table talk: no idempotency log, so a line never replaces the last game command's replay.
    if (p === '/api/holdem/rooms/chat') {
      const body = await req.body();
      const cursor = body.cursor && typeof body.cursor === 'object' ? { hand: Number(body.cursor.hand), from: Number(body.cursor.from) } : {};
      const data = await mutate(s => {
        const user = getUser(s, req);
        const r = findRoom(s, body.code);
        if (!r.players[user.id]) throw new Error('NOT_IN_ROOM');
        postChat(r, user, { text: body.text, emoji: body.emoji }, now());
        return { room: roomView(r, user.id, cursor, now(), s) };
      });
      return { status: 200, data };
    }
    const verb = { '/api/holdem/rooms': 'create', '/api/holdem/rooms/join': 'join', '/api/holdem/rooms/start': 'start', '/api/holdem/rooms/action': 'act', '/api/holdem/rooms/leave': 'leave', '/api/holdem/rooms/show': 'show', '/api/holdem/rooms/back': 'back' }[p];
    if (!verb) return null;
    const body = await req.body();
    const key = normalizeKey(req.header('x-idempotency-key'));
    const cursor = body.cursor && typeof body.cursor === 'object' ? { hand: Number(body.cursor.hand), from: Number(body.cursor.from) } : {};
    const data = await mutate(state => {
      const user = getUser(state, req);
      const fingerprint = JSON.stringify({ verb, code: normalizeCode(body.code), buyIn: body.buyIn ?? null, floor: body.floor ?? null, size: body.size ?? null, mode: body.mode ?? null, bots: body.bots ?? null, game: body.game ?? null, handNo: body.handNo ?? null, seq: body.seq ?? null, action: body.action ?? null, amount: body.amount ?? null });
      const reply = (code, result, replayed) => {
        const room = code ? viewableRooms(state).find(r => r.code === code) : null;
        return { room: room ? roomView(room, user.id, cursor, now(), state) : null, result, replayed, state: summarize(state, user) };
      };
      const last = cmdLog(state)[user.id];
      if (key && last?.key === key) {
        if (last.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
        return reply(last.code, last.result, true);
      }
      let room, result = null;
      if (verb === 'create') room = createRoom(state, user, { buyIn: Number(body.buyIn), floor: body.floor || FLOORS[0].slug, size: body.size ?? ROOM_SEATS, mode: body.mode === 'tourney' ? 'tourney' : 'cash', bots: body.bots !== false, game: body.game === 'sevenpoker' ? 'sevenpoker' : 'holdem' }, ctx());
      else if (verb === 'join') room = joinRoom(state, user, body.code, ctx());
      else if (verb === 'start') room = startRoom(state, user, body.code, ctx());
      else if (verb === 'act') room = roomAction(state, user, body.code, body, ctx());
      else if (verb === 'show') room = showCards(state, user, body.code, ctx());
      else if (verb === 'back') room = backToSeat(state, user, body.code, ctx());
      else {
        const out = leaveRoom(state, user, body.code, ctx());
        room = out.room;
        result = { cashOut: out.cashOut, netPnl: out.netPnl, ...(out.tourney && { tourney: out.tourney }) };
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
