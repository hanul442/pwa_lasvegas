import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { NIGHTLY, nightlyStart, nightlyPayouts, registerNightly, unregisterNightly, sweepNightly, nightlyView, nightlyRooms, nightlyLeft, planNightlyPushes } from '../lib/nightly-tourney.mjs';
import { sweepRooms, roomView, roomOfUser, leaveRoom, backToSeat, listRooms, joinRoom, tick } from '../lib/holdem-room.mjs';
import { MONEY_UNIT } from '../lib/constants.mjs';
import { handleApi } from '../lib/api.mjs';

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DAY = '2026-10-24';
const START = nightlyStart(DAY);

function world(people = 4, seed = 11) {
  const state = defaultState();
  const ids = Object.keys(state.users);
  for (let k = ids.length; k < people; k++) {
    const uid = `p${k}`;
    state.users[uid] = { ...structuredClone(state.users.min), id: uid, nickname: `손님${k}` };
  }
  for (const u of Object.values(state.users)) { u.account.available = 50_000_000_000; u.account.locked = 0; }
  return { state, ids: Object.keys(state.users).slice(0, people), rand: seeded(seed) };
}
const money = state => Object.values(state.users).reduce((a, u) => a + u.account.available + u.account.locked, 0);
const tableChips = room => room.table.seats.reduce((a, s) => a + s.stack, 0) + (room.table.hand && !room.table.hand.over ? room.table.hand.players.reduce((a, p) => a + (p ? p.committed : 0), 0) : 0);

// The clock moves on; everything due plays, as every request (and the minute cron) does.
function run(w, from, { step = 10_000, limit = 40_000 } = {}) {
  let now = from;
  for (let k = 0; k < limit && w.state.nightly.status === 'RUNNING'; k++) {
    now += step;
    sweepNightly(w.state, now, w.rand);
    sweepRooms(w.state, { now, rand: w.rand });
  }
  return now;
}

test('payouts: top three in a field of six, top six beyond, whole 100만s adding up to the pool', () => {
  for (const [prize, field] of [[6_000_000_000, 6], [13_000_000_000, 12], [19_700_000_000, 18]]) {
    const pay = nightlyPayouts(prize, field);
    assert.equal(pay.length, field > 6 ? 6 : 3);
    assert.equal(pay.reduce((a, x) => a + x, 0), prize);
    assert.ok(pay.every(x => x % MONEY_UNIT === 0));
    assert.ok(pay.every((x, i) => i === 0 || x <= pay[i - 1]));
  }
});

test('registration: all day until the start, buy-in locked, refunded on unregister, closed once it starts', () => {
  const w = world(4);
  const { state } = w;
  const noon = START - 9 * 3600_000;
  sweepNightly(state, noon, w.rand);
  assert.equal(state.nightly.id, DAY);
  assert.equal(state.nightly.status, 'REG');
  const u = state.users.min;
  registerNightly(state, u, noon);
  registerNightly(state, u, noon + 1); // twice is once
  assert.equal(u.account.locked, NIGHTLY.buyIn);
  assert.equal(nightlyView(state, u, noon).registered, true);
  assert.equal(nightlyView(state, u, noon).prize, NIGHTLY.buyIn + NIGHTLY.bonus);
  unregisterNightly(state, u, noon + 2);
  assert.equal(u.account.locked, 0);
  assert.equal(u.account.available, 50_000_000_000);
  registerNightly(state, u, noon + 3);
  sweepNightly(state, START, w.rand);
  assert.equal(state.nightly.status, 'RUNNING');
  assert.throws(() => registerNightly(state, state.users.june, START + 1), /NIGHTLY_CLOSED/);
  assert.throws(() => unregisterNightly(state, u, START + 1), /NIGHTLY_CLOSED/);
  const poor = state.users.zero;
  poor.account.available = 0;
  assert.throws(() => registerNightly({ ...state, nightly: { ...state.nightly, status: 'REG' } }, poor, noon), /INSUFFICIENT_BANKROLL/);
});

