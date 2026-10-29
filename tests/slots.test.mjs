import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { handleApi } from '../lib/api.mjs';
import { slotLine, spinSlots, SLOT_SYMBOLS, REEL_WEIGHTS, STOPS, STRIP, JACKPOT_SEED, JACKPOT_RATE, JACKPOT_STAKE_CAP, STAR_LINE, LIGHTNING_LINE, FREE_SPINS, FREE_SPIN_MULT, FREE_SPIN_CAP, scatterReels, SLOT_LIGHTNING_MULTIPLIERS, SLOT_LIGHTNING_STRIKE_COUNTS, rollSlotLightning, slotStrikes, lightningBoost } from '../lib/slots.mjs';
import { forceHotTable, HOT_BONUS } from '../lib/hot-table.mjs';
import { instantRequestFingerprint, idempotentInstantRound } from '../lib/instant-idempotency.mjs';

// These tests count exact payouts: keep the hot table bonus out of them whatever the hour.
forceHotTable('off');

test('reels have 64 stops and the base line returns about 91.8%', () => {
  assert.equal(STOPS, 64);
  // Spread out: no symbol sits next to itself more than a few times around the reel.
  const repeats = STRIP.filter((s, i) => s === STRIP[(i + 1) % STOPS]).length;
  assert.ok(repeats <= 4, String(repeats));
  let rtp = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
    rtp += (REEL_WEIGHTS[a] * REEL_WEIGHTS[b] * REEL_WEIGHTS[c]) / STOPS ** 3 * slotLine([a, b, c]).mult;
  }
  assert.ok(Math.abs(rtp - 0.9182) < 0.0005, String(rtp));
  // The FREE coins sit far apart, so a reel's window never shows two.
  const coins = STRIP.flatMap((s, i) => (s === 'FREE' ? [i] : []));
  assert.equal(coins.length, 3);
  coins.forEach((c, i) => assert.ok((coins[(i + 1) % 3] - c + STOPS) % STOPS > 3));
});

test('the client reel matches the server reel stop for stop', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../public/js/games/slots.js', import.meta.url), 'utf8');
  const weights = Function(`return ${src.match(/const WEIGHTS = (\{[^}]*\})/)[1]}`)();
  assert.deepEqual(weights, REEL_WEIGHTS);
});

test('paylines: stars are wild, three stars are the jackpot', () => {
  assert.equal(slotLine(['SEVEN', 'SEVEN', 'SEVEN']).mult, 100);
  assert.equal(slotLine(['SEVEN', 'STAR', 'SEVEN']).mult, 200);
  assert.equal(slotLine(['STAR', 'STAR', 'BAR1']).mult, 30);
  assert.equal(slotLine(['BAR1', 'BAR3', 'BAR2']).mult, 4);
  assert.equal(slotLine(['H', 'D', 'H']).mult, 2);
  assert.equal(slotLine(['H', 'S', 'H']).mult, 0);
  assert.equal(slotLine(['STAR', 'S', 'H']).mult, 1);
  assert.equal(slotLine(['STAR', 'STAR', 'STAR']).jackpot, true);
  // The FREE coin is no line symbol: three on the line pay nothing there, beside stars only the star pays.
  assert.equal(slotLine(['FREE', 'FREE', 'FREE']).mult, 0);
  assert.equal(slotLine(['STAR', 'FREE', 'FREE']).mult, 1);
  assert.equal(slotLine(['STAR', 'STAR', 'FREE']).mult, 10);
  assert.equal(slotLine(['FREE', 'BAR1', 'BAR2']).mult, 0);
});

