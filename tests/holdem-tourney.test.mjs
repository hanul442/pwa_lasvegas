import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, leaveRoom, startRoom, roomAction, tick, roomView, listRooms, roomOfUser, NEXT_HAND_MS, TURN_MS, MISSED_TURNS_LIMIT } from '../lib/holdem-room.mjs';
import { createRoom as createTableRoom } from '../lib/table-room.mjs';
import { TOURNEY, tourneyPayouts, tourneyBlinds } from '../lib/holdem-tourney.mjs';
import { validateRoomStake } from '../lib/stakes.mjs';
import { FLOORS, MONEY_UNIT } from '../lib/constants.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validateStake = (user, floor, stake) => validateRoomStake(user, FLOORS.find(f => f.slug === floor), stake);
const PEOPLE = ['hanseo', 'min', 'june', 'zero'];
const BUY_IN = 50_000_000;

function world(seed = 7) {
  seed += Number(process.env.ROOM_SEED || 0);
  const state = defaultState();
  for (const uid of PEOPLE) state.users[uid].account.available = 900_000_000;
  let clock = 1_000_000;
  const rand = seeded(seed);
  const ctx = () => ({ now: clock, rand, validateStake });
  return { state, ctx, advance: ms => { clock += ms; }, get now() { return clock; } };
}
const money = state => PEOPLE.reduce((a, id) => a + state.users[id].account.available + state.users[id].account.locked, 0);
const tableChips = room => room.table.seats.reduce((a, s) => a + s.stack, 0) + (room.table.hand && !room.table.hand.over ? room.table.hand.players.reduce((a, p) => a + (p ? p.committed : 0), 0) : 0);

function tourney(w, people, { size = people.length, bots = true } = {}) {
  const { state } = w;
  const room = createRoom(state, state.users[people[0]], { buyIn: BUY_IN, floor: 'high-limit', size, mode: 'tourney', bots }, w.ctx());
  for (const id of people.slice(1)) joinRoom(state, state.users[id], room.code, w.ctx());
  return room;
}

// Plays until the tournament is decided: people shove often, so stacks move fast.
function playOut(w, room, { steps = 20000, onHand, shoveEvery = 3 } = {}) {
  const { state } = w;
  const chips = tableChips(room);
  for (let step = 0; step < steps && room.status === 'OPEN'; step++) {
    const h = room.table.hand;
    if (!h || h.over) { w.advance(NEXT_HAND_MS); tick(state, room, w.ctx()); onHand?.(); continue; }
    const seat = room.table.seats[h.toAct];
    assert.equal(seat.kind, 'human');
    const user = state.users[seat.id];
    const legal = roomView(room, user.id).table.legal;
    const shove = step % shoveEvery === 0 && legal.canRaise;
    const action = shove ? { action: 'RAISE', amount: legal.maxRaiseTo ?? legal.minRaiseTo } : { action: legal.canCheck ? 'CHECK' : 'CALL' };
    roomAction(state, user, room.code, { handNo: h.no, seq: h.seq, ...action }, w.ctx());
    assert.equal(tableChips(room), chips, 'tournament chips never appear or vanish');
  }
}

test('payout split: winner takes all under four people, 70/30 from four, whole 100만s, remainder to 1st', () => {
  assert.deepEqual(tourneyPayouts(150_000_000, 3), [150_000_000]);
  assert.deepEqual(tourneyPayouts(200_000_000, 4), [140_000_000, 60_000_000]);
  for (const [prize, n] of [[4 * 13_000_000, 4], [5 * 17_000_000, 5], [6 * 33_000_000, 6]]) {
    const pay = tourneyPayouts(prize, n);
    assert.equal(pay.reduce((a, x) => a + x, 0), prize);
    assert.ok(pay.every(x => x % MONEY_UNIT === 0));
    assert.ok(pay[0] > pay[1]);
  }
  assert.equal(tourneyBlinds(2_000_000, 1).big, 4_000_000);
});

