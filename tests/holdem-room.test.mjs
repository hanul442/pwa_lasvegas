import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, leaveRoom, startRoom, roomAction, showCards, tick, roomDue, roomView, listRooms, tableChips, TURN_MS, NEXT_HAND_MS, MISSED_TURNS_LIMIT } from '../lib/holdem-room.mjs';
import { validateStakeAgainstFloor } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

// Small seeded generator so bot play is repeatable.
function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validateStake = (user, floor, stake) => validateStakeAgainstFloor(user, FLOORS.find(f => f.slug === floor), stake);

function world(seed = 7) {
  seed += Number(process.env.ROOM_SEED || 0);
  const state = defaultState();
  let clock = 1_000_000;
  const rand = seeded(seed);
  const ctx = () => ({ now: clock, rand, validateStake });
  return { state, ctx, advance: ms => { clock += ms; }, get now() { return clock; } };
}

// Chips can only enter or leave the table with a person or a bot. Pending buy-ins are locked
// but not yet on the felt.
function audit(w, room, start) {
  const users = Object.values(w.state.users);
  const pending = Object.values(room.players).filter(p => p.seat < 0).reduce((a, p) => a + p.buyIn, 0);
  return users.reduce((a, u) => a + u.account.available, 0) + tableChips(room) + pending - (room.botIn - room.botOut) - start;
}
const availableTotal = state => Object.values(state.users).reduce((a, u) => a + u.account.available + u.account.locked, 0);

test('several people and bots play hands; every chip is accounted for when they get up', () => {
  const w = world(11);
  const { state } = w;
  const before = Object.fromEntries(Object.values(state.users).map(u => [u.id, u.account.available]));
  const startAvail = Object.values(state.users).reduce((a, u) => a + u.account.available, 0);
  const room = createRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 5 }, w.ctx());
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{4}$/);
  joinRoom(state, state.users.min, room.code, w.ctx());
  joinRoom(state, state.users.june, room.code.toLowerCase(), w.ctx());
  assert.equal(state.users.min.account.locked, 500_000);
  assert.equal(audit(w, room, startAvail), 0);
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.table.seats.filter(s => s.kind !== 'empty').length, 5, 'bots fill the table to the size picked');
  assert.equal(room.table.seats.filter(s => s.kind === 'bot').length, 2);

  let hands = 0;
  for (let step = 0; step < 4000 && hands < 12; step++) {
    const h = room.table.hand;
    if (!h || h.over) { w.advance(NEXT_HAND_MS); tick(state, room, w.ctx()); hands++; assert.equal(audit(w, room, startAvail), 0); continue; }
    const seat = room.table.seats[h.toAct];
    assert.equal(seat.kind, 'human', 'bots never hold the turn');
    const user = state.users[seat.id];
    const legal = roomView(room, user.id).table.legal;
    const action = step % 7 === 0 && legal.canRaise ? { action: 'RAISE', amount: legal.minRaiseTo } : { action: legal.canCheck ? 'CHECK' : 'CALL' };
    roomAction(state, user, room.code, { handNo: h.no, seq: h.seq, ...action }, w.ctx());
    assert.equal(audit(w, room, startAvail), 0);
    if (room.status !== 'OPEN') break;
  }
  // Unless everyone busted (then the table already stood them up), June gets up in the middle
  // of a fresh hand; then everyone else.
  assert.ok(room.table.handNo >= 5 || room.status === 'CLOSED', `played ${room.table.handNo} hands`);
  if (room.status === 'OPEN') {
    w.advance(NEXT_HAND_MS); tick(state, room, w.ctx());
    assert.ok(room.table.hand && !room.table.hand.over, 'a hand is running');
  }
  const results = {};
  for (const id of ['june', 'min', 'hanseo']) {
    if (room.status !== 'OPEN' || !room.players[id]) continue;
    results[id] = leaveRoom(state, state.users[id], room.code, w.ctx());
    if (room.status === 'OPEN') assert.equal(audit(w, room, startAvail), 0);
  }
  assert.equal(room.status, 'CLOSED');
  assert.equal(state.holdemRooms.length, 0);
  for (const id of ['hanseo', 'min', 'june']) {
    const acct = state.users[id].account;
    assert.equal(acct.locked, 0, id);
    const settled = state.ledger.filter(tx => tx.userId === id && tx.metadata?.room === room.code && tx.type.startsWith('GAME_'));
    assert.equal(settled.length, 1, `${id} settled once`);
    assert.equal(acct.available, before[id] + settled[0].rawPnlDelta, id);
  }
});

