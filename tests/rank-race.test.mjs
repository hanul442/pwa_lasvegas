// 시즌 레이스 (lib/rank-race.mjs): the race card, passes as news, and the last week's 2× RP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { noteRp, rpView, spurtAt, SPURT_TIMES } from '../lib/rank-points.mjs';
import { raceView, notePasses, passNews } from '../lib/rank-race.mjs';
import { newsFor } from '../lib/news.mjs';
import { messageFor } from '../lib/notifications.mjs';

const MID = Date.parse('2026-11-10T03:00:00Z');
const SPURT = Date.parse('2026-11-23T15:00:00Z'); // 11-24 00:00 KST
const END = Date.parse('2026-11-30T15:00:00Z');   // 12-01 00:00 KST

function casino(points) {
  const state = defaultState();
  for (const [id, p] of Object.entries(points)) {
    if (!state.users[id]) newUser(state, id, id.toUpperCase());
    state.users[id].rp = { season: 'rank-2026-10', points: p, peak: p, rounds: 3, day: '2026-11-10', dayGain: 0 };
  }
  return state;
}

test('the last seven days double a won round, not a lost one', () => {
  assert.equal(spurtAt(MID).active, false);
  assert.equal(spurtAt(SPURT - 1).active, false);
  assert.equal(spurtAt(SPURT).active, true);
  assert.equal(spurtAt(SPURT).endsAt, new Date(END).toISOString());
  const u = { rp: { season: 'rank-2026-10', points: 250, peak: 250, rounds: 1, day: '2026-11-24', dayGain: 0 } };
  assert.equal(noteRp(u, { stake: 1e6, netPnl: 1e6 }, SPURT + 3_600_000), 10 * SPURT_TIMES);
  assert.equal(u.rp.last.spurt, SPURT_TIMES);
  assert.equal(noteRp(u, { stake: 1e6, netPnl: -1e6 }, SPURT + 3_600_000), -7, 'a loss is not doubled');
  assert.equal(noteRp(u, { stake: 1e6, netPnl: 1e6 }, MID), 10, 'before the last week: as before');
  assert.equal(rpView(u, SPURT).spurt.active, true);
  u.rp.points = 440;
  assert.equal(noteRp(u, { stake: 1e6, netPnl: 1e6 }, SPURT + 3_600_000), 9, 'still stops at the top of division I');
});

test('the race card: the player above, the one below, the gap to third', () => {
  const state = casino({ a: 900, b: 700, c: 520, d: 500, e: 480 });
  const v = raceView(state, state.users.d, MID);
  assert.equal(v.rank, 4);
  assert.deepEqual([v.above.nickname, v.above.need], ['C', 21]);
  assert.deepEqual([v.below.nickname, v.below.gap], ['E', 20]);
  assert.equal(v.podium.need, 21);
  const top = raceView(state, state.users.a, MID);
  assert.equal(top.rank, 1);
  assert.equal(top.above, null);
  assert.equal(top.podium, null, 'already on the podium');
  assert.equal(raceView(state, { ...state.users.a, guest: true }, MID), null);
});

test('passing players: each one hears it once, as news that can go to their phone', () => {
  const state = casino({ a: 900, b: 700, c: 520, d: 500, e: 480 });
  state.users.e.rp.points = 600; // a round lifted E from 480 past D and C
  const passed = notePasses(state, state.users.e, 480, MID);
  assert.deepEqual(passed.sort(), ['c', 'd']);
  assert.equal(notePasses(state, state.users.e, 480, MID + 60_000), null, 'the same pass within half an hour is not repeated');
  const news = passNews(state, 'd', MID - 1, MID);
  assert.equal(news.length, 1);
  assert.match(news[0].title, /E님이 나를 제쳤어요/);
  assert.match(news[0].body, /지금 5위 · 101 RP면 다시 앞서요/);
  assert.equal(news[0].push, true);
  assert.equal(passNews(state, 'e', MID - 1, MID).length, 0, 'the passer gets no banner');
  const real = Date.now; Date.now = () => MID;
  try { assert.ok(newsFor(state, 'c', MID - 1).some(n => n.type === 'RANK_PASSED')); } finally { Date.now = real; }
  assert.equal(notePasses(state, state.users.b, 700, MID), null, 'no gain, no pass');
});

test('the push opening the last week says where I stand', () => {
  const state = casino({ a: 900, d: 500 });
  const u = state.users.d;
  u.push = { subs: [{ endpoint: 'https://push.example.com/x', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } }], sent: {}, lastSeenAt: null };
  u.createdAt = new Date(MID).toISOString();
  state.ledger = [];
  const noon = Date.parse('2026-11-24T13:00:00+09:00');
  const msg = messageFor(state, u, noon);
  assert.equal(msg.slot, 'spurt');
  assert.match(msg.title, /막판 스퍼트: 이기면 RP 2배/);
  assert.match(msg.body, /2위 · 1위까지 401 RP/);
  u.push.sent.spurt = 'rank-2026-10';
  assert.notEqual(messageFor(state, u, noon + 3_600_000)?.slot, 'spurt', 'once a season');
  const last = messageFor(state, u, Date.parse('2026-11-30T13:00:00+09:00'));
  assert.equal(last.slot, 'seasonEnd');
  assert.match(last.body, /2위 · 1위까지 401 RP/);
});