test('the jackpot grows with every spin and pays in proportion to the bet', () => {
  const state = defaultState();
  const lose = spinSlots(state, { stake: 1_000_000, maxBet: 10_000_000, stopsOverride: [STRIP.indexOf('C'), STRIP.indexOf('C'), STRIP.indexOf('H')] });
  const pot = () => state.jackpot.floors[10_000_000].pool;
  assert.equal(pot(), JACKPOT_SEED + 1_000_000 * JACKPOT_RATE);
  assert.equal(lose.netPnl, -1_000_000);
  const pool = pot() + 5_000_000 * JACKPOT_RATE;
  const win = spinSlots(state, { stake: 5_000_000, maxBet: 10_000_000, stopsOverride: [STRIP.indexOf('STAR'), STRIP.indexOf('STAR'), STRIP.lastIndexOf('STAR')] });
  assert.equal(win.line, 'JACKPOT');
  assert.equal(win.jackpot, Math.floor(pool / 2 / 1_000_000) * 1_000_000, 'the jackpot pays whole 100만s');
  assert.equal(win.netPnl, 5_000_000 * 500 + win.jackpot - 5_000_000);
  assert.equal(pot(), Math.max(JACKPOT_SEED, pool - win.jackpot));
  // Another floor's spins feed only that floor's pot.
  spinSlots(state, { stake: 100_000_000_000, maxBet: 1_000_000_000_000, stopsOverride: [STRIP.indexOf('C'), STRIP.indexOf('C'), STRIP.indexOf('H')] });
  assert.equal(pot(), Math.max(JACKPOT_SEED, pool - win.jackpot));
  assert.equal(state.jackpot.floors[1_000_000_000_000].pool, 500 * 1_000_000_000_000 + 100_000_000_000 * JACKPOT_RATE);
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
  assert.ok(res.data.state.jackpot.floors['high-limit'] > 500 * 100_000_000);
  const again = await call('/api/slots/spin', { stake: 10_000_000, floor: 'high-limit' }, 'slot-key-0001');
  assert.equal(again.data.replayed, true);
  assert.equal(again.data.state.user.account.available, res.data.state.user.account.available);
});

// ---------- 라이트닝 슬롯 ----------
const at = sym => STRIP.indexOf(sym);
const stopsFor = (a, b, c) => [STRIP.indexOf(a), STRIP.indexOf(b), STRIP.lastIndexOf(c)];
// Exact return of a table: every reel combination, times the strikes' expected boost on a paying line.
function exactRtp({ lightning }) {
  const w = t => t.reduce((a, [, x]) => a + x, 0);
  const choose = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  let boost = 1;
  if (lightning) {
    // No strike on the payline: ×1. Otherwise the sum of what hit it: E[count] × 3/9 × E[multiplier].
    const none = SLOT_LIGHTNING_STRIKE_COUNTS.reduce((a, [k, x]) => a + x / w(SLOT_LIGHTNING_STRIKE_COUNTS) * choose(6, k) / choose(9, k), 0);
    const eCount = SLOT_LIGHTNING_STRIKE_COUNTS.reduce((a, [k, x]) => a + k * x, 0) / w(SLOT_LIGHTNING_STRIKE_COUNTS);
    const eMult = SLOT_LIGHTNING_MULTIPLIERS.reduce((a, [m, x]) => a + m * x, 0) / w(SLOT_LIGHTNING_MULTIPLIERS);
    boost = none + eCount / 3 * eMult;
  }
  let rtp = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
    const line = slotLine([a, b, c], { lightning });
    rtp += (REEL_WEIGHTS[a] * REEL_WEIGHTS[b] * REEL_WEIGHTS[c]) / STOPS ** 3 * line.mult * (line.jackpot ? 1 : boost);
  }
  return rtp;
}