test('create, join and start: the same stack for all, buy-ins locked, AI fill the chairs, no late registration', () => {
  const w = world(3);
  const { state } = w;
  const room = tourney(w, ['hanseo', 'min', 'june'], { size: 5 });
  assert.equal(room.table.seats.length, 5);
  for (const id of ['hanseo', 'min', 'june']) assert.equal(state.users[id].account.locked, BUY_IN, id);
  const view = roomView(room, 'min');
  assert.equal(view.mode, 'tourney');
  assert.equal(view.tourney.stack, TOURNEY.depth * room.table.bigBlind);
  assert.equal(view.tourney.prize, 3 * BUY_IN);
  const listed = listRooms(state, state.users.zero).find(r => r.code === room.code);
  assert.equal(listed.mode, 'tourney');
  assert.equal(listed.joinable, true);
  assert.throws(() => startRoom(state, state.users.min, room.code, w.ctx()), /NOT_HOST/);
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.table.seats.filter(s => s.kind === 'bot').length, 2);
  const stack = room.tourney.stack;
  assert.ok(room.table.seats.every(s => s.stack + (room.table.hand?.players[room.table.seats.indexOf(s)]?.committed ?? 0) === stack), 'everyone starts with the same chips');
  assert.equal(room.tourney.prize, 3 * BUY_IN, 'AI seats add nothing to the pool');
  assert.throws(() => joinRoom(state, state.users.zero, room.code, w.ctx()), /TOURNEY_STARTED/);
  assert.equal(listRooms(state, state.users.zero).find(r => r.code === room.code).joinable, false);
  assert.equal(state.users.zero.account.locked, 0);
});

test('a tournament needs two people, and without AI the table closes up to who came', () => {
  const w = world(4);
  const { state } = w;
  const solo = tourney(w, ['hanseo'], { size: 4 });
  assert.throws(() => startRoom(state, state.users.hanseo, solo.code, w.ctx()), /NOT_ENOUGH_PLAYERS/);
  leaveRoom(state, state.users.hanseo, solo.code, w.ctx());
  assert.equal(state.users.hanseo.account.locked, 0);
  assert.equal(state.users.hanseo.account.available, 900_000_000, 'leaving before the deal hands the buy-in back');
  const room = tourney(w, ['hanseo', 'min', 'june'], { size: 6, bots: false });
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.table.seats.length, 3);
  assert.ok(room.table.seats.every(s => s.kind === 'human'));
  for (const p of Object.values(room.players)) assert.equal(room.table.seats[p.seat].id, p.userId);
});

test('blinds climb on the clock, at the next deal, and the view counts down to the next level', () => {
  const w = world(5);
  const { state } = w;
  const room = tourney(w, ['hanseo', 'min'], { size: 2, bots: false });
  const base = room.table.bigBlind;
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  let view = roomView(room, 'hanseo', {}, w.now);
  assert.equal(view.tourney.level, 1);
  assert.equal(view.tourney.levelEndsAt - w.now, TOURNEY.levelMs);
  assert.equal(view.tourney.next.big, tourneyBlinds(base, 1).big);
  w.advance(TOURNEY.levelMs);
  tick(state, room, w.ctx()); // whoever was thinking ran out of time meanwhile
  // The hand in progress keeps its blinds; the next deal takes the new level.
  assert.equal(room.table.bigBlind, base);
  for (let k = 0; k < 50 && room.table.hand && !room.table.hand.over; k++) {
    const h = room.table.hand;
    roomAction(state, state.users[room.table.seats[h.toAct].id], room.code, { handNo: h.no, seq: h.seq, action: 'FOLD' }, w.ctx());
  }
  w.advance(NEXT_HAND_MS); tick(state, room, w.ctx());
  assert.equal(room.table.bigBlind, tourneyBlinds(base, 1).big);
  assert.equal(room.table.hand.events[0].bigBlind, room.table.bigBlind);
  view = roomView(room, 'min', {}, w.now);
  assert.equal(view.tourney.level, 2);
  assert.equal(view.tourney.levelEndsAt, room.tourney.startedAt + 2 * TOURNEY.levelMs);
  // A long break jumps straight to the level the clock says.
  w.advance(5 * TOURNEY.levelMs);
  tick(state, room, w.ctx());
  for (let k = 0; k < 50 && room.table.hand && !room.table.hand.over; k++) {
    const h = room.table.hand;
    roomAction(state, state.users[room.table.seats[h.toAct].id], room.code, { handNo: h.no, seq: h.seq, action: 'FOLD' }, w.ctx());
  }
  w.advance(NEXT_HAND_MS); tick(state, room, w.ctx());
  assert.equal(roomView(room, 'min', {}, w.now).tourney.level, 7);
});

