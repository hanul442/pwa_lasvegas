import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, startRoom, roomAction, tick, roomView, leaveRoom, TURN_MS, NEXT_HAND_MS } from '../lib/table-room.mjs';
import { startBaccaratRoom, baccaratRoomAct, baccaratRoomActor, baccaratRoomNet, baccaratRoomOptions, BACCARAT_SIDES } from '../lib/baccarat-room.mjs';
import { baccaratScore } from '../lib/games.mjs';
import { validateRoomStake } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { defaultState } from '../lib/state.mjs';
import { openRoundsView } from '../lib/open-rounds.mjs';

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const intRng = rand => max => Math.min(max - 1, Math.floor(rand() * max));
const people = n => Array.from({ length: n }, (_, i) => ({ kind: 'human', userId: `u${i}`, name: `P${i}` }));

function world(seed = 7) {
  const state = defaultState();
  for (const uid of ['hanseo', 'min', 'june']) state.users[uid].account.available = 900_000_000;
  let clock = 1_000_000;
  const rand = seeded(seed);
  const ctx = () => ({ now: clock, rand, validateStake: (u, floor, stake) => validateRoomStake(u, FLOORS.find(f => f.slug === floor), stake) });
  return { state, ctx, rand, advance: ms => { clock += ms; }, get now() { return clock; } };
}
const wealth = (state, ids) => ids.reduce((a, uid) => a + state.users[uid].account.available + state.users[uid].account.locked, 0);

test('baccarat coup: everyone bets in turn, then the dealer turns the cards; payouts follow the rules', () => {
  for (let g = 0; g < 400; g++) {
    const rng = intRng(seeded(g + 1));
    const events = [];
    const r = startBaccaratRoom({ stake: 10_000_000, seats: people(3), events, rng });
    assert.equal(baccaratRoomActor(r), 0);
    assert.deepEqual(baccaratRoomOptions(r, 0), { sides: BACCARAT_SIDES });
    assert.equal(baccaratRoomOptions(r, 1), null);
    assert.throws(() => baccaratRoomAct(r, 1, 'PLAYER', events, rng), /NOT_YOUR_TURN/);
    assert.throws(() => baccaratRoomAct(r, 0, 'OPEN', events, rng), /INVALID_ACTION/);
    const bets = [0, 1, 2].map(() => BACCARAT_SIDES[rng(3)]);
    bets.forEach((b, s) => {
      assert.equal(r.player.length, 0, 'no card is out before everyone has bet');
      baccaratRoomAct(r, s, b, events, rng);
    });
    assert.equal(r.status, 'READY_TO_SETTLE');
    const ps = baccaratScore(r.player), bs = baccaratScore(r.banker);
    assert.equal(r.winner, ps > bs ? 'PLAYER' : bs > ps ? 'BANKER' : 'TIE');
    const two = [r.player, r.banker].map(h => baccaratScore(h.slice(0, 2)));
    assert.equal(r.trace.natural, two.some(x => x >= 8));
    if (r.trace.natural) assert.equal(r.player.length + r.banker.length, 4);
    bets.forEach((b, s) => {
      const net = baccaratRoomNet(r, s);
      if (r.winner === 'TIE') assert.equal(net, b === 'TIE' ? 80_000_000 : 0);
      else if (b !== r.winner) assert.equal(net, -10_000_000);
      else if (b === 'BANKER') assert.ok([9_000_000, 10_000_000].includes(net), 'the 5% commission rounds fairly to a 100만 unit');
      else assert.equal(net, 10_000_000);
    });
    const end = events.at(-1);
    assert.equal(end.type, 'end');
    assert.deepEqual(end.bets, bets);
    assert.deepEqual(events.filter(e => e.type === 'open').map(e => e.side), ['PLAYER', 'BANKER']);
  }
});

test('baccarat room: friends and AI play hands; money moves exactly as settled', () => {
  const w = world(11);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'baccarat', stake: 10_000_000, floor: 'high-limit', size: 4 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(room.round.seats.length, 4);
  assert.equal(room.round.seats.filter(s => s.kind === 'ai').length, 2);
  assert.equal(state.users.min.account.locked, 10_000_000);
  const ids = ['hanseo', 'min'];
  const before = wealth(state, ids);
  let settled = 0, hands = 0;
  const seen = new Set();
  for (let step = 0; step < 3000 && hands < 30; step++) {
    for (const r of [room.prev?.round, room.round]) if (r?.status === 'SETTLED' && !seen.has(r.id)) { seen.add(r.id); hands++; for (const n of Object.values(r.nets)) settled += n; }
    const r = room.round;
    if (r.status === 'SETTLED') {
      for (const uid of ids) assert.equal(state.users[uid].account.locked, 0);
      assert.equal(wealth(state, ids) - before, settled);
      w.advance(NEXT_HAND_MS);
      tick(state, room, w.ctx());
      continue;
    }
    const seat = r.seats[baccaratRoomActor(r)];
    assert.equal(seat.kind, 'human', 'AI seats never hold the turn');
    const action = BACCARAT_SIDES[Math.floor(w.rand() * 3)];
    roomAction(state, state.users[seat.userId], room.code, { handNo: room.handNo, seq: room.events.length, action }, w.ctx());
  }
  assert.ok(hands >= 30);
  assert.ok(room.road.length > 0 && room.road.length <= 20);
});

test('baccarat room view: my seat is seat 0, everyone sees the bets, a run-out clock backs Banker', () => {
  const w = world(5);
  const { state } = w;
  const room = createRoom(state, state.users.hanseo, { game: 'baccarat', stake: 10_000_000, floor: 'high-limit', size: 3 }, w.ctx());
  joinRoom(state, state.users.min, room.code, w.ctx());
  startRoom(state, state.users.hanseo, room.code, w.ctx());
  const v = roomView(room, 'min', { hand: room.handNo, from: 0 }, w.now);
  assert.equal(v.round.seats[0].name, state.users.min.nickname);
  assert.equal(v.round.turn, 2, 'the host bets first, two seats round from me');
  assert.equal(v.turn.seat, 2);
  // The host's clock runs out: Banker is backed for them, then my turn.
  w.advance(TURN_MS);
  tick(state, room, w.ctx());
  assert.equal(room.round.bets[0], 'BANKER');
  assert.ok(room.events.some(e => e.type === 'bet' && e.timeout));
  const mine = roomView(room, 'min', {}, w.now).round;
  assert.equal(mine.turn, 0);
  assert.equal(mine.seats[2].bet, 'BANKER', "the host's bet, seen from my seat");
  assert.deepEqual(mine.player, []);
  // The host gets up before I bet: their seat stays in the coup and is settled with it.
  leaveRoom(state, state.users.hanseo, room.code, w.ctx());
  assert.equal(state.users.hanseo.account.locked, 10_000_000);
  roomAction(state, state.users.min, room.code, { handNo: room.handNo, seq: room.events.length, action: 'PLAYER' }, w.ctx());
  assert.equal(room.round.status, 'SETTLED');
  assert.equal(state.users.hanseo.account.locked, 0);
  assert.equal(room.round.nets.hanseo, baccaratRoomNet(room.round, 0));
  assert.equal(openRoundsView(state, state.users.min).length, 0, 'nothing in play between hands');
});