test('one person: a table of six with five AI, everyone away plays itself out, money adds up', () => {
  const w = world(4, 5);
  const { state } = w;
  const before = money(state);
  sweepNightly(state, START - 3600_000, w.rand);
  registerNightly(state, state.users.hanseo, START - 3600_000);
  sweepNightly(state, START, w.rand);
  const [room] = nightlyRooms(state);
  assert.equal(room.table.seats.length, 6);
  assert.equal(room.table.seats.filter(s => s.kind === 'bot').length, 5);
  assert.ok(room.table.seats.every(s => s.stack === NIGHTLY.buyIn), 'everyone starts with the same 10억 of tournament chips');
  assert.equal(roomOfUser(state, 'hanseo'), room);
  assert.equal(listRooms(state, state.users.min).length, 0, 'nightly tables are not in the friends list');
  assert.throws(() => joinRoom(state, state.users.min, room.code, { now: START, rand: w.rand }), /NIGHTLY_TABLE/);
  const view = roomView(room, 'hanseo', {}, START, state);
  assert.equal(view.nightly, DAY);
  assert.equal(view.tourney.left, 6);
  assert.equal(view.tourney.entrants, 6);
  assert.equal(view.away, true);
  run(w, START);
  const n = state.nightly;
  assert.equal(n.status, 'DONE');
  const e = n.entries.hanseo;
  assert.ok(e.settled && e.place >= 1 && e.place <= 6);
  assert.equal(e.payout, n.payouts[e.place - 1] ?? 0);
  assert.equal(state.users.hanseo.account.locked, 0);
  assert.equal(money(state), before - NIGHTLY.buyIn + e.payout);
  assert.equal(new Set(n.out.map(o => o.place)).size, 5);
});

test('fourteen people: three tables, broken up as the field shrinks, every place once, pool never overpaid', () => {
  const w = world(14, 23);
  const { state, ids } = w;
  const before = money(state);
  sweepNightly(state, START - 600_000, w.rand);
  for (const uid of ids) registerNightly(state, state.users[uid], START - 600_000);
  sweepNightly(state, START, w.rand);
  const n = state.nightly;
  assert.equal(nightlyRooms(state).length, 3);
  assert.equal(n.field, 18);
  assert.equal(n.prize, 14 * NIGHTLY.buyIn + NIGHTLY.bonus);
  const chips = nightlyRooms(state).reduce((a, r) => a + tableChips(r), 0);
  assert.equal(chips, 18 * NIGHTLY.buyIn);
  // Two people come back to their tables; the rest stay away.
  for (const uid of ids.slice(0, 2)) backToSeat(state, state.users[uid], roomOfUser(state, uid).code, { now: START, rand: w.rand });
  let now = START, broke = 0, maxTables = 3;
  for (let k = 0; k < 40_000 && n.status === 'RUNNING'; k++) {
    now += 10_000;
    sweepNightly(state, now, w.rand);
    sweepRooms(state, { now, rand: w.rand });
    const open = nightlyRooms(state).filter(r => r.status === 'OPEN');
    if (open.length < maxTables) { broke += maxTables - open.length; maxTables = open.length; }
    if (n.status === 'RUNNING') assert.equal(open.reduce((a, r) => a + tableChips(r), 0), chips, 'tournament chips never appear or vanish');
    for (const uid of ids) {
      const r = roomOfUser(state, uid);
      if (r?.status === 'OPEN') {
        const p = r.players[uid];
        if (p.seat >= 0) assert.ok(r.table.seats[p.seat].id === uid || r.table.seats[p.seat].stack <= 0, 'nobody sees a chair that is not theirs');
      }
    }
  }
  assert.equal(n.status, 'DONE');
  assert.ok(broke >= 2, 'tables broke up down to one');
  const places = [...n.out.map(o => o.place), 1].sort((a, b) => a - b);
  assert.deepEqual(places, Array.from({ length: 18 }, (_, i) => i + 1));
  const paid = Object.values(n.entries).reduce((a, e) => a + e.payout, 0);
  assert.ok(paid <= n.prize);
  assert.ok(Object.values(n.entries).every(e => e.settled));
  assert.ok(Object.values(state.users).every(u => u.account.locked === 0));
  assert.equal(money(state), before - 14 * NIGHTLY.buyIn + paid);
  assert.equal(nightlyLeft(state), 0);
  // The person moved off a broken table finds where they went.
  const moved = state.holdemRooms.find(r => Object.keys(r.moved || {}).length);
  if (moved) {
    const [uid, code] = Object.entries(moved.moved)[0];
    assert.equal(roomView(moved, uid, {}, now, state).movedTo, code);
  }
  // Getting up after it ended frees everyone, and the tables go.
  for (const uid of ids) { const r = state.holdemRooms.find(x => x.players[uid]); if (r) leaveRoom(state, state.users[uid], r.code, { now, rand: w.rand }); }
  assert.equal(state.holdemRooms.filter(r => r.nightly).length, 0);
  assert.ok(state.feed.some(f => f.type === 'NIGHTLY_WIN'));
});

