import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, leaveRoom, startRoom, roomAction, tick, roomDue, roomView, listRooms, TURN_MS, NEXT_HAND_MS, MISSED_TURNS_LIMIT } from '../lib/table-room.mjs';
import { createRoom as createHoldemRoom } from '../lib/holdem-room.mjs';
import { seotdaNet, seotdaOptions } from '../lib/seotda.mjs';
import { gostopNet } from '../lib/gostop.mjs';
import { matgoAiDecision, matgoNet } from '../lib/matgo.mjs';
import { blackjackRoomNet, blackjackRoomOptions, blackjackRoomPublic } from '../lib/blackjack-room.mjs';
import { validateStakeAgainstFloor, validateRoomStake } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validateStake = (user, floor, stake) => validateStakeAgainstFloor(user, FLOORS.find(f => f.slug === floor), stake);
const validateRoomHost = (user, floor, stake) => validateRoomStake(user, FLOORS.find(f => f.slug === floor), stake);

function world(seed = 7) {
  seed += Number(process.env.ROOM_SEED || 0);
  const state = defaultState();
  // The friends sit at High Limit, so keep their wallets under its 10억 ceiling.
  for (const uid of ['hanseo', 'min', 'june']) state.users[uid].account.available = Math.min(state.users[uid].account.available, 900_000_000);
  let clock = 1_000_000;
  const rand = seeded(seed);
  const ctx = () => ({ now: clock, rand, validateStake: validateRoomHost });
  return { state, ctx, rand, advance: ms => { clock += ms; }, get now() { return clock; } };
}
// The bank's automatic 구제금융 tops up anyone who busts; it is not table money, so leave it out.
const welfare = (state, ids) => state.ledger.filter(l => l.type === 'WELFARE' && ids.includes(l.userId)).reduce((a, l) => a + l.amount, 0);
const wealth = (state, ids) => ids.reduce((a, uid) => a + state.users[uid].account.available + state.users[uid].account.locked, 0) - welfare(state, ids);
const netOf = { seotda: seotdaNet, gostop: gostopNet, matgo: matgoNet, blackjack: blackjackRoomNet };
const actorOf = r => (r.players || r.game === 'Seotda' ? r.turn : r.phase === 'PLAY' ? r.turn : r.pending.seat);

// A person's move from their own seat: the same heuristics the house AI uses, or a legal 섯다 call.
function moveFor(room, seat, rand, wallet = Infinity) {
  const r = room.round;
  if (room.game === 'blackjack') {
    const o = blackjackRoomOptions(r, seat), v = blackjackRoomPublic(r, seat).seats[seat].hands[o.hand].value, pick = rand();
    return { action: o.canSplit && pick < 0.5 ? 'SPLIT' : o.canDouble && v >= 9 && v <= 11 ? 'DOUBLE' : v < 15 ? 'HIT' : 'STAND' };
  }
  if (room.game === 'seotda') {
    // A player only raises or calls with chips they still have; otherwise they fold.
    const opts = seotdaOptions(r, seat).filter(o => o.cost <= wallet).map(o => o.action);
    const pick = rand();
    return { action: pick < 0.15 && opts.includes('HALF') ? 'HALF' : opts.includes('CALL') ? (pick > 0.9 ? 'DIE' : 'CALL') : opts.includes('CHECK') ? 'CHECK' : opts.includes('ALLIN') && pick < 0.7 ? 'ALLIN' : 'DIE' };
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
    roomAction(state, state.users[seat.userId], room.code, { handNo: room.handNo, seq: room.events.length, ...moveFor(room, s, w.rand, state.users[seat.userId].account.available) }, w.ctx());
  }
  return ended;
}

test('섯다 room: friends and AI play hands; every won chip is one someone else lost', () => {
  const w = world(3);
  const { state } = w;
  // Fifteen hands of half-pot raises at High Limit's 1천만 ante: a full 10억 wallet each (the
  // floor's ceiling) is deep enough that nobody runs dry mid-test.
  for (const uid of ['hanseo', 'min', 'june']) state.users[uid].account.available = 1_000_000_000;
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 10_000_000, floor: 'high-limit', size: 4 }, w.ctx());
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
    const room = createRoom(state, state.users.hanseo, { game, stake: 10_000_000, floor: 'high-limit' }, w.ctx());
    assert.equal(room.size, size);
    joinRoom(state, state.users.june, room.code, w.ctx());
    assert.equal(state.users.june.account.locked, 0);
    startRoom(state, state.users.hanseo, room.code, w.ctx());
    assert.equal(state.users.june.account.locked, 100_000_000, '10점 보증금 locked when dealt');
    assert.equal(room.round.seats.filter(s => s.kind === 'human').length, 2);
    assert.ok(playHands(w, room, 6) >= 6, game);
  }
});

