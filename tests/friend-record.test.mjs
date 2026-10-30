// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noteFriendHand, noteFriendTable, friendRecordView, RECENT_MAX } from '../lib/friend-record.mjs';
import { createRoom, joinRoom, startRoom, roomAction, tick, NEXT_HAND_MS } from '../lib/table-room.mjs';
import { matgoAiDecision } from '../lib/matgo.mjs';
import { validateRoomStake } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { defaultState } from '../lib/state.mjs';

const T0 = Date.parse('2026-10-28T12:00:00Z');
const people = (...xs) => xs.map(([id, net]) => ({ id, nickname: id.toUpperCase(), net }));

test('hands at the same room in a row are one sitting; each friend keeps who came out ahead', () => {
  const state = defaultState();
  noteFriendTable(state, { game: 'Seotda', room: 'ABCD', people: people(['hanseo', 300], ['min', -300]) }, T0);
  noteFriendTable(state, { game: 'Seotda', room: 'ABCD', people: people(['hanseo', -100], ['min', 100]) }, T0 + 60_000);
  noteFriendTable(state, { game: 'Seotda', room: 'ABCD', people: people(['hanseo', 50], ['min', -50]) }, T0 + 120_000);
  const v = friendRecordView(state, state.users.hanseo);
  assert.equal(v.recent.length, 1);
  assert.deepEqual({ hands: v.recent[0].hands, net: v.recent[0].net, wins: v.recent[0].wins, losses: v.recent[0].losses }, { hands: 3, net: 250, wins: 2, losses: 1 });
  assert.deepEqual(v.recent[0].with.map(w => w.id), ['min']);
  const min = v.vs.find(x => x.id === 'min');
  assert.deepEqual({ hands: min.hands, won: min.won, lost: min.lost, net: min.net }, { hands: 3, won: 2, lost: 1, net: 250 });
  assert.equal(min.nickname, state.users.min.nickname, 'names come from the current player list');
  const theirs = friendRecordView(state, state.users.min).vs.find(x => x.id === 'hanseo');
  assert.deepEqual({ won: theirs.won, lost: theirs.lost }, { won: 1, lost: 2 }, 'the other side sees the mirror');
  // A long break or another room starts a new sitting.
  noteFriendTable(state, { game: 'Seotda', room: 'ABCD', people: people(['hanseo', 10], ['min', -10]) }, T0 + 3 * 3_600_000);
  noteFriendTable(state, { game: 'Matgo', room: 'WXYZ', people: people(['hanseo', 10], ['min', -10]) }, T0 + 3 * 3_600_000 + 1000);
  assert.equal(friendRecordView(state, state.users.hanseo).recent.length, 3);
  assert.equal(friendRecordView(state, state.users.hanseo).recent[0].game, 'Matgo', 'newest first');
});

test('playing alone, guests and the list caps leave the record tidy', () => {
  const state = defaultState();
  noteFriendTable(state, { game: 'Seotda', room: 'AAAA', people: people(['hanseo', 10]) }, T0);
  assert.equal(state.users.hanseo.friendRecord, undefined, 'AI-only hands are not friend games');
  noteFriendHand({ id: 'g1', guest: true }, { game: 'Seotda', room: 'AAAA', net: 5, others: [{ id: 'min', nickname: 'MIN', net: -5 }] }, T0);
  for (let i = 0; i < RECENT_MAX + 5; i++) noteFriendTable(state, { game: 'Seotda', room: `R${i}`, people: people(['hanseo', 1], ['min', -1]) }, T0 + i * 1000);
  assert.equal(state.users.hanseo.friendRecord.recent.length, RECENT_MAX);
  assert.equal(friendRecordView(state, state.users.hanseo).recent.length, 10);
  assert.deepEqual(friendRecordView(state, { id: 'x' }), { recent: [], vs: [] });
});

test('a tournament counts places; a Hold\'em cash stay lists friends without a winner', () => {
  const user = { id: 'hanseo', nickname: 'H' };
  noteFriendHand(user, { game: "Hold'em", room: 'TTTT', net: 900, place: 1, tourney: true, others: [{ id: 'min', nickname: 'M', place: 2 }, { id: 'june', nickname: 'J', place: 3 }] }, T0);
  noteFriendHand(user, { game: "Hold'em", room: 'CCCC', net: -50, compare: false, others: [{ id: 'min', nickname: 'M' }] }, T0 + 1000);
  const rec = user.friendRecord;
  assert.equal(rec.recent[1].tourney, true);
  assert.deepEqual([rec.recent[1].place, rec.recent[1].of], [1, 3]);
  assert.deepEqual({ hands: rec.vs.min.hands, won: rec.vs.min.won, lost: rec.vs.min.lost }, { hands: 2, won: 1, lost: 0 });
});

test('a real 맞고 room between two friends writes both records', () => {
  const state = defaultState();
  for (const uid of ['hanseo', 'june']) state.users[uid].account.available = 900_000_000;
  let clock = T0;
  let x = 11;
  const rand = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const ctx = () => ({ now: clock, rand, validateStake: (u, f, s) => validateRoomStake(u, FLOORS.find(fl => fl.slug === f), s) });
  const room = createRoom(state, state.users.hanseo, { game: 'matgo', stake: 10_000_000, floor: 'high-limit' }, ctx());
  joinRoom(state, state.users.june, room.code, ctx());
  startRoom(state, state.users.hanseo, room.code, ctx());
  let settled = 0;
  for (let step = 0; step < 3000 && settled < 2; step++) {
    const r = room.round;
    if (r.status === 'SETTLED') { settled++; clock += NEXT_HAND_MS; tick(state, room, ctx()); continue; }
    const s = r.phase === 'PLAY' ? r.turn : r.pending.seat;
    const seat = r.seats[s];
    roomAction(state, state.users[seat.userId], room.code, { handNo: room.handNo, seq: room.events.length, ...matgoAiDecision(r, s, n => Math.floor(rand() * n)) }, ctx());
  }
  assert.ok(settled >= 2);
  for (const [me, friend] of [['hanseo', 'june'], ['june', 'hanseo']]) {
    const v = friendRecordView(state, state.users[me]);
    assert.equal(v.recent[0].game, 'Matgo');
    assert.ok(v.recent[0].hands >= 2, 'both hands in one sitting');
    assert.equal(v.vs[0].id, friend);
  }
  const h = state.users.hanseo.friendRecord.vs.june, j = state.users.june.friendRecord.vs.hanseo;
  assert.equal(h.won, j.lost);
  assert.equal(h.net, -j.net, 'a two-person 맞고 is zero-sum');
});

test('랭킹 is its own tab in the bottom menu with 티어 · 순위 · 친구 전적 views', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const nav = html.slice(html.indexOf('<nav class="bottom-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="bottom-nav"')));
  assert.deepEqual([...nav.matchAll(/data-nav="([a-z]+)"/g)].map(m => m[1]), ['lobby', 'games', 'shop', 'ranking', 'bank', 'profile']);
  assert.ok(!/data-nav="ranking">랭킹<\/button><button class="subtab"/.test(html) && !html.includes('class="subtab" type="button" data-nav="ranking"'), '내 정보 no longer holds 랭킹');
  for (const pane of ['tier', 'board', 'friends']) assert.match(html, new RegExp(`data-rank-pane="${pane}"`));
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const NAV_GROUP = \{ events: 'games', settings: 'profile' \}/);
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'js\/rank-tab\.js'/);
});