test('played to the end: people are eliminated in order and the prizes add up to the locked buy-ins', () => {
  for (const seed of [11, 12, 13]) {
    const w = world(seed);
    const { state } = w;
    const before = money(state);
    const room = tourney(w, PEOPLE, { size: 6 });
    startRoom(state, state.users.hanseo, room.code, w.ctx());
    const locked = PEOPLE.reduce((a, id) => a + state.users[id].account.locked, 0);
    assert.equal(locked, 4 * BUY_IN);
    const seen = [];
    playOut(w, room, { onHand: () => { for (const o of room.tourney.out) if (!seen.includes(o.seat)) seen.push(o.seat); } });
    assert.equal(room.status, 'DONE', `seed ${seed} decided`);
    const tn = room.tourney;
    const entries = Object.values(tn.entries);
    assert.ok(entries.every(e => e.place >= 1 && e.place <= 4));
    assert.equal(entries.filter(e => e.place === 1).length >= 1, true);
    // Later out, better place; out in the same hand, the deeper stack places higher (equal stacks share).
    const humansOut = tn.out.filter(o => o.kind === 'human').map(o => ({ ...o, e: tn.entries[o.id] }));
    for (const a of humansOut) for (const b of humansOut) {
      if (a.hand > b.hand || (a.hand === b.hand && a.start > b.start)) assert.ok(a.e.place < b.e.place, `${a.name} before ${b.name}`);
      if (a.hand === b.hand && a.start === b.start) assert.equal(a.e.place, b.e.place, 'a tie shares the place');
    }
    const paid = entries.reduce((a, e) => a + e.payout, 0);
    assert.equal(paid, locked, 'the whole pool and nothing more is paid');
    assert.ok(entries.every(e => e.payout % MONEY_UNIT === 0));
    if (new Set(entries.map(e => e.place)).size === 4) assert.deepEqual(entries.filter(e => e.payout).map(e => [e.place, e.payout]).sort(), [[1, 140_000_000], [2, 60_000_000]]);
    for (const id of PEOPLE) assert.equal(state.users[id].account.locked, 0, id);
    assert.equal(money(state), before, 'AI seats neither add money nor take it');
    for (const id of PEOPLE) {
      const rows = state.ledger.filter(tx => tx.userId === id && tx.metadata?.room === room.code && tx.type.startsWith('GAME_'));
      assert.equal(rows.length, 1, `${id} settled once`);
      assert.equal(rows[0].rawPnlDelta, tn.entries[id].payout - BUY_IN);
    }
    assert.equal(roomOfUser(state, 'hanseo'), null, 'a finished tournament holds nobody');
    const view = roomView(room, 'min', {}, w.now);
    assert.equal(view.status, 'DONE');
    assert.equal(view.tourney.standings[0].place, 1);
    for (const id of PEOPLE) leaveRoom(state, state.users[id], room.code, w.ctx());
    assert.equal(state.holdemRooms.length, 0);
  }
});

test('getting up mid-tournament forfeits: the chips sit out and blind away, the buy-in stays in the pool', () => {
  const w = world(21);
  const { state } = w;
  const before = money(state);
  const room = tourney(w, ['hanseo', 'min', 'june'], { size: 3, bots: false });
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const seat = room.players.june.seat;
  const out = leaveRoom(state, state.users.june, room.code, w.ctx());
  assert.equal(out.netPnl, -BUY_IN);
  assert.equal(out.tourney.forfeit, true);
  assert.equal(state.users.june.account.locked, 0);
  assert.equal(state.users.june.account.available, 900_000_000 - BUY_IN);
  assert.equal(room.status, 'OPEN', 'two people still play');
  assert.equal(room.table.seats[seat].kind, 'human', 'the chair keeps its chips');
  assert.equal(roomOfUser(state, 'june'), null, 'June is free to sit elsewhere');
  // June's seat never holds the turn: it checks or folds at once.
  for (let k = 0; k < 30 && room.status === 'OPEN'; k++) {
    const h = room.table.hand;
    if (!h || h.over) { w.advance(NEXT_HAND_MS); tick(state, room, w.ctx()); continue; }
    assert.notEqual(h.toAct, seat);
    const s = room.table.seats[h.toAct];
    const legal = roomView(room, s.id).table.legal;
    roomAction(state, state.users[s.id], room.code, { handNo: h.no, seq: h.seq, action: legal.canCheck ? 'CHECK' : 'CALL' }, w.ctx());
  }
  playOut(w, room);
  assert.equal(room.status, 'DONE');
  const tn = room.tourney;
  assert.equal(tn.entries.june.place, null);
  assert.equal(tn.entries.june.payout, 0);
  assert.equal([tn.entries.hanseo.payout, tn.entries.min.payout].sort().join(), [0, 3 * BUY_IN].join(), 'winner takes all three buy-ins');
  assert.equal(money(state), before);
});

