// 운영자 RP 티어 설정 (2026-10-30, 한서 "내 계정 실버 5로 올려줘봐").
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { adminSetRp } from '../lib/admin.mjs';
import { rpDivision, rpTierFor } from '../lib/rank-points.mjs';

const OCT = Date.parse('2026-10-30T12:00:00+09:00');

test('the operator moves a player to 실버 V and only the operator can', () => {
  const state = defaultState();
  const admin = newUser(state, 'a', 'A'); admin.isAdmin = true;
  const u = newUser(state, 'p', 'P');
  const r = adminSetRp(state, admin, { userId: u.id, tier: 'silver', division: 'V' }, OCT);
  assert.equal(r.points, 200);
  assert.equal(rpTierFor(u.rp.points).id, 'silver');
  assert.equal(rpDivision(u.rp.points), 'V');
  assert.equal(adminSetRp(state, admin, { userId: u.id, tier: 'gold', division: 'II' }, OCT).points, 440);
  assert.equal(rpDivision(440), 'II');
  assert.equal(adminSetRp(state, admin, { userId: u.id, tier: 'legend' }, OCT).points, 2300);
  assert.throws(() => adminSetRp(state, u, { userId: u.id, tier: 'silver' }, OCT), /FORBIDDEN/);
  assert.throws(() => adminSetRp(state, admin, { userId: u.id, tier: 'nope' }, OCT), /INVALID_TIER/);
});
