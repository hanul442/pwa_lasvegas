// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
// Higher floors play harder (한서's call): sharper AI at every table, and from the Penthouse up the
// blackjack dealer hits soft 17.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY_STARS, levelForStake, aiSkillForStake } from '../lib/constants.mjs';
import { dealerHitsSoft17, dealerDraws, startBlackjackV2 } from '../lib/blackjack-v2.mjs';
import { pickStyle, createHoldemSession } from '../lib/holdem-session.mjs';

function seededRand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('each floor is one level harder, Gold Room ★1 up to The Vault ★5', () => {
  assert.deepEqual([1e6, 1e7, 1e8, 1e9, 1e10, 1e11].map(levelForStake), [0, 1, 2, 3, 4, 5]);
  assert.equal(DIFFICULTY_STARS[0], 1);
  assert.equal(DIFFICULTY_STARS[5], 5);
  assert.ok(aiSkillForStake(1_000_000) < aiSkillForStake(1_000_000_000));
  assert.equal(aiSkillForStake(100_000_000_000), 1);
});

test('the blackjack dealer hits soft 17 from the Penthouse up', () => {
  assert.equal(dealerHitsSoft17(500_000_000), false);
  assert.equal(dealerHitsSoft17(1_000_000_000), true);
  assert.equal(startBlackjackV2([1_000_000_000]).h17, true);
  assert.equal(startBlackjackV2([10_000_000]).h17, false);
  const soft17 = { total: 17, soft: true }, hard17 = { total: 17, soft: false };
  assert.equal(dealerDraws(soft17, false), false);
  assert.equal(dealerDraws(soft17, true), true);
  assert.equal(dealerDraws(hard17, true), false);
});

test("Hold'em bots get sharper up the floors", () => {
  const count = level => { const rand = seededRand(level + 1); let sharp = 0; for (let k = 0; k < 2000; k++) if (['SHARK', 'ROCK'].includes(pickStyle(level, rand))) sharp++; return sharp / 2000; };
  assert.ok(count(0) < 0.4, `Gold Room ${count(0)}`);
  assert.ok(count(5) > 0.75, `Vault ${count(5)}`);
  const s = createHoldemSession({ userId: 'u', nickname: '나', buyIn: 10_000_000, tier: 'gold-room', floor: 'gold-room' }, seededRand(3));
  assert.equal(s.table.level, 0);
});