test('맞고 room: the last hand\'s winner leads the next, a 나가리 keeps the same 선', () => {
  const w = world(21);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'matgo', stake: 10_000_000, floor: 'high-limit' }, w.ctx());
  joinRoom(state, state.users.june, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const seen = [];
  for (let step = 0; step < 3000 && seen.length < 8; step++) {
    const r = room.round;
    if (r.status === 'SETTLED') {
      w.advance(NEXT_HAND_MS);
      tick(state, room, w.ctx());
      if (room.round !== r) seen.push([r, room.round]);
      continue;
    }
    const seat = r.seats[actorOf(r)];
    roomAction(state, state.users[seat.userId], room.code, { handNo: room.handNo, seq: room.events.length, ...moveFor(room, r.seats.indexOf(seat), w.rand) }, w.ctx());
  }
  for (const [r, next] of seen) {
    const lead = r.result.winner ?? r.first;
    assert.equal(next.seats[next.first].userId, r.seats[lead].userId, r.result.winner === null ? '나가리 keeps 선' : 'winner leads');
  }
  const checked = seen.length;
  assert.ok(checked >= 4);
});

test('blackjack room: friends and AI against one dealer, doubles and splits locked and settled', () => {
  const w = world(13);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'blackjack', stake: 50_000_000, floor: 'high-limit', size: 4 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  joinRoom(state, state.users.june, room.code, w.ctx());
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
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 50_000_000, floor: 'high-limit', size: 3 }, w.ctx());
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
  // From the next deal they take the AI's seat.
  assert.equal(room.round.seats.filter(s => s.kind === 'ai').length, 1);
  for (let guard = 0; room.handNo === 1 && guard < 500; guard++) {
    const actor = room.round.status === 'PLAYING' ? room.round.seats[room.round.turn] : null;
    Object.values(room.players).forEach(p => { p.missed = 0; }); // run clocks out without standing anyone up
    w.advance(actor?.kind === 'human' ? TURN_MS : NEXT_HAND_MS);
    tick(state, room, w.ctx());
  }
  assert.equal(room.handNo, 2);
  assert.ok(room.round.seats.some(s => s.userId === 'june'));
  assert.equal(room.round.seats.filter(s => s.kind === 'ai').length, 0, 'the AI gave up its seat');
  assert.equal(roomView(room, 'june', {}, w.now).playing, true);
});

test('a clock that runs out plays a free move; too many in a row and the table stands you up', () => {
  const w = world(6);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'gostop', stake: 10_000_000, floor: 'high-limit' }, w.ctx());
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
  const room = createRoom(state, state.users.hanseo, { game: 'matgo', stake: 10_000_000, floor: 'high-limit' }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const handId = room.round.id;
  const out = leaveRoom(state, state.users.min, room.code, w.ctx());
  assert.equal(out.pending, true);
  assert.equal(state.users.min.account.locked, 100_000_000, 'still in the pot until the hand ends');
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
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 50_000_000, floor: 'high-limit', size: 5 }, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  leaveRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.status, 'CLOSED');
  assert.equal(state.users.hanseo.account.locked, 0);
});

test('one table at a time, and rooms list only where you may sit', () => {
  const w = world(12);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 50_000_000, floor: 'high-limit', size: 2 }, w.ctx());
  assert.throws(() => createRoom(state, state.users.hanseo, { game: 'gostop', stake: 10_000_000, floor: 'high-limit' }, w.ctx()), /ALREADY_IN_ROOM/);
  assert.throws(() => createHoldemRoom(state, state.users.hanseo, { buyIn: 50_000_000, floor: 'high-limit', size: 3 }, w.ctx()), /ALREADY_IN_ROOM/);
  createHoldemRoom(state, state.users.june, { buyIn: 50_000_000, floor: 'high-limit', size: 3 }, w.ctx());
  assert.throws(() => joinRoom(state, state.users.june, room.code, w.ctx()), /ALREADY_IN_ROOM/);
  // The refusal names the room that holds the seat, so the screen can offer a way back or out.
  assert.throws(() => createRoom(state, state.users.hanseo, { game: 'matgo', stake: 10_000_000, floor: 'high-limit' }, w.ctx()), e => e.where?.game === 'seotda' && e.where.code === room.code && e.where.tier === room.tier);
  assert.throws(() => joinRoom(state, state.users.june, room.code, w.ctx()), e => e.where?.game === 'holdem' && /^[A-Z0-9]{4}$/.test(e.where.code));
  assert.throws(() => createHoldemRoom(state, state.users.hanseo, { buyIn: 50_000_000, floor: 'high-limit', size: 3 }, w.ctx()), e => e.where?.game === 'seotda');
  joinRoom(state, state.users.min, room.code, w.ctx());
  assert.throws(() => joinRoom(state, state.users.zero, room.code, w.ctx()), /ROOM_FULL/);
  assert.throws(() => createRoom(state, state.users.zero, { game: 'seotda', stake: 50_000_000, floor: 'high-limit', size: 6 }, w.ctx()), /INVALID_ROOM_SIZE/);
  assert.throws(() => createRoom(state, state.users.zero, { game: 'poker', stake: 50_000_000, floor: 'high-limit' }, w.ctx()), /UNKNOWN_GAME/);
  assert.equal(listRooms(state, state.users.zero, 'seotda').length, 0, 'a full room is not offered');
  assert.equal(listRooms(state, state.users.min, 'seotda')[0].mine, true);
  assert.equal(listRooms(state, state.users.min, 'gostop').length, 0);
});