test('nobody can act out of turn, twice on the same seq, or see another hand', () => {
  const w = world(3);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 3 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  // Deal until a person holds the turn.
  for (let k = 0; k < 50 && !(room.table.hand && !room.table.hand.over); k++) { w.advance(NEXT_HAND_MS); tick(state, room, w.ctx()); }
  const h = room.table.hand;
  const actor = room.table.seats[h.toAct].id;
  const other = actor === 'hanseo' ? 'min' : 'hanseo';
  assert.throws(() => roomAction(state, state.users[other], room.code, { handNo: h.no, seq: h.seq, action: 'FOLD' }, w.ctx()), /NOT_YOUR_TURN/);
  const seq = h.seq;
  roomAction(state, state.users[actor], room.code, { handNo: h.no, seq, action: 'FOLD' }, w.ctx());
  assert.throws(() => roomAction(state, state.users[actor], room.code, { handNo: h.no, seq, action: 'FOLD' }, w.ctx()), /STALE_ACTION|NOT_YOUR_TURN/);

  // Hole cards: mine face up, everyone else's hidden until a showdown shows them.
  w.advance(NEXT_HAND_MS); tick(state, room, w.ctx());
  const view = roomView(room, 'hanseo', { hand: room.table.handNo, from: 0 });
  const shown = new Set((room.table.hand.events || []).filter(e => e.t === 'show').map(e => e.seat));
  view.table.seats.forEach((s, i) => {
    if (!s.inHand) return;
    if (i === view.me) assert.ok(s.cards.every(c => c !== 'HIDDEN'));
    else if (!shown.has(i)) assert.ok(s.cards.every(c => c === 'HIDDEN'), `seat ${i} hidden`);
  });
  const spectator = roomView(room, 'zero');
  assert.equal(spectator.me, -1);
  spectator.table.seats.forEach((s, i) => { if (s.inHand && !shown.has(i)) assert.ok(s.cards.every(c => c === 'HIDDEN')); });
  assert.ok(view.events.length > 0);
  for (const e of view.events) if (e.t === 'deal' || e.t === 'act' || e.t === 'blind') assert.ok(!('cards' in e), 'no hole cards in the event stream');
});

test('a turn clock that runs out checks or folds for the player, lazily, and repeated no-shows stand up', () => {
  const w = world(5);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 3 }, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  for (let k = 0; k < 50 && !(room.table.hand && !room.table.hand.over); k++) { w.advance(NEXT_HAND_MS); tick(state, room, w.ctx()); }
  const h = room.table.hand;
  assert.equal(room.table.seats[h.toAct].id, 'hanseo');
  w.advance(TURN_MS - 1);
  assert.equal(roomDue(room, w.now), false, 'nothing to do before the clock runs out');
  const view = roomView(room, 'hanseo');
  assert.equal(view.turn.seat, h.toAct);
  assert.equal(view.turn.deadline - w.now, 1);
  w.advance(1);
  assert.equal(roomDue(room, w.now), true);
  const from = h.events.length;
  tick(state, room, w.ctx());
  const timed = h.events.slice(from).find(e => e.t === 'act' && e.timeout);
  assert.ok(timed && ['CHECK', 'FOLD'].includes(timed.action));
  // Walk away: the table keeps dealing and after enough missed turns stands the player up.
  for (let k = 0; k < 400 && room.status === 'OPEN'; k++) { w.advance(TURN_MS); tick(state, room, w.ctx()); }
  assert.equal(room.status, 'CLOSED');
  assert.ok(MISSED_TURNS_LIMIT >= 2);
  assert.equal(state.users.hanseo.account.locked, 0);
});