test('lightning pays: its own table, a struck payline adds its multipliers, the plain table is untouched', () => {
  assert.equal(slotLine(['SEVEN', 'SEVEN', 'SEVEN'], { lightning: true }).mult, 30);
  assert.equal(slotLine(['SEVEN', 'STAR', 'SEVEN'], { lightning: true }).mult, 60);
  assert.equal(slotLine(['H', 'D', 'H'], { lightning: true }).mult, 1);
  assert.equal(slotLine(['STAR', 'S', 'H'], { lightning: true }).mult, 0, 'a lone star pays nothing on the lightning table');
  assert.equal(slotLine(['STAR', 'STAR', 'STAR'], { lightning: true }).mult, STAR_LINE);
  assert.equal(slotLine(['SEVEN', 'SEVEN', 'SEVEN']).mult, 100);
  assert.equal(LIGHTNING_LINE.SEVEN, 30);
  assert.equal(lightningBoost([{ reel: 0, row: 1, multiplier: 2 }, { reel: 2, row: 1, multiplier: 5 }, { reel: 1, row: 0, multiplier: 50 }]), 7);
  assert.equal(lightningBoost([{ reel: 1, row: 2, multiplier: 50 }]), 1);

  const state = defaultState();
  const stake = 2_000_000;
  // 7 7 7 with 10× and 3× on the payline and 50× off it: 30 × (10 + 3) = 390× the stake.
  const strikes = [{ reel: 0, row: 1, multiplier: 10 }, { reel: 2, row: 1, multiplier: 3 }, { reel: 1, row: 0, multiplier: 50 }];
  const r = spinSlots(state, { stake, maxBet: 10_000_000, stopsOverride: stopsFor('SEVEN', 'SEVEN', 'SEVEN'), lightning: strikes });
  assert.deepEqual(r.lightning, strikes);
  assert.equal(r.lineMult, 30);
  assert.equal(r.boost, 13);
  assert.equal(r.mult, 390);
  assert.equal(r.netPnl, stake * 390 - stake);
  // Struck only off the line: the lightning table's plain pay, no boost.
  const off = spinSlots(state, { stake, maxBet: 10_000_000, stopsOverride: stopsFor('BAR1', 'BAR2', 'BAR3'), lightning: [{ reel: 1, row: 2, multiplier: 50 }] });
  assert.equal(off.mult, 1);
  assert.equal(off.boost, undefined);
  assert.equal(off.netPnl, 0);
  // A loss stays a loss, however hard the line was struck.
  const lose = spinSlots(state, { stake, maxBet: 10_000_000, stopsOverride: [at('C'), at('C'), at('H')], lightning: [{ reel: 0, row: 1, multiplier: 50 }] });
  assert.equal(lose.netPnl, -stake);
  // The plain table carries no lightning fields at all.
  const plain = spinSlots(state, { stake, maxBet: 10_000_000, stopsOverride: stopsFor('SEVEN', 'SEVEN', 'SEVEN') });
  assert.equal(plain.lightning, undefined);
  assert.equal(plain.netPnl, stake * 100 - stake);
  // Strikes that the rules could not have rolled are refused.
  const four = Array.from({ length: 4 }, (_, i) => ({ reel: i % 3, row: Math.floor(i / 3), multiplier: 2 }));
  for (const bad of [[], [{ reel: 3, row: 1, multiplier: 2 }], [{ reel: 0, row: 1, multiplier: 7 }], [{ reel: 0, row: 1, multiplier: 2 }, { reel: 0, row: 1, multiplier: 3 }], four]) {
    assert.throws(() => slotStrikes(bad), /INVALID_LIGHTNING/);
  }
});

test('lightning strikes: 1 to 3 distinct cells, 2× to 50×, low multipliers most common', () => {
  const allowed = [2, 3, 5, 10, 25, 50];
  assert.deepEqual(SLOT_LIGHTNING_MULTIPLIERS.map(([m]) => m), allowed);
  const seen = new Map(), counts = new Map();
  let onLine = 0;
  const n = 20_000;
  for (let i = 0; i < n; i++) {
    const strikes = rollSlotLightning();
    assert.ok(strikes.length >= 1 && strikes.length <= 3);
    assert.deepEqual(slotStrikes(strikes), strikes, 'every roll passes its own validation');
    counts.set(strikes.length, (counts.get(strikes.length) || 0) + 1);
    if (strikes.some(s => s.row === 1)) onLine++;
    for (const s of strikes) seen.set(s.multiplier, (seen.get(s.multiplier) || 0) + 1);
  }
  const ladder = allowed.map(m => seen.get(m) || 0);
  assert.ok(ladder.every(x => x > 0), String(ladder));
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] < ladder[i - 1], String(ladder));
  assert.ok(counts.get(1) > counts.get(2) && counts.get(2) > counts.get(3));
  // About half of all spins have the payline struck (exactly 1 − 0.506).
  assert.ok(Math.abs(onLine / n - 0.494) < 0.02, String(onLine / n));
});