// ---------- API ----------
function memoryStore() {
  let state = defaultState();
  for (const uid of ['hanseo', 'min', 'june']) state.users[uid].account.available = Math.min(state.users[uid].account.available, 900_000_000);
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
  const made = await call(store, 'hanseo', 'POST', '/api/rooms', { game: 'seotda', stake: 50_000_000, floor: 'high-limit', size: 3 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  assert.equal(made.data.room.game, 'seotda');
  const listed = await call(store, 'min', 'GET', '/api/rooms?game=seotda');
  assert.ok(listed.data.rooms.some(r => r.code === code && r.host === 'HANSEO'));
  assert.equal((await call(store, 'min', 'POST', '/api/rooms/join', { code }, 'k-join-min-1')).status, 200);
  assert.equal((await call(store, 'min', 'POST', '/api/rooms/join', { code }, 'k-join-min-1')).data.replayed, true);
  assert.equal((await call(store, 'min', 'GET', '/api/rooms')).data.mine.game, 'seotda');
  const blocked = await call(store, 'min', 'POST', '/api/holdem/rooms', { buyIn: 50_000_000, floor: 'high-limit', size: 3 });
  assert.equal(blocked.status, 409);
  assert.deepEqual({ error: blocked.data.error, game: blocked.data.where?.game, code: blocked.data.where?.code }, { error: 'ALREADY_IN_ROOM', game: 'seotda', code });
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

test('friends sit together whatever floors each has reached or outgrown; only the chips count', () => {
  const w = world(21);
  const { state } = w;
  const poor = state.users.june, rich = state.users.hanseo, mid = state.users.min;
  poor.account.available = 50_000_000; poor.account.unlockedFloors = ['gold-room'];
  mid.account.available = 30_000_000; mid.account.unlockedFloors = ['gold-room'];
  // The rich friend has outgrown Gold Room's solo tables, yet can open a room there or sit at a friend's.
  assert.throws(() => validateStake(rich, 'gold-room', 1_000_000), /FLOOR_OUTGROWN/);
  const own = createRoom(state, rich, { game: 'seotda', stake: 1_000_000, floor: 'gold-room', size: 3 }, w.ctx());
  leaveRoom(state, rich, own.code, w.ctx());
  const low = createRoom(state, poor, { game: 'seotda', stake: 1_000_000, floor: 'gold-room', size: 3 }, w.ctx());
  joinRoom(state, rich, low.code, w.ctx());
  assert.ok(low.players[rich.id]);
  leaveRoom(state, rich, low.code, w.ctx());
  // A friend who hasn't reached High Limit is offered the room and sits, chips permitting.
  const high = createRoom(state, rich, { game: 'seotda', stake: 10_000_000, floor: 'high-limit', size: 3 }, w.ctx());
  assert.ok(listRooms(state, mid, 'seotda').some(r => r.code === high.code));
  joinRoom(state, mid, high.code, w.ctx());
  assert.ok(high.players[mid.id]);
  leaveRoom(state, mid, high.code, w.ctx());
  mid.account.available = 5_000_000; // short of the room's 10M stake
  assert.throws(() => joinRoom(state, mid, high.code, w.ctx()), /INSUFFICIENT_BANKROLL/);
});

test('섯다: getting up on my own betting turn dies that hand and the table plays on', () => {
  const w = world(12);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 10_000_000, floor: 'high-limit' }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const r = room.round, handId = r.id;
  const seat = r.seats[r.turn];
  assert.equal(seat.kind, 'human');
  const leaver = seat.userId;
  const out = leaveRoom(state, state.users[leaver], room.code, w.ctx());
  assert.equal(out.pending, true);
  assert.ok(r.status === 'SETTLED' || r.seats[r.turn] !== seat, 'the turn left the empty seat');
  const other = Object.keys(room.players)[0];
  for (let g = 0; g < 200 && room.round?.id === handId && room.round.status === 'PLAYING'; g++) {
    const s = room.round.turn;
    roomAction(state, state.users[other], room.code, { handNo: room.handNo, seq: room.events.length, ...moveFor(room, s, w.rand) }, w.ctx());
  }
  assert.equal(state.users[leaver].account.locked, 0, 'settled when the hand ended');
  assert.ok(state.ledger.some(tx => tx.userId === leaver && tx.referenceId === handId && tx.type.startsWith('GAME_')));
});
