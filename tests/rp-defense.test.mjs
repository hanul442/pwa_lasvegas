// 강등 방어전 (2026-10-30, 한서 "승급전이 있으면 강등 방어전도 있어야겠지 5판중에 3판지면 내려가는걸로").
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { rpOf, noteRp, rpTierFor, rpDivision } from '../lib/rank-points.mjs';
import { defenseView } from '../lib/promo.mjs';

const OCT = Date.parse('2026-10-30T12:00:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };
const lose = u => noteRp(u, { game: 'Baccarat', stake: 30_000_000, netPnl: -30_000_000 }, OCT);
const win = u => noteRp(u, { game: 'Baccarat', stake: 30_000_000, netPnl: 30_000_000 }, OCT);

test('a loss at the bottom of 실버 V stops there and opens the 방어전; three losses drop to 브론즈 I', () => {
  const u = newUser(defaultState(), 'p', 'P');
  rpOf(u, OCT); u.rp.points = 205;
  lose(u);
  assert.equal(u.rp.points, 200, 'RP stops at the start of 실버 V');
  assert.equal(u.rp.defense.active, true);
  assert.equal(u.rp.defense.tier, 'silver');
  assert.equal(u.rp.defense.losses, 0, 'the round that opens it does not count');
  lose(u); lose(u);
  assert.equal(u.rp.points, 200);
  assert.equal(at(OCT, () => defenseView(u, OCT)).active.log, 'LL');
  lose(u);
  assert.equal(u.rp.defense.result, 'demoted');
  assert.equal(rpTierFor(u.rp.points).id, 'bronze');
  assert.equal(rpDivision(u.rp.points), 'I');
  assert.equal(at(OCT, () => defenseView(u, OCT)).last.result, 'demoted');
});

test('three wins keep the tier; 아이언 has no 방어전', () => {
  const u = newUser(defaultState(), 'p', 'P');
  rpOf(u, OCT); u.rp.points = 200;
  lose(u);
  win(u); lose(u); win(u); win(u);
  assert.equal(u.rp.defense.result, 'kept');
  assert.equal(u.rp.defense.log, 'WLWW');
  assert.equal(rpTierFor(u.rp.points).id, 'silver');
  const v = newUser(defaultState(), 'v', 'V');
  rpOf(v, OCT); v.rp.points = 5;
  lose(v);
  assert.equal(v.rp.points, 0);
  assert.equal(v.rp.defense, undefined);
});
