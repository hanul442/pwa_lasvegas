import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { missionsStatus, claimMission, missionStreakStatus, MISSIONS, MISSION_SWEEP_BONUS } from '../lib/engagement.mjs';
import { COSMETICS } from '../lib/cosmetics.mjs';
import { ACHIEVEMENTS } from '../lib/achievements.mjs';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-02T03:00:00Z'); // noon in Seoul

// Marks all three of the day's missions done (at a 100만 base), then claims them in turn.
function finishAll(user, now) {
  const st = missionsStatus(user, now);
  user.missions = { day: st.day, items: st.items.map(i => ({ id: i.id, progress: MISSIONS.find(m => m.id === i.id).target, claimed: false, base: 1_000_000 })), games: [], swept: false };
}
function claimAll(state, user, now) {
  finishAll(user, now);
  let last;
  for (const it of user.missions.items) last = claimMission(state, user, it.id, now);
  return last;
}

test('미션 연속 달성 pays on the 3rd and 7th day, then goes round again', () => {
  const state = defaultState();
  const user = Object.values(state.users)[0];
  assert.throws(() => claimMission(state, user, missionsStatus(user, T0).items[0].id, T0), /MISSION_NOT_DONE/);
  const sweepBonus = MISSION_SWEEP_BONUS * 1_000_000;
  const paid = [];
  for (let d = 0; d < 10; d++) {
    const r = claimAll(state, user, T0 + d * DAY);
    paid.push(r.streak ? r.streak.amount / sweepBonus : 0);
    assert.equal(r.sweep, sweepBonus);
  }
  assert.deepEqual(paid, [0, 0, 1, 0, 0, 0, 3, 0, 0, 1]);
  assert.equal(missionStreakStatus(user, T0 + 9 * DAY).count, 10);
  assert.equal(user.missionStreak.best, 10);
  assert.ok(state.ledger.some(l => l.metadata?.mission === 'streak' && l.metadata.day === 7));
});

test('a missed day starts the run from day 1; status says when the next bonus comes', () => {
  const state = defaultState();
  const user = Object.values(state.users)[0];
  claimAll(state, user, T0);
  claimAll(state, user, T0 + DAY);
  let st = missionStreakStatus(user, T0 + 2 * DAY);
  assert.deepEqual([st.count, st.day, st.next.inDays, st.next.day], [2, 3, 0, 3], 'today is day 3');
  st = missionStreakStatus(user, T0 + DAY);
  assert.deepEqual([st.count, st.doneToday, st.next.inDays], [2, true, 1]);
  st = missionStreakStatus(user, T0 + 3 * DAY);
  assert.deepEqual([st.count, st.day], [0, 1], 'skipped a day');
  const r = claimAll(state, user, T0 + 3 * DAY);
  assert.equal(r.streak, null);
  assert.equal(user.missionStreak.count, 1);
});

test('개근 명패 comes from the 7-day mission run', () => {
  const frame = COSMETICS.find(c => c.id === 'frame-attend');
  assert.equal(frame.achievement, 'mission-week');
  const a = ACHIEVEMENTS.find(x => x.id === 'mission-week');
  assert.equal(a.value({ missionStreak: { best: 7 } }), 7);
  assert.equal(a.target, 7);
});