test('leaving with chips only sits the seat out; the seat still plays and is paid', () => {
  const w = world(4, 9);
  const { state } = w;
  sweepNightly(state, START - 60_000, w.rand);
  registerNightly(state, state.users.june, START - 60_000);
  sweepNightly(state, START, w.rand);
  const room = roomOfUser(state, 'june');
  backToSeat(state, state.users.june, room.code, { now: START, rand: w.rand });
  const out = leaveRoom(state, state.users.june, room.code, { now: START + 1, rand: w.rand });
  assert.equal(out.tourney.away, true);
  assert.equal(room.players.june.away, true);
  run(w, START);
  assert.ok(state.nightly.entries.june.settled);
});

test('a day nobody registered for is cancelled; the next day opens fresh with last night kept', () => {
  const w = world(4);
  const { state } = w;
  sweepNightly(state, START - 1000, w.rand);
  sweepNightly(state, START + 1000, w.rand);
  assert.equal(state.nightly.status, 'CANCELLED');
  sweepNightly(state, START + 6 * 3600_000, w.rand); // past midnight KST
  assert.equal(state.nightly.id, '2026-10-25');
  assert.equal(state.nightly.status, 'REG');
  assert.equal(state.nightlyLast.id, DAY);
});

test('pushes: ten minutes before to everyone with a device, then the start call to the registered, once each', () => {
  const w = world(4);
  const { state } = w;
  state.push = { vapid: { publicKey: 'x', privateKey: 'y' } };
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } };
  for (const uid of ['hanseo', 'min']) state.users[uid].push = { subs: [{ ...sub, endpoint: `${sub.endpoint}${uid}` }], sent: {} };
  sweepNightly(state, START - 3600_000, w.rand);
  registerNightly(state, state.users.hanseo, START - 3600_000);
  assert.equal(planNightlyPushes(state, START - 20 * 60_000).length, 0);
  const plan = planNightlyPushes(state, START - 9 * 60_000);
  assert.equal(plan.length, 2);
  assert.match(plan.find(p => p.userId === 'hanseo').message.title, /10분 뒤/);
  assert.match(plan.find(p => p.userId === 'min').message.title, /등록 마감/);
  // Money in the push reads like the app (50억원), never as a raw 5000000000.
  for (const p of plan) { assert.doesNotMatch(p.message.body, /\d{5,}|\d,\d{3},\d{3}/); assert.match(p.message.body, /[만억조]원/); }
  assert.equal(planNightlyPushes(state, START - 8 * 60_000).length, 0);
  sweepNightly(state, START, w.rand);
  const go = planNightlyPushes(state, START + 1000);
  assert.deepEqual(go.map(p => p.userId), ['hanseo']);
  assert.equal(planNightlyPushes(state, START + 2000).length, 0);
});

test('over the API: the card, register, and the state summary carries it', async () => {
  let state = defaultState();
  const store = { load: async () => state, mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path) => handleApi({ method, header: h => (h === 'x-player-id' ? 'min' : undefined), body: async () => ({}) }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  const card = await call('GET', '/api/nightly');
  assert.equal(card.status, 200);
  assert.equal(card.data.nightly.buyIn, NIGHTLY.buyIn);
  const now = Date.now();
  if (now < nightlyStart(card.data.nightly.id)) {
    const reg = await call('POST', '/api/nightly/register');
    assert.equal(reg.status, 200, JSON.stringify(reg.data));
    assert.equal(reg.data.nightly.registered, true);
    assert.equal(reg.data.state.nightly.people, 1);
  } else {
    const reg = await call('POST', '/api/nightly/register');
    assert.equal(reg.status, 409);
  }
});

test('the hour: 18시 from 2026-10-29, a night made earlier keeps its own hour in every label', async () => {
  const { nightlyLabel, hourOf } = await import('../lib/nightly-tourney.mjs');
  assert.equal(NIGHTLY.hour, 18);
  assert.equal(nightlyLabel(), '저녁 6시');
  assert.equal(nightlyLabel(21), '밤 9시');
  assert.equal(new Date(nightlyStart('2026-10-30')).toISOString(), '2026-10-30T09:00:00.000Z');
  const w = world(4);
  const old = Date.parse('2026-10-29T21:00:00+09:00');
  w.state.nightly = { id: '2026-10-29', startsAt: old, status: 'REG', buyIn: NIGHTLY.buyIn, bonus: NIGHTLY.bonus, entries: {}, tables: [], out: [], field: 0, prize: 0, payouts: [], startedAt: null, endedAt: null, winner: null, reminded: false, startPushed: false };
  assert.equal(hourOf(w.state.nightly), 21);
  const v = nightlyView(w.state, w.state.users.min, old - 3600_000);
  assert.deepEqual([v.label, v.clock, v.nextLabel, v.nextClock], ['밤 9시', '21:00', '저녁 6시', '18:00']);
});