test('when only one person is left in the running, the tournament ends at once', () => {
  const w = world(22);
  const { state } = w;
  const room = tourney(w, ['hanseo', 'min'], { size: 6 });
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  leaveRoom(state, state.users.min, room.code, w.ctx());
  assert.equal(room.status, 'DONE');
  assert.equal(room.tourney.entries.hanseo.place, 1);
  assert.equal(state.users.hanseo.account.available, 900_000_000 + BUY_IN);
  assert.equal(state.users.min.account.available, 900_000_000 - BUY_IN);
});

// Folds (or checks) every turn until the hand in progress is over.
function foldHand(w, room) {
  for (let k = 0; k < 60 && room.table.hand && !room.table.hand.over; k++) {
    const h = room.table.hand, s = room.table.seats[h.toAct];
    const legal = roomView(room, s.id).table.legal;
    roomAction(w.state, w.state.users[s.id], room.code, { handNo: h.no, seq: h.seq, action: legal.canCheck ? 'CHECK' : 'FOLD' }, w.ctx());
  }
}

test('busted players can leave before the end; their place is paid when it is decided', () => {
  const w = world(23);
  const { state } = w;
  const room = tourney(w, PEOPLE, { size: 4, bots: false });
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  foldHand(w, room);
  // Zero's chips go to Hanseo between hands (as if lost); the next hand deals Zero out.
  const z = room.players.zero.seat, hs = room.players.hanseo.seat;
  room.table.seats[hs].stack += room.table.seats[z].stack;
  room.table.seats[z].stack = 0;
  w.advance(NEXT_HAND_MS); tick(state, room, w.ctx());
  foldHand(w, room);
  assert.ok(room.tourney.entries.zero.out, 'Zero is out');
  assert.equal(roomView(room, 'zero').tourney.me.place, 4);
  const out = leaveRoom(state, state.users.zero, room.code, w.ctx());
  assert.equal(out.tourney.pending, true);
  assert.equal(state.users.zero.account.locked, BUY_IN, 'still locked until the end');
  assert.equal(roomOfUser(state, 'zero'), null);
  playOut(w, room);
  assert.equal(room.status, 'DONE');
  assert.equal(room.tourney.entries.zero.place, 4);
  assert.equal(state.users.zero.account.locked, 0);
  assert.equal(state.users.zero.account.available, 900_000_000 - BUY_IN);
  assert.equal(PEOPLE.reduce((a, id) => a + room.tourney.entries[id].payout, 0), 4 * BUY_IN);
});

test('one room at a time: a tournament seat blocks other rooms until it is left', () => {
  const w = world(24);
  const { state } = w;
  const room = tourney(w, ['hanseo', 'min'], { size: 2 });
  assert.throws(() => createRoom(state, state.users.hanseo, { buyIn: BUY_IN, floor: 'high-limit', mode: 'tourney' }, w.ctx()), /ALREADY_IN_ROOM/);
  assert.throws(() => createTableRoom(state, state.users.min, { game: 'seotda', stake: 10_000_000, floor: 'high-limit', size: 3 }, w.ctx()), /ALREADY_IN_ROOM/);
  const other = tourney(w, ['june'], { size: 3 });
  assert.throws(() => joinRoom(state, state.users.min, other.code, w.ctx()), /ALREADY_IN_ROOM/);
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  leaveRoom(state, state.users.min, room.code, w.ctx()); // a forfeit; Hanseo wins
  assert.equal(room.status, 'DONE');
  joinRoom(state, state.users.min, other.code, w.ctx());
  joinRoom(state, state.users.hanseo, other.code, w.ctx()); // still listed in the finished room, but it holds nobody
});