test('the next hand deals itself a few seconds after the last, and a mid-hand leaver folds out', () => {
  const w = world(9);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 4 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  // Fold every human turn until a hand ends, then check the gap before the next deal.
  for (let k = 0; k < 40 && room.table.hand && !room.table.hand.over; k++) {
    const h = room.table.hand;
    roomAction(state, state.users[room.table.seats[h.toAct].id], room.code, { handNo: h.no, seq: h.seq, action: 'FOLD' }, w.ctx());
  }
  const no = room.table.handNo;
  w.advance(NEXT_HAND_MS - 1); tick(state, room, w.ctx());
  assert.equal(room.table.handNo, no, 'not yet');
  w.advance(1); tick(state, room, w.ctx());
  assert.equal(room.table.handNo, no + 1, 'dealt');
  const polled = roomView(room, 'min', { hand: no, from: 0 });
  assert.ok(polled.prevCount > 0 && polled.events.slice(polled.prevCount)[0].t === 'hand', 'a late poll gets the end of the last hand, then the new one');

  const h = room.table.hand;
  const minSeat = room.players.min.seat;
  const start = state.users.min.account.available;
  const stack = room.table.seats[minSeat].stack;
  const out = leaveRoom(state, state.users.min, room.code, w.ctx());
  assert.equal(out.cashOut, stack, 'what is behind the line goes home; the pot stays');
  assert.equal(state.users.min.account.available, start + stack);
  assert.ok(h.events.some(e => e.t === 'act' && e.seat === minSeat && e.action === 'FOLD') || !h.players[minSeat]);
  assert.equal(room.table.seats[minSeat].kind, 'empty');
  assert.equal(room.hostId, 'hanseo');
});

test('people join a running table: a free chair at once, otherwise at the next deal', () => {
  const w = world(13);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 6 }, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.table.seats.filter(s => s.kind === 'bot').length, 5);
  joinRoom(state, state.users.min, room.code, w.ctx());
  const live = room.table.hand && !room.table.hand.over;
  if (live) assert.equal(room.players.min.seat, -1, 'waits for the deal');
  for (let k = 0; k < 200 && room.players.min.seat < 0; k++) { w.advance(TURN_MS); tick(state, room, w.ctx()); }
  assert.ok(room.players.min.seat >= 0);
  assert.equal(room.table.seats.filter(s => s.kind !== 'empty').length, 6);
});

test('the room module stays runtime-neutral (no file system, runs in the Worker)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../lib/holdem-room.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from 'node:(fs|path)/);
});

