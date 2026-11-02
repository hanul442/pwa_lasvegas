// 구경하기: an AI-only hand, played out whole, for someone who wants to watch before sitting down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoHand, DEMO_SEATS, ROOM_GAMES } from '../lib/table-room.mjs';

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('every friends-room game can be watched as an AI-only table', () => {
  assert.deepEqual(Object.keys(DEMO_SEATS).sort(), [...ROOM_GAMES].sort());
});

test('a watched hand is played to the end by AI only, in whole chips', () => {
  for (const game of ROOM_GAMES) {
    for (let seed = 1; seed <= 25; seed++) {
      const h = demoHand(game, { stake: 1000, floor: 'hall', rand: seeded(seed) });
      assert.notEqual(h.round.status, 'PLAYING', `${game} #${seed} still playing`);
      assert.equal(h.size, DEMO_SEATS[game]);
      assert.ok(h.seats.every(name => typeof name === 'string' && name), `${game} seats all named`);
      assert.equal(new Set(h.seats).size, h.seats.length, `${game} names differ`);
      assert.ok(h.events.length > 0);
      assert.ok(Number.isInteger(h.netPnl), `${game} net ${h.netPnl}`);
      assert.ok(!h.round.options || !Object.keys(h.round.options).length, `${game} nothing to play from the rail`);
    }
  }
});

test('the other seats\' cards stay face down until the showdown', () => {
  const h = demoHand('seotda', { stake: 1000, rand: seeded(7) });
  const deals = h.events.filter(e => e.type === 'deal');
  assert.ok(deals.some(e => e.seat === 0 && e.card !== 'HIDDEN'));
  assert.ok(deals.filter(e => e.seat !== 0).every(e => e.card === 'HIDDEN'));
});

test('a bad game or stake is refused', () => {
  assert.throws(() => demoHand('roulette', { stake: 1000 }), /UNKNOWN_GAME/);
  assert.throws(() => demoHand('baccarat', { stake: 0 }), /INVALID_STAKE/);
  assert.throws(() => demoHand('baccarat', { stake: 'abc' }), /INVALID_STAKE/);
});

test('the 구경하기 button rides along with 친구와 함께 on every room game', () => {
  const client = readFileSync(new URL('../public/js/games/room-client.js', import.meta.url), 'utf8');
  assert.match(client, /구경하기/);
  assert.match(client, /참여하기/);
  for (const game of ['baccarat', 'blackjack', 'seotda', 'gostop', 'matgo']) {
    const src = readFileSync(new URL(`../public/js/games/${game}.js`, import.meta.url), 'utf8');
    assert.match(src, /createRoomClient\(t, '/, game);
  }
});

test('홀덤·7포커 can be watched too: six bots, one whole hand from seat 0 (its chair)', async () => {
  const { pokerDemoHand, DEMO_POKER_SEATS } = await import('../lib/holdem-room.mjs');
  const { FLOORS } = await import('../lib/constants.mjs');
  for (const game of ['holdem', 'sevenpoker']) {
    for (let seed = 1; seed <= 15; seed++) {
      const v = pokerDemoHand(game, { floor: FLOORS[seed % FLOORS.length].slug, rand: seeded(seed) });
      assert.equal(v.table.seats.length, DEMO_POKER_SEATS);
      assert.ok(v.table.handOver, `${game} #${seed} over`);
      assert.equal(v.table.legal, null);
      assert.equal(v.me, 0);
      assert.ok(v.events.length && v.events[0].t === 'hand');
      for (const s of v.table.seats) assert.ok(Number.isSafeInteger(s.stack), `${game} stack ${s.stack}`);
    }
  }
  assert.throws(() => pokerDemoHand('holdem', { floor: 'nowhere' }), /INVALID_TIER/);
  assert.throws(() => pokerDemoHand('slots', { floor: 'gold-room' }), /UNKNOWN_GAME/);
});
