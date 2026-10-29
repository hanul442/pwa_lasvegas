// 7포커 friends' rooms: the Hold'em room (lib/holdem-room.mjs) with the 7포커 engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, leaveRoom, startRoom, roomAction, tick, roomDue, roomView, listRooms, tableChips, roomOfUser, TURN_MS, NEXT_HAND_MS } from '../lib/holdem-room.mjs';
import { createRoom as createTableRoom } from '../lib/table-room.mjs';
import { validateStakeAgainstFloor } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { openRoundsView } from '../lib/open-rounds.mjs';

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validateStake = (user, floor, stake) => validateStakeAgainstFloor(user, FLOORS.find(f => f.slug === floor), stake);
const BUY_IN = 50_000_000;
const SEVEN = { buyIn: BUY_IN, floor: 'high-limit', size: 4, game: 'sevenpoker' };

function world(seed = 7) {
  const state = defaultState();
  for (const uid of ['hanseo', 'min', 'june']) state.users[uid].account.available = Math.min(state.users[uid].account.available, 900_000_000);
  let clock = 1_000_000;
  const rand = seeded(seed);
  const ctx = () => ({ now: clock, rand, validateStake });
  return { state, ctx, advance: ms => { clock += ms; }, get now() { return clock; } };
}
function audit(w, room, start) {
  const users = Object.values(w.state.users);
  const pending = Object.values(room.players).filter(p => p.seat < 0).reduce((a, p) => a + p.buyIn, 0);
  return users.reduce((a, u) => a + u.account.available, 0) + tableChips(room) + pending - (room.botIn - room.botOut) - start;
}

// Whoever has something to do does the cheapest thing: open the first card, check, or call.
function playStep(state, room, w, pick = () => 0) {
  const h = room.table.hand;
  if (h.phase === 'CHOOSE') {
    const seat = room.table.seats.findIndex((s, i) => s.kind === 'human' && h.players[i] && !h.players[i].folded && !h.players[i].chosen);
    assert.ok(seat >= 0, 'bots never keep the table waiting on the open');
    const user = state.users[room.table.seats[seat].id];
    assert.equal(roomView(room, user.id).table.legal.phase, 'CHOOSE');
    roomAction(state, user, room.code, { handNo: h.no, seq: 0, action: 'OPEN', amount: pick() }, w.ctx());
    return;
  }
  const seat = room.table.seats[h.toAct];
  assert.equal(seat.kind, 'human', 'bots never hold the turn');
  const legal = roomView(room, seat.id).table.legal;
  roomAction(state, state.users[seat.id], room.code, { handNo: h.no, seq: h.seq, action: legal.canCheck ? 'CHECK' : 'CALL' }, w.ctx());
}

test('friends and bots play 7포커 hands; every chip is accounted for when they get up', () => {
  const w = world(11);
  const { state } = w;
  const startAvail = Object.values(state.users).reduce((a, u) => a + u.account.available, 0);
  const room = createRoom(state, state.users.hanseo, SEVEN, w.ctx());
  assert.equal(room.variant, 'seven');
  assert.equal(room.table.ante, 1_000_000);
  joinRoom(state, state.users.min, room.code, w.ctx());
  joinRoom(state, state.users.june, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.table.seats.filter(s => s.kind === 'bot').length, 1, 'one AI fills the fourth chair');
  let hands = 0, shown = 0;
  for (let step = 0; step < 4000 && hands < 10 && room.status === 'OPEN'; step++) {
    const h = room.table.hand;
    if (!h || h.over) {
      if (h?.events.some(e => e.t === 'show')) shown++;
      w.advance(NEXT_HAND_MS); tick(state, room, w.ctx()); hands++; assert.equal(audit(w, room, startAvail), 0); continue;
    }
    playStep(state, room, w, () => step % 3);
    assert.equal(audit(w, room, startAvail), 0);
  }
  assert.ok(hands >= 5, `played ${hands} hands`);
  assert.ok(shown > 0, 'some hands went to a showdown');
  for (const id of ['june', 'min', 'hanseo']) if (room.players[id]) leaveRoom(state, state.users[id], room.code, w.ctx());
  assert.equal(state.holdemRooms.length, 0);
  for (const id of ['hanseo', 'min', 'june']) {
    assert.equal(state.users[id].account.locked, 0);
    const settled = state.ledger.filter(tx => tx.userId === id && tx.metadata?.room === room.code && tx.type.startsWith('GAME_'));
    assert.equal(settled.length, 1, `${id} settled once`);
    assert.equal(settled[0].metadata.game, 'Seven Poker');
  }
  assert.ok(state.users.min.friendRecord.recent.some(r => r.room === room.code), '친구 전적 keeps the sitting');
});

test('the open-card pick waits for people on one clock and is made for them when it runs out', () => {
  const w = world(5);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, SEVEN, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const h = room.table.hand;
  assert.equal(h.phase, 'CHOOSE');
  assert.ok(room.table.seats.every((s, i) => s.kind !== 'bot' || h.players[i].chosen), 'bots picked at once');
  // Others can't see a chosen card before everyone has picked.
  const mine = room.players.hanseo.seat, theirs = room.players.min.seat;
  roomAction(state, state.users.hanseo, room.code, { handNo: h.no, seq: 0, action: 'OPEN', amount: 1 }, w.ctx());
  assert.throws(() => roomAction(state, state.users.hanseo, room.code, { handNo: h.no, seq: 0, action: 'OPEN', amount: 0 }, w.ctx()), /NOT_YOUR_TURN/);
  assert.ok(roomView(room, 'min').table.seats[mine].cards.every(c => c === 'HIDDEN'));
  assert.equal(roomView(room, 'hanseo').table.legal, null);
  const view = roomView(room, 'min');
  assert.equal(view.turn.choose, true);
  assert.equal(view.turn.seat, theirs);
  w.advance(TURN_MS - 1);
  assert.equal(roomDue(room, w.now), false);
  w.advance(1);
  assert.equal(roomDue(room, w.now), true);
  tick(state, room, w.ctx());
  assert.equal(h.phase, 'BET', 'the clock opened a card for min');
  assert.equal(room.players.min.missed, 1);
  assert.ok(h.events.some(e => e.t === 'open'));
  assert.notEqual(roomView(room, 'min').table.seats[mine].cards[2], 'HIDDEN', 'open cards show to everyone');
});

