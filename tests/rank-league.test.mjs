import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { noteRp } from '../lib/rank-points.mjs';
import { joinLeagues, settleLeagues, leagueView, leagueDue, groupBots, LEAGUE_SIZE } from '../lib/rank-league.mjs';

const MON = Date.parse('2026-11-02T01:00:00Z'); // Monday 10:00 KST
const DAY = 86_400_000;

function world(n) {
  const state = defaultState();
  const people = Array.from({ length: n }, (_, i) => newUser(state, `p${i}`, `P${i}`));
  return { state, people };
}

test('playing a round puts you in a 30-seat group of your league; AI fill the rest', () => {
  const { state, people: [a, b] } = world(2);
  joinLeagues(state, MON);
  assert.equal(leagueView(state, a, MON).joined, false, 'no round this week, no group');
  noteRp(a, { stake: 1e6, netPnl: 1e6 }, MON);
  noteRp(b, { stake: 1e6, netPnl: 2e6 }, MON);
  joinLeagues(state, MON);
  joinLeagues(state, MON);
  assert.equal(state.league.groups.length, 1);
  assert.deepEqual(state.league.groups[0].members, ['p0', 'p1']);
  const v = leagueView(state, a, MON + 3_600_000);
  assert.equal(v.rows.length, LEAGUE_SIZE);
  assert.equal(v.rows.filter(r => r.ai).length, LEAGUE_SIZE - 2);
  assert.equal(v.score, 10);
  assert.equal(v.name, '루키 리그');
  // A read-only copy draws the very same group.
  const copy = structuredClone(world(0).state);
  Object.assign(copy.users, structuredClone({ p0: a, p1: b }));
  joinLeagues(copy, MON);
  assert.equal(copy.league.groups[0].id, state.league.groups[0].id);
});

test('AI scores only grow through the week and stay the same for the same moment', () => {
  const group = { id: 'g', seed: 'seed', level: 2, members: ['x'] };
  const early = groupBots(group, 0.2), late = groupBots(group, 0.9), end = groupBots(group, 1);
  assert.equal(early.length, LEAGUE_SIZE - 1);
  for (let i = 0; i < early.length; i++) { assert.ok(early[i].value <= late[i].value); assert.ok(late[i].value <= end[i].value); }
  assert.deepEqual(groupBots(group, 0.5), groupBots(group, 0.5));
  assert.ok(groupBots(group, 0).every(b => b.value === 0));
  assert.equal(new Set(early.map(b => b.nickname)).size, early.length, 'no two AI share a name');
});

test('when the week ends the top five go up, the bottom five go down, the top three get a badge', () => {
  const { state, people } = world(2);
  const [star, idle] = people;
  idle.league = { level: 2 };
  for (let i = 0; i < 40; i++) noteRp(star, { stake: 1e6, netPnl: 30e6 }, MON + (i % 7) * DAY); // a big week
  noteRp(idle, { stake: 1e6, netPnl: -1e6 }, MON);
  joinLeagues(state, MON + 6 * DAY);
  assert.equal(leagueDue(state, MON + 6 * DAY), false);
  const NEXT = MON + 7 * DAY + 1000;
  assert.equal(leagueDue(state, NEXT), true);
  settleLeagues(state, NEXT);
  assert.equal(leagueDue(state, NEXT), false);
  assert.equal(star.league.level, 1, 'rookie → pro');
  assert.equal(star.league.last.rank, 1);
  assert.equal(star.badges[0].kind, 'LEAGUE');
  assert.equal(idle.league.level, 1, 'elite → pro after a week at the bottom');
  assert.equal(idle.league.last.move, -1);
  settleLeagues(state, NEXT);
  assert.equal(star.badges.filter(b => b.kind === 'LEAGUE').length, 1, 'a week closes once');
  // The new week starts with no group until a round is played.
  assert.equal(leagueView(state, star, NEXT).joined, false);
  assert.equal(leagueView(state, star, NEXT).name, '프로 리그');
});
