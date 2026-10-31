// 승급전 자동 시작 (2026-10-30, 한서 "승급전이 자동으로 되는거지 rp다 차면").
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { lockBet, settleLockedHouseGame } from '../lib/economy.mjs';
import { rpOf } from '../lib/rank-points.mjs';

const OCT = Date.parse('2026-10-29T12:00:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };
const win = (state, u, id, netPnl = 10_000_000) => {
  lockBet(state, u, { stake: 10_000_000, game: 'Blackjack', roundId: id });
  settleLockedHouseGame(state, u, { game: 'Blackjack', stake: 10_000_000, netPnl, roundId: id });
};

test('the round that fills division I opens the 승급전 and pays its fee', () => {
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 1_000_000_000;
  at(OCT, () => {
    rpOf(u, OCT); u.rp.points = 195;
    win(state, u, 'r1');
  });
  assert.equal(u.rp.points, 199, 'RP stops at the top of 아이언 I');
  assert.equal(u.rp.promo?.active, true);
  assert.equal(u.rp.promo.target, 'bronze');
  assert.ok(u.rp.promo.fee > 0);
  assert.equal(u.account.available, 1_000_000_000 + 10_000_000 - u.rp.promo.fee, 'fee came out of the chips');
  // Further wins at the top don't start another one or charge again.
  const fee = u.rp.promo.fee;
  at(OCT, () => win(state, u, 'r2'));
  assert.equal(u.rp.promo.wins, 1);
  assert.equal(u.rp.promo.fee, fee);
});

test('no money for the fee: RP still stops, the series waits for the button', () => {
  const state = defaultState();
  const u = newUser(state, 'p', 'P');
  u.account.available = 10_000_000;
  at(OCT, () => {
    rpOf(u, OCT); u.rp.points = 195;
    win(state, u, 'r1', 5_000_000);
  });
  assert.equal(u.rp.points, 199);
  assert.ok(!u.rp.promo?.active);
});