test('a person whose clock keeps running out sits out instead of being cashed out, and can come back', () => {
  const w = world(25);
  const { state } = w;
  const room = tourney(w, ['hanseo', 'min'], { size: 3 });
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  for (let k = 0; k < 400 && !room.players.min?.away && room.status === 'OPEN'; k++) {
    const h = room.table.hand;
    if (h && !h.over && room.table.seats[h.toAct].id === 'hanseo') {
      const legal = roomView(room, 'hanseo').table.legal;
      roomAction(state, state.users.hanseo, room.code, { handNo: h.no, seq: h.seq, action: legal.canCheck ? 'CHECK' : 'FOLD' }, w.ctx());
    } else { w.advance(TURN_MS); tick(state, room, w.ctx()); }
  }
  if (room.status !== 'OPEN') return; // decided by the cards first
  assert.ok(room.players.min.missed >= MISSED_TURNS_LIMIT);
  assert.equal(state.users.min.account.locked, BUY_IN, 'not cashed out');
  assert.equal(roomView(room, 'min').away, true);
});

// ---------- API ----------
function memoryStore() {
  let state = defaultState();
  for (const uid of PEOPLE) state.users[uid].account.available = 900_000_000;
  let queue = Promise.resolve();
  return {
    peek: () => state,
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; });
      queue = task.catch(() => {});
      return task;
    }
  };
}
let n = 0;
const call = (store, player, method, path, body, key = `k-tourney-${++n}`) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? key : h === 'x-player-id' ? player : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('tournaments over the API: create, list with a badge, join, start, late join refused, forfeit', async () => {
  const store = memoryStore();
  const made = await call(store, 'hanseo', 'POST', '/api/holdem/rooms', { buyIn: BUY_IN, floor: 'high-limit', size: 4, mode: 'tourney', bots: true });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  assert.equal(made.data.room.mode, 'tourney');
  assert.equal(made.data.room.tourney.fillBots, true);
  const listed = (await call(store, 'min', 'GET', '/api/holdem/rooms')).data.rooms.find(r => r.code === code);
  assert.deepEqual([listed.mode, listed.started, listed.joinable], ['tourney', false, true]);
  assert.equal((await call(store, 'min', 'POST', '/api/holdem/rooms/join', { code })).status, 200);
  const started = await call(store, 'hanseo', 'POST', '/api/holdem/rooms/start', { code, cursor: { hand: 0, from: 0 } });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.room.tourney.entrants, 4);
  const late = await call(store, 'june', 'POST', '/api/holdem/rooms/join', { code });
  assert.equal(late.status, 409);
  assert.equal(late.data.error, 'TOURNEY_STARTED');
  const relisted = (await call(store, 'june', 'GET', '/api/holdem/rooms')).data.rooms.find(r => r.code === code);
  assert.deepEqual([relisted.started, relisted.joinable], [true, false]);
  const left = await call(store, 'min', 'POST', '/api/holdem/rooms/leave', { code });
  assert.equal(left.status, 200, JSON.stringify(left.data));
  assert.equal(left.data.result.tourney.forfeit, true);
  const poll = await call(store, 'hanseo', 'GET', `/api/holdem/room?code=${code}`);
  assert.equal(poll.data.room.status, 'DONE');
  assert.equal(poll.data.room.tourney.me.place, 1);
  assert.equal(poll.data.room.tourney.me.payout, 2 * BUY_IN);
  assert.equal(store.peek().users.hanseo.account.available, 900_000_000 + BUY_IN);
  const back = await call(store, 'hanseo', 'POST', '/api/holdem/rooms/back', { code });
  assert.equal(back.status, 200);
  const bye = await call(store, 'hanseo', 'POST', '/api/holdem/rooms/leave', { code });
  assert.equal(bye.status, 200, JSON.stringify(bye.data));
  assert.equal(store.peek().holdemRooms.length, 0);
});
