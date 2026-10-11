import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, leaveRoom, startRoom, roomAction, tick, roomDue, roomView, listRooms, TURN_MS, NEXT_HAND_MS, MISSED_TURNS_LIMIT } from '../lib/table-room.mjs';
import { createRoom as createHoldemRoom } from '../lib/holdem-room.mjs';
import { seotdaNet, seotdaOptions } from '../lib/seotda.mjs';
import { gostopNet } from '../lib/gostop.mjs';
import { matgoAiDecision, matgoNet } from '../lib/matgo.mjs';
import { blackjackRoomNet, blackjackRoomOptions, blackjackRoomPublic } from '../lib/blackjack-room.mjs';
import { validateStakeAgainstFloor } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

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
  return { state, ctx, rand, advance: ms => { clock += ms; }, get now() { return clock; } };
}
const wealth = (state, ids) => ids.reduce((a, uid) => a + state.users[uid].account.available + state.users[uid].account.locked, 0);
const netOf = { seotda: seotdaNet, gostop: gostopNet, matgo: matgoNet, blackjack: blackjackRoomNet };
const actorOf = r => (r.players || r.game === 'Seotda' ? r.turn : r.phase === 'PLAY' ? r.turn : r.pending.seat);

// A person's move from their own seat: the same heuristics the house AI uses, or a legal 섯다 call.
function moveFor(room, seat, rand) {
  const r = room.round;
  if (room.game === 'blackjack') {
    const o = blackjackRoomOptions(r, seat), v = blackjackRoomPublic(r, seat).seats[seat].hands[o.hand].value, pick = rand();
    return { action: o.canSplit && pick < 0.5 ? 'SPLIT' : o.canDouble && v >= 9 && v <= 11 ? 'DOUBLE' : v < 15 ? 'HIT' : 'STAND' };
  }
  if (room.game === 'seotda') {
    const opts = seotdaOptions(r, seat).map(o => o.action);
    const pick = rand();
    return { action: pick < 0.15 && opts.includes('HALF') ? 'HALF' : opts.includes('CALL') ? (pick > 0.9 ? 'DIE' : 'CALL') : 'CHECK' };
  }
  return matgoAiDecision(r, seat, max => Math.floor(rand() * max));
}

// Plays hands until `hands` have ended, people acting on their own turns. After every hand the
// people's money moved by exactly what the ledger says they won or lost, and nothing stays locked.
function playHands(w, room, hands) {
  const { state } = w;
  const ids = Object.keys(room.players);
  const before = wealth(state, ids);
  let ended = 0, settledNet = 0;
  const counted = new Set([room.round, room.prev?.round].filter(r => r?.status === 'SETTLED').map(r => r.id)); // settled before we started watching
  // A hand can end the moment it is dealt (a dealer blackjack), so count every settled round once.
  const count = r => {
    if (!r || r.status !== 'SETTLED' || counted.has(r.id)) return;
    counted.add(r.id);
    ended++;
    // Seats add up to zero: whatever people won came from the AI seats or the other people.
    if (room.game === 'seotda') assert.equal(r.seats.map((_, i) => netOf[room.game](r, i)).reduce((a, b) => a + b, 0), 0);
    for (const net of Object.values(r.nets)) settledNet += net;
  };
  for (let step = 0; step < 5000 && ended < hands && room.status === 'OPEN'; step++) {
    count(room.prev?.round);
    count(room.round);
    const r = room.round;
    if (!r || r.status === 'SETTLED') {
      for (const uid of ids) assert.equal(state.users[uid].account.locked, 0, 'nothing stays locked between hands');
      assert.equal(wealth(state, ids) - before, settledNet);
      w.advance(NEXT_HAND_MS);
      tick(state, room, w.ctx());
      continue;
    }
    const seat = room.round.seats[actorOf(r)];
    assert.equal(seat.kind, 'human', 'AI seats never hold the turn');
    const s = r.seats.indexOf(seat);
    roomAction(state, state.users[seat.userId], room.code, { handNo: room.handNo, seq: room.events.length, ...moveFor(room, s, w.rand) }, w.ctx());
  }
  return ended;
}

test('섯다 room: friends and AI play hands; every won chip is one someone else lost', () => {
  const w = world(3);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 50_000, floor: 'downtown', size: 4 }, w.ctx());
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{4}$/);
  joinRoom(state, state.users.min, room.code.toLowerCase(), w.ctx());
  joinRoom(state, state.users.june, room.code, w.ctx());
  assert.equal(state.users.min.account.locked, 0, 'nothing is locked until a hand is dealt');
  assert.throws(() => startRoom(state, state.users.min, room.code, w.ctx()), /NOT_HOST/);
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.round.seats.length, 4);
  assert.deepEqual(room.round.seats.map(s => s.kind).filter(k => k === 'ai').length, 1, 'AI fills the seat nobody took');
  assert.ok(playHands(w, room, 15) >= 15);
});