test('lightning RTP: exact and simulated, within 2 points of the plain table and under 100%', () => {
  const plain = exactRtp({ lightning: false });
  const lit = exactRtp({ lightning: true });
  assert.ok(Math.abs(plain - 0.9182) < 0.0005, String(plain));
  assert.ok(Math.abs(lit - plain) < 0.02, `lightning ${lit} vs plain ${plain}`);
  assert.ok(lit < 1);
  // The engine itself, spun many times with a seeded generator, lands on the same number.
  let seed = 0x2545f491;
  const rand = n => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
  const spins = 400_000, stake = 1_000_000;
  let returned = 0;
  const state = defaultState();
  for (let i = 0; i < spins; i++) {
    const r = spinSlots(state, { stake, maxBet: 10_000_000, rand, lightning: true });
    // The line only: the pot is the same on both tables, fed by every spin on the floor.
    returned += stake * r.mult;
  }
  const sim = returned / (spins * stake);
  assert.ok(Math.abs(sim - lit) < 0.03, `simulated ${sim} vs exact ${lit}`);
  assert.ok(sim < 1, String(sim));
});

test('lightning never multiplies the jackpot: the 500× line and the pot pay as on the plain table', () => {
  const state = defaultState();
  const maxBet = 10_000_000, stake = 5_000_000;
  const pool = JACKPOT_SEED;
  const strikes = [{ reel: 0, row: 1, multiplier: 50 }, { reel: 1, row: 1, multiplier: 50 }, { reel: 2, row: 1, multiplier: 50 }];
  const r = spinSlots(state, { stake, maxBet, stopsOverride: stopsFor('STAR', 'STAR', 'STAR'), lightning: strikes });
  assert.equal(r.line, 'JACKPOT');
  assert.equal(r.boost, undefined);
  assert.equal(r.mult, STAR_LINE);
  const expected = Math.min(Math.floor((pool + stake * JACKPOT_RATE) / 2 / 1_000_000) * 1_000_000, stake * JACKPOT_STAKE_CAP);
  assert.equal(r.jackpot, expected);
  assert.equal(r.netPnl, stake * STAR_LINE + expected - stake);
  // A lightning spin feeds the pot like any other.
  const before = state.jackpot.floors[maxBet].pool;
  spinSlots(state, { stake, maxBet, stopsOverride: [at('C'), at('C'), at('H')], lightning: true });
  assert.equal(state.jackpot.floors[maxBet].pool, before + stake * JACKPOT_RATE);
});

test('lightning fingerprint: plain spins keep the old one, the mode is part of a lit one', () => {
  const plain = instantRequestFingerprint({ game: 'Slots', stake: 1_000_000, floor: 'gold-room', betType: 'LINE' });
  assert.equal(plain, JSON.stringify({ game: 'Slots', stake: 1_000_000, floor: 'gold-room', betType: 'LINE', target: null }));
  assert.equal(instantRequestFingerprint({ game: 'Slots', stake: 1_000_000, floor: 'gold-room', betType: 'LINE', lightning: false }), plain);
  const lit = instantRequestFingerprint({ game: 'Slots', stake: 1_000_000, floor: 'gold-room', betType: 'LINE', lightning: true });
  assert.equal(JSON.parse(lit).lightning, true);
  const state = { rounds: [] };
  const make = () => ({ ...spinSlots(defaultState(), { stake: 1_000_000, maxBet: 10_000_000, lightning: true }), userId: 'hanseo' });
  const first = idempotentInstantRound(state, { userId: 'hanseo', game: 'Slots', key: 'slot-lit-0001', fingerprint: lit, create: make });
  const again = idempotentInstantRound(state, { userId: 'hanseo', game: 'Slots', key: 'slot-lit-0001', fingerprint: lit, create: () => assert.fail('spun twice') });
  assert.equal(again.replayed, true);
  assert.deepEqual(again.round.lightning, first.round.lightning);
  assert.throws(() => idempotentInstantRound(state, { userId: 'hanseo', game: 'Slots', key: 'slot-lit-0001', fingerprint: plain, create: make }), /IDEMPOTENCY_CONFLICT/);
});

function apiHarness(available = 900_000_000) {
  let state = defaultState();
  state.users.hanseo.account.available = available;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (body, key) => handleApi({ method: 'POST', header: n => (n === 'x-idempotency-key' ? key : undefined), body: async () => body }, new URL('http://x/api/slots/spin'), store, { NODE_ENV: 'production' });
  return { call, state: () => state };
}