// ---------- API ----------
function memoryStore() {
  let state = defaultState();
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
const call = (store, player, method, path, body, key = `k-room-${++n}`) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? key : h === 'x-player-id' ? player : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('rooms over the API: create, list, join by code, poll with a cursor, act, leave', async () => {
  const store = memoryStore();
  const total = availableTotal(store.peek());
  const made = await call(store, 'hanseo', 'POST', '/api/holdem/rooms', { buyIn: 500_000, floor: 'downtown', size: 3 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  assert.equal(made.data.state.user.account.locked, 500_000);
  assert.equal((await call(store, 'hanseo', 'POST', '/api/holdem/sit', { buyIn: 500_000, floor: 'downtown' })).data.error, 'OPEN_HOLDEM_SESSION');

  const listed = await call(store, 'min', 'GET', '/api/holdem/rooms');
  assert.ok(listed.data.rooms.some(r => r.code === code && r.host === 'HANSEO'));
  // A room on a floor the viewer hasn't opened isn't offered, and its code doesn't let them in.
  const vip = await call(store, 'zero', 'POST', '/api/holdem/rooms', { buyIn: 20_000_000, floor: 'high-limit' });
  assert.equal(vip.status, 201, JSON.stringify(vip.data));
  assert.ok(!(await call(store, 'min', 'GET', '/api/holdem/rooms')).data.rooms.some(r => r.code === vip.data.room.code));
  assert.equal((await call(store, 'min', 'POST', '/api/holdem/rooms/join', { code: vip.data.room.code })).data.error, 'FLOOR_LOCKED');
  assert.equal((await call(store, 'june', 'POST', '/api/holdem/rooms/join', { code: 'ZZZZ' })).status, 404);

  const joined = await call(store, 'min', 'POST', '/api/holdem/rooms/join', { code }, 'k-join-min');
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  assert.equal((await call(store, 'min', 'POST', '/api/holdem/rooms/join', { code }, 'k-join-min')).data.replayed, true);
  assert.equal(store.peek().users.min.account.locked, 500_000, 'a replayed join locks once');
  assert.equal((await call(store, 'min', 'POST', '/api/holdem/rooms/start', { code })).status, 403, 'only the host deals');
  const started = await call(store, 'hanseo', 'POST', '/api/holdem/rooms/start', { code, cursor: { hand: 0, from: 0 } });
  assert.equal(started.status, 200, JSON.stringify(started.data));

  // Play a hand through polls, each player acting on their own turn.
  let cursor = { hand: 0, from: 0 };
  let acted = 0;
  for (let k = 0; k < 60; k++) {
    const poll = await call(store, 'hanseo', 'GET', `/api/holdem/room?code=${code}&hand=${cursor.hand}&from=${cursor.from}`);
    assert.equal(poll.status, 200, JSON.stringify(poll.data));
    const room = poll.data.room;
    if (room.events) for (const e of room.events) if (e.t === 'deal') assert.ok(!('cards' in e));
    cursor = room.cursor;
    const t = room.table;
    if (t.handOver) break;
    const who = t.seats[t.toAct].id;
    const view = (await call(store, who, 'GET', `/api/holdem/room?code=${code}`)).data.room;
    const res = await call(store, who, 'POST', '/api/holdem/rooms/action', { code, handNo: t.handNo, seq: t.seq, action: view.table.legal.canCheck ? 'CHECK' : 'CALL' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    acted++;
  }
  assert.ok(acted > 0);
  for (const who of ['min', 'hanseo', 'zero']) {
    const res = await call(store, who, 'POST', '/api/holdem/rooms/leave', { code: who === 'zero' ? vip.data.room.code : code });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.state.user.account.locked, 0);
    assert.equal(typeof res.data.result.netPnl, 'number');
  }
  assert.equal(availableTotal(store.peek()) - total, store.peek().ledger.filter(tx => tx.metadata?.room).reduce((a, tx) => a + tx.rawPnlDelta, 0), 'the only change is the settled results');
  assert.equal((await call(store, 'hanseo', 'GET', '/api/holdem/rooms')).data.mine, null);
});

// Plays the current hand to its end: whoever is to act folds (or checks when that is free).
function finishHand(state, room, w) {
  for (let guard = 0; guard < 200 && room.table.hand && !room.table.hand.over; guard++) {
    const h = room.table.hand, seat = room.table.seats[h.toAct];
    const legal = roomView(room, seat.id).table.legal;
    roomAction(state, state.users[seat.id], room.code, { handNo: h.no, seq: h.seq, action: legal.canCheck ? 'CHECK' : 'FOLD' }, w.ctx());
  }
}

test('after a hand a player can turn their cards up for the table, once', () => {
  const w = world(5);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 3 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.throws(() => showCards(state, state.users.hanseo, room.code, w.ctx()), /HAND_NOT_ACTIVE/);
  finishHand(state, room, w);
  const me = room.players.hanseo.seat;
  const mine = roomView(room, 'hanseo').table.seats[me].cards;
  assert.ok(roomView(room, 'min').table.seats[me].cards.every(c => c === 'HIDDEN') || room.table.hand.events.some(e => e.t === 'show' && e.seat === me));
  showCards(state, state.users.hanseo, room.code, w.ctx());
  assert.deepEqual(roomView(room, 'min').table.seats[me].cards, mine, 'friends now see my hand');
  assert.deepEqual(room.table.hand.events.at(-1), { t: 'show', seat: me, cards: mine, voluntary: true });
  assert.throws(() => showCards(state, state.users.hanseo, room.code, w.ctx()), /ALREADY_SHOWN/);
});

test('a player who lost everything keeps the chair until the next deal, then gets up', () => {
  const w = world(9);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 3 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  finishHand(state, room, w);
  // Pretend Min's last chips went to a bot in that hand.
  const seat = room.players.min.seat;
  const bot = room.table.seats.findIndex(s => s.kind === 'bot');
  room.table.seats[bot].stack += room.table.seats[seat].stack;
  room.table.seats[seat].stack = 0;
  tick(state, room, w.ctx());
  assert.ok(room.players.min, 'still seated while the showdown is on the felt');
  assert.equal(roomView(room, 'min').seated, true);
  w.advance(NEXT_HAND_MS);
  tick(state, room, w.ctx());
  assert.equal(room.players.min, undefined, 'stood up at the next deal');
  assert.ok(room.table.hand && !room.table.hand.over, 'the others play on');
  assert.equal(state.users.min.account.locked, 0);
});