test('고스톱 and 맞고 rooms play to the end and settle each person', () => {
  for (const [game, size] of [['gostop', 3], ['matgo', 2]]) {
    const w = world(game === 'gostop' ? 5 : 9);
    const { state } = w;
    const room = createRoom(state, state.users.hanseo, { game, stake: 10_000, floor: 'downtown' }, w.ctx());
    assert.equal(room.size, size);
    joinRoom(state, state.users.zero, room.code, w.ctx());
    assert.equal(state.users.zero.account.locked, 0);
    startRoom(state, state.users.hanseo, room.code, w.ctx());
    assert.equal(state.users.zero.account.locked, 100_000, '10점 보증금 locked when dealt');
    assert.equal(room.round.seats.filter(s => s.kind === 'human').length, 2);
    assert.ok(playHands(w, room, 6) >= 6, game);
  }
});

test('blackjack room: friends and AI against one dealer, doubles and splits locked and settled', () => {
  const w = world(13);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'blackjack', stake: 50_000, floor: 'downtown', size: 4 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  joinRoom(state, state.users.zero, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.round.seats.length, 4);
  assert.equal(room.round.seats.filter(s => s.kind === 'ai').length, 1);
  const v = roomView(room, 'min', { hand: 0, from: 0 }, w.now);
  const k = room.round.seats.findIndex(s => s.userId === 'min');
  assert.deepEqual(v.round.seats[0].hands[0].cards, blackjackRoomPublic(room.round, k).seats[k].hands[0].cards);
  assert.equal(v.round.dealer[1], room.round.status === 'PLAYING' ? 'HIDDEN' : v.round.dealer[1]);
  assert.ok(playHands(w, room, 25) >= 25);
});

test('the room is drawn from each viewer\'s own seat, and other hands stay hidden', () => {
  const w = world(4);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 50_000, floor: 'downtown', size: 3 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const r = room.round;
  for (const uid of ['hanseo', 'min']) {
    const v = roomView(room, uid, { hand: 0, from: 0 }, w.now);
    const k = r.seats.findIndex(s => s.userId === uid);
    assert.equal(v.round.you, 0);
    assert.deepEqual(v.round.hand, r.hands[k], 'my cards in seat 0');
    assert.equal(v.round.players[0].name, state.users[uid].nickname);
    assert.ok(v.round.players.slice(1).every(p => p.cards.every(c => c === 'HIDDEN')));
    assert.ok(v.events.filter(e => e.type === 'deal').every(e => (e.seat === 0) === (e.card !== 'HIDDEN')));
    assert.equal(v.round.turn, (r.turn - k + 3) % 3);
  }
  // Someone who joined mid-hand waits for the next deal and sees no cards.
  joinRoom(state, state.users.june, room.code, w.ctx());
  const late = roomView(room, 'june', {}, w.now);
  assert.equal(late.waiting, true);
  assert.equal(late.round, null);
});

test('a clock that runs out plays a free move; too many in a row and the table stands you up', () => {
  const w = world(6);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'gostop', stake: 10_000, floor: 'downtown' }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  let guard = 0;
  // hanseo plays; min never does.
  while (room.players.min && guard++ < 2000) {
    const r = room.round;
    if (r.status === 'SETTLED') { w.advance(NEXT_HAND_MS); tick(state, room, w.ctx()); continue; }
    const s = r.phase === 'PLAY' ? r.turn : r.pending.seat;
    if (r.seats[s].userId === 'hanseo') { roomAction(state, state.users.hanseo, room.code, { handNo: room.handNo, seq: room.events.length, ...moveFor(room, s, w.rand) }, w.ctx()); continue; }
    tick(state, room, w.ctx());
    assert.equal(roomDue(room, w.now), false, 'the clock is running');
    w.advance(TURN_MS);
    tick(state, room, w.ctx());
    assert.ok(room.events.some(e => e.timeout));
  }
  assert.equal(room.players.min, undefined, `stood up after ${MISSED_TURNS_LIMIT} missed turns`);
  assert.equal(state.users.min.account.locked, 0);
});

test('leaving mid-hand plays your seat out and still settles you; the last one out closes the room', () => {
  const w = world(8);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'matgo', stake: 10_000, floor: 'downtown' }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const handId = room.round.id;
  const out = leaveRoom(state, state.users.min, room.code, w.ctx());
  assert.equal(out.pending, true);
  assert.equal(state.users.min.account.locked, 100_000, 'still in the pot until the hand ends');
  // hanseo plays the hand out against the seat min left behind.
  for (let g = 0; g < 200 && room.round.id === handId && room.round.status === 'PLAYING'; g++) {
    const r = room.round, s = r.phase === 'PLAY' ? r.turn : r.pending.seat;
    roomAction(state, state.users.hanseo, room.code, { handNo: room.handNo, seq: room.events.length, ...moveFor(room, s, w.rand) }, w.ctx());
  }
  assert.equal(state.users.min.account.locked, 0);
  assert.ok(state.ledger.some(tx => tx.userId === 'min' && tx.referenceId === handId && tx.type.startsWith('GAME_')));
  leaveRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.status, 'CLOSED');
  assert.equal(state.tableRooms.length, 0);
});