test('lightning slots spin through the API: strikes on the round, a retry replays them, a mode flip is refused', async () => {
  const { call, state } = apiHarness();
  const before = state().users.hanseo.account.available;
  const body = { stake: 10_000_000, floor: 'high-limit', lightning: true };
  const res = await call(body, 'slot-lit-key-01');
  assert.equal(res.status, 200);
  const r = res.data.round;
  assert.ok(r.lightning.length >= 1 && r.lightning.length <= 3);
  const boosted = r.lineMult > 0 && r.line !== 'JACKPOT';
  assert.equal(r.mult, r.lineMult * (boosted ? lightningBoost(r.lightning) : 1));
  // About 1 spin in 360 also lands three coins: those free spins pay inside the same round.
  const free = (r.freeSpins?.spins || []).reduce((x, s) => x + s.mult, 0);
  assert.equal(r.netPnl, 10_000_000 * (r.mult + free) + r.jackpot - 10_000_000);
  assert.equal(res.data.state.user.account.available, before + r.netPnl);
  assert.deepEqual(state().rounds.find(x => x.id === r.id).lightning, r.lightning);
  const replay = await call(body, 'slot-lit-key-01');
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.round.lightning, r.lightning);
  assert.equal(replay.data.round.netPnl, r.netPnl);
  assert.equal(replay.data.state.user.account.available, res.data.state.user.account.available);
  const flipped = await call({ ...body, lightning: false }, 'slot-lit-key-01');
  assert.equal(flipped.status, 409);
  // Only `true` turns it on; anything else is the plain table.
  const plain = await call({ stake: 10_000_000, floor: 'high-limit', lightning: 'yes' }, 'slot-lit-key-02');
  assert.equal(plain.status, 200);
  assert.equal(plain.data.round.lightning, undefined);
});

test('lightning slots wins still earn the hot table bonus', async () => {
  forceHotTable('slots');
  try {
    const { call, state } = apiHarness();
    for (let i = 0; i < 60; i++) {
      const before = state().users.hanseo.account.available;
      if (before < 10_000_000) break;
      const res = await call({ stake: 10_000_000, floor: 'high-limit', lightning: true }, `slot-hot-key-${String(i).padStart(3, '0')}`);
      assert.equal(res.status, 200);
      const r = res.data.round;
      const bonus = r.hotTable?.bonus || 0;
      if (r.netPnl > 0) assert.equal(bonus, Math.min(10_000_000, Math.round(r.netPnl * HOT_BONUS / 1_000_000) * 1_000_000));
      else assert.equal(bonus, 0);
      assert.equal(res.data.state.user.account.available, before + r.netPnl + bonus);
      if (r.netPnl > 0) break;
    }
  } finally { forceHotTable('off'); }
});

// ---------- 프리 스핀 ----------
// Exact chance that all three windows show a coin, and the whole return with the free spins.
function withFreeSpins(lightning) {
  let hits = 0;
  for (let a = 0; a < STOPS; a++) for (let b = 0; b < STOPS; b++) for (let c = 0; c < STOPS; c++) if (scatterReels([a, b, c]) === 3) hits++;
  const p = hits / STOPS ** 3;
  const line = exactRtp({ lightning });
  return { p, total: line * (1 + p * FREE_SPIN_MULT * FREE_SPINS / (1 - FREE_SPINS * p)) };
}

test('free spins: about 1 in 360 spins, and the whole game returns about 97% on either table', () => {
  const plain = withFreeSpins(false), lit = withFreeSpins(true);
  assert.ok(Math.abs(1 / plain.p - 360) < 1, String(1 / plain.p));
  assert.ok(Math.abs(plain.total - 0.9707) < 0.0005, String(plain.total));
  assert.ok(Math.abs(lit.total - 0.9720) < 0.0005, String(lit.total));
  assert.ok(plain.total < 1 && lit.total < 1);
});

