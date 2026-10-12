import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { handleApi } from '../lib/api.mjs';
import { slotLine, spinSlots, SLOT_SYMBOLS, REEL_WEIGHTS, STOPS, STRIP, JACKPOT_SEED, JACKPOT_RATE } from '../lib/slots.mjs';

test('reels have 64 stops and the base game returns about 90.7%', () => {
  assert.equal(STOPS, 64);
  // Spread out: no symbol sits next to itself more than a few times around the reel.
  const repeats = STRIP.filter((s, i) => s === STRIP[(i + 1) % STOPS]).length;
  assert.ok(repeats <= 4, String(repeats));
  let rtp = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
    rtp += (REEL_WEIGHTS[a] * REEL_WEIGHTS[b] * REEL_WEIGHTS[c]) / STOPS ** 3 * slotLine([a, b, c]).mult;
  }
  assert.ok(rtp > 0.89 && rtp < 0.92, String(rtp));
});

test('paylines: stars are wild, three stars are the jackpot', () => {
  assert.equal(slotLine(['SEVEN', 'SEVEN', 'SEVEN']).mult, 80);
  assert.equal(slotLine(['SEVEN', 'STAR', 'SEVEN']).mult, 160);
  assert.equal(slotLine(['STAR', 'STAR', 'BAR1']).mult, 30);
  assert.equal(slotLine(['BAR1', 'BAR3', 'BAR2']).mult, 4);
  assert.equal(slotLine(['H', 'D', 'H']).mult, 2);
  assert.equal(slotLine(['H', 'S', 'H']).mult, 0);
  assert.equal(slotLine(['STAR', 'S', 'H']).mult, 1);
  assert.equal(slotLine(['STAR', 'STAR', 'STAR']).jackpot, true);
});

test('the jackpot grows with every spin and pays in proportion to the bet', () => {
  const state = defaultState();
  const lose = spinSlots(state, { stake: 1_000_000, maxBet: 10_000_000, stopsOverride: [STRIP.indexOf('C'), STRIP.indexOf('C'), STRIP.indexOf('H')] });
  assert.equal(state.jackpot.pool, JACKPOT_SEED + 1_000_000 * JACKPOT_RATE);
  assert.equal(lose.netPnl, -1_000_000);
  const pool = state.jackpot.pool + 5_000_000 * JACKPOT_RATE;
  const win = spinSlots(state, { stake: 5_000_000, maxBet: 10_000_000, stopsOverride: [STRIP.indexOf('STAR'), STRIP.indexOf('STAR'), STRIP.lastIndexOf('STAR')] });
  assert.equal(win.line, 'JACKPOT');
  assert.equal(win.jackpot, Math.floor(pool / 2));
  assert.equal(win.netPnl, 5_000_000 * 500 + win.jackpot - 5_000_000);
  assert.equal(state.jackpot.pool, Math.max(JACKPOT_SEED, pool - win.jackpot));
});

test('slots spin settles through the API and posts a jackpot to the lounge', async () => {
  let state = defaultState();
  // Mid-way through High Limit (1억–10억 net worth), so a win doesn't graduate the floor before the replay.
  state.users.hanseo.account.available = 300_000_000;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (path, body, key) => handleApi({ method: 'POST', header: n => (n === 'x-idempotency-key' ? key : undefined), body: async () => body }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  const before = state.users.hanseo.account.available;
  const res = await call('/api/slots/spin', { stake: 10_000_000, floor: 'high-limit' }, 'slot-key-0001');
  assert.equal(res.status, 200);
  assert.equal(res.data.state.user.account.available, before + res.data.round.netPnl);
  assert.equal(res.data.round.reels.length, 3);
  assert.ok(res.data.state.jackpot.pool > JACKPOT_SEED);
  const again = await call('/api/slots/spin', { stake: 10_000_000, floor: 'high-limit' }, 'slot-key-0001');
  assert.equal(again.data.replayed, true);
  assert.equal(again.data.state.user.account.available, res.data.state.user.account.available);
});