test('the last person leaving mid-hand lets the AI finish it before the room closes', () => {
  const w = world(10);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 50_000, floor: 'downtown', size: 5 }, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  leaveRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.status, 'CLOSED');
  assert.equal(state.users.hanseo.account.locked, 0);
});

test('one table at a time, and rooms list only where you may sit', () => {
  const w = world(12);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 50_000, floor: 'downtown', size: 2 }, w.ctx());
  assert.throws(() => createRoom(state, state.users.hanseo, { game: 'gostop', stake: 10_000, floor: 'downtown' }, w.ctx()), /ALREADY_IN_ROOM/);
  assert.throws(() => createHoldemRoom(state, state.users.hanseo, { buyIn: 500_000, floor: 'downtown', size: 3 }, w.ctx()), /ALREADY_IN_ROOM/);
  createHoldemRoom(state, state.users.june, { buyIn: 500_000, floor: 'downtown', size: 3 }, w.ctx());
  assert.throws(() => joinRoom(state, state.users.june, room.code, w.ctx()), /ALREADY_IN_ROOM/);
  joinRoom(state, state.users.min, room.code, w.ctx());
  assert.throws(() => joinRoom(state, state.users.zero, room.code, w.ctx()), /ROOM_FULL/);
  assert.throws(() => createRoom(state, state.users.zero, { game: 'seotda', stake: 50_000, floor: 'downtown', size: 6 }, w.ctx()), /INVALID_ROOM_SIZE/);
  assert.throws(() => createRoom(state, state.users.zero, { game: 'poker', stake: 50_000, floor: 'downtown' }, w.ctx()), /UNKNOWN_GAME/);
  assert.equal(listRooms(state, state.users.zero, 'seotda').length, 0, 'a full room is not offered');
  assert.equal(listRooms(state, state.users.min, 'seotda')[0].mine, true);
  assert.equal(listRooms(state, state.users.min, 'gostop').length, 0);
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
const call = (store, player, method, path, body, key = `k-troom-${++n}`) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? key : h === 'x-player-id' ? player : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('rooms over the API: create, join by code, poll with a cursor, act, leave', async () => {
  const store = memoryStore();
  const ids = ['hanseo', 'min'];
  const total = wealth(store.peek(), ids);
  const made = await call(store, 'hanseo', 'POST', '/api/rooms', { game: 'seotda', stake: 50_000, floor: 'downtown', size: 3 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  assert.equal(made.data.room.game, 'seotda');
  const listed = await call(store, 'min', 'GET', '/api/rooms?game=seotda');
  assert.ok(listed.data.rooms.some(r => r.code === code && r.host === 'HANSEO'));
  assert.equal((await call(store, 'min', 'POST', '/api/rooms/join', { code }, 'k-join-min-1')).status, 200);
  assert.equal((await call(store, 'min', 'POST', '/api/rooms/join', { code }, 'k-join-min-1')).data.replayed, true);
  assert.equal((await call(store, 'min', 'GET', '/api/rooms')).data.mine.game, 'seotda');
  const started = await call(store, 'hanseo', 'POST', '/api/rooms/start', { code, cursor: { hand: 0, from: 0 } });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.room.round.you, 0);

  let cursor = { hand: 0, from: 0 }, acted = 0;
  for (let k = 0; k < 80; k++) {
    const poll = await call(store, 'hanseo', 'GET', `/api/room?code=${code}&hand=${cursor.hand}&from=${cursor.from}`);
    assert.equal(poll.status, 200, JSON.stringify(poll.data));
    const room = poll.data.room;
    cursor = room.cursor;
    if (room.round.status === 'SETTLED') { assert.equal(typeof room.netPnl, 'number'); break; }
    for (const who of ids) {
      const v = (await call(store, who, 'GET', `/api/room?code=${code}`)).data.room;
      if (v.round.turn !== 0) continue;
      const opt = v.round.options.find(o => o.action === 'CHECK') || v.round.options.find(o => o.action === 'CALL');
      const res = await call(store, who, 'POST', '/api/rooms/action', { code, handNo: v.handNo, seq: v.seq, action: opt.action });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      assert.equal((await call(store, who, 'POST', '/api/rooms/action', { code, handNo: v.handNo, seq: v.seq, action: opt.action })).data.error, 'STALE_ACTION');
      acted++;
    }
  }
  assert.ok(acted > 0);
  for (const who of ids) {
    const res = await call(store, who, 'POST', '/api/rooms/leave', { code });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.state.user.account.locked, 0);
  }
  const moved = store.peek().ledger.filter(tx => tx.metadata?.room === code).reduce((a, tx) => a + (tx.rawPnlDelta || 0), 0);
  assert.equal(wealth(store.peek(), ids) - total, moved, 'the only change is the settled results');
  assert.equal((await call(store, 'hanseo', 'GET', `/api/room?code=${code}`)).status, 404);
});
