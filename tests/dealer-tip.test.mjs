import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { defaultState, newUser } from '../lib/state.mjs';
import { tipDealer, TIP_GAMES, TIP_GAP_MS } from '../lib/tips.mjs';
import { handleApi } from '../lib/api.mjs';

const T0 = Date.parse('2026-10-29T03:00:00Z');

test('뽀찌 takes one chip and nothing else: no game result, no RP, no wagered', () => {
  const state = defaultState();
  const u = newUser(state, 'tipper', 'TIPPER');
  u.account.available = 100_000_000;
  const before = structuredClone(u);
  const tip = tipDealer(state, u, { game: 'blackjack', amount: 1_000_000 }, T0);
  assert.equal(tip.amount, 1_000_000);
  assert.equal(u.account.available, before.account.available - 1_000_000);
  assert.equal(u.account.rawPnl, before.account.rawPnl);
  assert.equal(u.account.qualifiedPnl, before.account.qualifiedPnl);
  assert.equal(u.account.totalWagered, before.account.totalWagered);
  assert.deepEqual(u.rp, before.rp);
  assert.deepEqual(u.stats, before.stats);
  const row = state.ledger.at(-1);
  assert.equal(row.type, 'DEALER_TIP');
  assert.equal(row.amount, -1_000_000);
  assert.equal(row.rawPnlDelta, 0);
  assert.deepEqual(u.tips, { total: 1_000_000, count: 1, lastAt: T0 });
});

test('뽀찌 refuses tables with no dealer, odd amounts, too fast, and more than I hold', () => {
  const state = defaultState();
  const u = newUser(state, 'tipper', 'TIPPER');
  u.account.available = 100_000_000;
  for (const game of ['matgo', 'seotda', 'gostop', 'slots', 'horses', 'nope']) {
    assert.throws(() => tipDealer(state, u, { game, amount: 1_000_000 }, T0), /NO_DEALER_HERE/);
  }
  assert.ok(['blackjack', 'baccarat', 'roulette', 'dice'].every(g => TIP_GAMES.has(g)));
  for (const amount of [0, -1_000_000, 1_500_000, 'x', 10 ** 20]) {
    assert.throws(() => tipDealer(state, u, { game: 'roulette', amount }, T0), /BET_NOT_IN_UNITS/);
  }
  tipDealer(state, u, { game: 'roulette', amount: 1_000_000 }, T0);
  assert.throws(() => tipDealer(state, u, { game: 'roulette', amount: 1_000_000 }, T0 + TIP_GAP_MS - 1), /TIP_TOO_FAST/);
  tipDealer(state, u, { game: 'roulette', amount: 1_000_000 }, T0 + TIP_GAP_MS);
  u.account.available = 500_000;
  assert.throws(() => tipDealer(state, u, { game: 'dice', amount: 1_000_000 }, T0 + 10_000), /INSUFFICIENT_BANKROLL/);
});

test('POST /api/tip pays the dealer and returns the new state', async () => {
  let state = defaultState();
  newUser(state, 'tipper', 'TIPPER').account.available = 100_000_000;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (body) => handleApi({ method: 'POST', header: n => ({ 'x-player-id': 'tipper' })[n], body: async () => body }, new URL('http://x/api/tip'), store, {});
  const before = state.users.tipper.account.available;
  const ok = await call({ game: 'baccarat', amount: 1_000_000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.tip.count, 1);
  assert.equal(ok.data.state.user.account.available, before - 1_000_000);
  const no = await call({ game: 'matgo', amount: 1_000_000 });
  assert.equal(no.data.error, 'NO_DEALER_HERE');
});

test('the dealer has a thank-you line for every tip voice id', () => {
  const src = readFileSync(new URL('../public/js/toke.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/'(tip-\d)'/g)].map(m => m[1]);
  assert.ok(ids.length >= 4);
  for (const id of new Set(ids)) assert.ok(existsSync(new URL(`../public/voice/${id}.mp3`, import.meta.url)), id);
});