const coinStops = () => STRIP.flatMap((s, i) => (s === 'FREE' ? [i] : []));
test('three coins in view play ten free spins at double pay inside the same round', () => {
  const state = defaultState();
  const stake = 1_000_000;
  // A coin above, on and below the payline: the scatter counts the whole window.
  const [a, b, c] = coinStops();
  const stops = [(a + 1) % STOPS, b, (c - 1 + STOPS) % STOPS];
  assert.equal(scatterReels(stops), 3);
  assert.equal(scatterReels([(a + 2) % STOPS, b, c]), 2);
  let seed = 7;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  const r = spinSlots(state, { stake, maxBet: 10_000_000, rand, stopsOverride: stops });
  assert.ok(r.freeSpins);
  assert.equal(r.freeSpins.multiplier, FREE_SPIN_MULT);
  assert.equal(r.freeSpins.spins.length, r.freeSpins.awarded);
  assert.ok(r.freeSpins.awarded >= FREE_SPINS && r.freeSpins.awarded <= FREE_SPIN_CAP);
  for (const spin of r.freeSpins.spins) {
    assert.equal(spin.mult, slotLine(spin.reels).mult * FREE_SPIN_MULT);
    assert.equal(spin.lightning, undefined);
  }
  const win = r.freeSpins.spins.reduce((x, s) => x + stake * s.mult + s.jackpot, 0);
  assert.equal(r.freeSpins.win, win);
  // r.jackpot is every pot win in the round, the base spin's and the free spins'.
  assert.equal(r.netPnl, stake * r.mult + r.jackpot + stake * r.freeSpins.spins.reduce((x, s) => x + s.mult, 0) - stake);
  // Free spins don't feed the pot: only the base spin's stake did.
  assert.equal(state.jackpot.floors[10_000_000].pool, JACKPOT_SEED + stake * JACKPOT_RATE);
  // A lightning round's free spins each roll their own strikes.
  const lit = spinSlots(defaultState(), { stake, maxBet: 10_000_000, rand, stopsOverride: stops, lightning: true });
  for (const spin of lit.freeSpins.spins) {
    assert.ok(spin.lightning.length >= 1);
    const boosted = spin.lineMult > 0 && spin.line !== 'JACKPOT';
    assert.equal(spin.mult, spin.lineMult * (boosted ? lightningBoost(spin.lightning) : 1) * FREE_SPIN_MULT);
  }
  // No coins, no free spins, no field.
  assert.equal(spinSlots(defaultState(), { stake, maxBet: 10_000_000, stopsOverride: [at('C'), at('C'), at('H')] }).freeSpins, undefined);
});

test('a retrigger adds ten more free spins, never past the cap', () => {
  // Every free spin lands on the coins: the round keeps retriggering until the cap.
  const [a, b, c] = coinStops();
  const queue = [];
  const rand = n => { if (!queue.length) queue.push(a, b, c); return queue.shift() % n; };
  const r = spinSlots(defaultState(), { stake: 1_000_000, maxBet: 10_000_000, rand, stopsOverride: [a, b, c] });
  assert.equal(r.freeSpins.awarded, FREE_SPIN_CAP);
  assert.equal(r.freeSpins.spins.length, FREE_SPIN_CAP);
  assert.equal(r.freeSpins.spins.filter(s => s.retrigger).length, FREE_SPIN_CAP / FREE_SPINS - 1);
});

test('free spins settle through the API as one round', async () => {
  const { call, state } = apiHarness();
  for (let i = 0; i < 4000; i++) {
    // Same balance every spin, so a lucky run never graduates the floor.
    state().users.hanseo.account.available = 300_000_000;
    const before = state().users.hanseo.account.available;
    const res = await call({ stake: 10_000_000, floor: 'high-limit' }, `slot-free-key-${String(i).padStart(4, '0')}`);
    assert.equal(res.status, 200);
    const r = res.data.round;
    assert.equal(res.data.state.user.account.available - before - (r.hotTable?.bonus || 0), r.netPnl);
    if (r.freeSpins) {
      assert.equal(r.netPnl, 10_000_000 * r.mult + r.jackpot + 10_000_000 * r.freeSpins.spins.reduce((x, s) => x + s.mult, 0) - 10_000_000);
      return;
    }
  }
  assert.fail('no free spins in 4000 spins');
});