test('one poker table at a time, and the lists keep Hold\'em and 7포커 apart', () => {
  const w = world(3);
  const { state } = w;
  const seven = createRoom(state, state.users.hanseo, SEVEN, w.ctx());
  const holdem = createRoom(state, state.users.min, { buyIn: BUY_IN, floor: 'high-limit', size: 3 }, w.ctx());
  assert.deepEqual(listRooms(state, state.users.june, 'sevenpoker').map(r => r.code), [seven.code]);
  assert.deepEqual(listRooms(state, state.users.june).map(r => r.code), [holdem.code]);
  assert.throws(() => joinRoom(state, state.users.hanseo, holdem.code, w.ctx()), e => e.message === 'ALREADY_IN_ROOM' && e.where.game === 'sevenpoker' && e.where.code === seven.code);
  assert.throws(() => createTableRoom(state, state.users.hanseo, { game: 'seotda', stake: 1_000_000, floor: 'high-limit' }, w.ctx()), e => e.where?.game === 'sevenpoker');
  startRoom(state, state.users.hanseo, seven.code, w.ctx());
  assert.equal(openRoundsView(state, state.users.hanseo).find(r => r.room === seven.code)?.game, 'sevenpoker');
  assert.equal(roomOfUser(state, 'hanseo'), seven);
});

test('a friend short of the buy-in sits with what they have, down to ten antes', () => {
  const w = world(9);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, SEVEN, w.ctx());
  state.users.min.account.available = 9_000_000;
  assert.throws(() => joinRoom(state, state.users.min, room.code, w.ctx()), /INSUFFICIENT_BANKROLL/);
  state.users.min.account.available = 12_000_000;
  joinRoom(state, state.users.min, room.code, w.ctx());
  assert.equal(room.players.min.buyIn, 12_000_000);
  assert.throws(() => createRoom(state, state.users.june, { ...SEVEN, buyIn: 5_000_000 }, w.ctx()), /BET_OUTSIDE_TABLE_LIMIT/);
});

// ---------- API ----------
function memoryStore() {
  let state = defaultState();
  for (const uid of ['hanseo', 'min', 'june']) state.users[uid].account.available = Math.min(state.users[uid].account.available, 900_000_000);
  for (const u of Object.values(state.users)) u.createdAt = '2026-01-01T00:00:00.000Z';
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
const call = (store, player, method, path, body, key = `k-seven-${++n}`) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? key : h === 'x-player-id' ? player : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('7포커 rooms over the API: create, list, join, open a card, bet, chat, leave', async () => {
  const store = memoryStore();
  const made = await call(store, 'hanseo', 'POST', '/api/holdem/rooms', { buyIn: BUY_IN, floor: 'high-limit', size: 3, game: 'sevenpoker' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const code = made.data.room.code;
  assert.equal(made.data.room.game, 'sevenpoker');
  assert.equal((await call(store, 'hanseo', 'POST', '/api/sevenpoker/sit', { buyIn: BUY_IN, floor: 'high-limit' })).status, 409, 'no solo 7포커 while seated in a room');
  assert.equal((await call(store, 'hanseo', 'GET', '/api/holdem/rooms?game=sevenpoker')).data.mine, code);
  assert.equal((await call(store, 'hanseo', 'GET', '/api/holdem/rooms')).data.mine, null, "the Hold'em screen doesn't take a 7포커 seat");
  assert.ok((await call(store, 'min', 'GET', '/api/holdem/rooms?game=sevenpoker')).data.rooms.some(r => r.code === code));
  assert.equal((await call(store, 'min', 'POST', '/api/holdem/rooms/join', { code })).status, 200);
  assert.equal((await call(store, 'min', 'POST', '/api/holdem/rooms/chat', { code, emoji: '😎' })).status, 200);
  const started = await call(store, 'hanseo', 'POST', '/api/holdem/rooms/start', { code, cursor: { hand: 0, from: 0 } });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.equal(started.data.room.table.phase, 'CHOOSE');

  let acted = 0;
  for (let k = 0; k < 80; k++) {
    const t = (await call(store, 'hanseo', 'GET', `/api/holdem/room?code=${code}`)).data.room.table;
    if (t.handOver) break;
    for (const who of ['hanseo', 'min']) {
      const v = (await call(store, who, 'GET', `/api/holdem/room?code=${code}`)).data.room;
      const l = v.table.legal;
      if (!l) continue;
      const body = l.phase === 'CHOOSE' ? { action: 'OPEN', amount: 2 } : { action: l.canCheck ? 'CHECK' : 'CALL' };
      const res = await call(store, who, 'POST', '/api/holdem/rooms/action', { code, handNo: v.table.handNo, seq: v.table.seq, ...body });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      acted++;
    }
  }
  assert.ok(acted >= 4, `acted ${acted}`);
  for (const who of ['min', 'hanseo']) {
    const res = await call(store, who, 'POST', '/api/holdem/rooms/leave', { code });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.state.user.account.locked, 0);
  }
  assert.equal(store.peek().holdemRooms.length, 0);
});
