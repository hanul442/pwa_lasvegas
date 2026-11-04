// 하이로우 and VEGAS 거래소 (2026-11-04, 한서 "하이 로우 & 게임 기획 · 주식 시장 느낌 게임").
// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { defaultState } from '../lib/state.mjs';
import { handleApi } from '../lib/api.mjs';
import { HILO_GAME, HILO_EDGE, startHilo, hiloMove, hiloPublic, callChance, callFactor, callsFor, rankOf } from '../lib/hilo.mjs';
import { MARKET_GAME, TICKERS, TICKS, TICK_MS, DAY_MS, AUCTION_TICKS, dayPath, payoutAt, liquidationTick, feeOf, limitsOf, tickSize, marginFor, liquidationPrice, levOk } from '../lib/market.mjs';
import { RP_CAPPED_GAMES } from '../lib/rank-points.mjs';

function api(initial) {
  let state = initial;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, key) => handleApi({ method, header: n => (n === 'x-idempotency-key' ? key : undefined), body: async () => body }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  return { call, get state() { return state; } };
}
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- 하이로우 ----------
test('하이로우: each call pays its honest odds on the cards left, less the cut', () => {
  const r = startHilo({ stake: 10_000, unit: 100, floor: 'x' }, mulberry(7));
  const rank = rankOf(r.card);
  for (const call of ['HIGH', 'LOW']) {
    const p = callChance(r.deck, rank, call);
    const wins = r.deck.filter(c => callsFor(rank)[call].test(rankOf(c))).length;
    assert.equal(p, wins / r.deck.length);
    if (p > 0) assert.ok(Math.abs(callFactor(p) * p - (1 - HILO_EDGE)) < 1e-12);
  }
  // 54 cards with two jokers; the open card is never a joker.
  assert.equal(r.deck.length + r.trail.length, 54);
  assert.notEqual(rankOf(r.card), 0);
  // A tie and a joker lose both calls; nothing is lower than A or higher than K.
  for (const call of ['HIGH', 'LOW']) {
    assert.equal(callsFor(7)[call].test(7), false, 'a tie loses');
    assert.equal(callsFor(7)[call].test(rankOf('JKR')), false, 'a joker loses');
  }
  assert.equal(callChance(['2♠', '3♠', 'JKB'], 1, 'LOW'), 0);
  assert.equal(callChance(['2♠', 'K♥', 'JKB'], 13, 'HIGH'), 0);
});

test('하이로우: a joker or the same rank on a call forfeits; a joker on 넘기기 is burned', () => {
  const r = startHilo({ stake: 10_000, unit: 100, floor: 'x' }, mulberry(3));
  r.card = '7♠'; r.deck = ['JKR', '7♥', '9♣', '2♦', '5♠'];
  let ev = hiloMove(r, 'SKIP');
  assert.deepEqual([ev.card, ev.burned], ['7♥', ['JKR']]);
  const same = structuredClone(r);
  ev = hiloMove(same, 'HIGH'); // 9♣: a win
  assert.equal(ev.type, 'hit');
  const r2 = structuredClone(r); r2.deck = ['7♦', '9♣'];
  ev = hiloMove(r2, 'HIGH');
  assert.equal(ev.type, 'miss'); assert.equal(ev.why, 'SAME'); assert.equal(r2.result.value, 0);
  const r3 = structuredClone(r); r3.deck = ['JKB', '9♣'];
  ev = hiloMove(r3, 'HIGH');
  assert.equal(ev.why, 'JOKER'); assert.equal(r3.status, 'READY_TO_SETTLE');
});

test('하이로우: the prize shown and paid is whole chips, and the deck order stays secret', () => {
  for (let seed = 1; seed < 200; seed++) {
    const rng = mulberry(seed);
    const r = startHilo({ stake: 10_000, unit: 100, floor: 'x' }, rng);
    while (r.status === 'PLAYING') {
      const v = hiloPublic(r);
      assert.equal(v.deck, undefined);
      for (const o of Object.values(v.options)) assert.ok(Number.isInteger(o.pays / 100) && Number.isInteger(o.chance));
      assert.ok(Number.isInteger(v.value / 100));
      if (r.wins >= 3 && rng() < 0.4) { hiloMove(r, 'CASH'); break; }
      const open = Object.entries(v.options).filter(([, o]) => o.open);
      if (!open.length) { hiloMove(r, r.skips ? 'SKIP' : 'CASH'); continue; }
      hiloMove(r, open.sort((a, b) => b[1].chance - a[1].chance)[0][0]);
    }
    assert.ok(Number.isInteger(r.result.value / 100));
  }
});

test('하이로우: on average a call keeps 97 of every 100 chips', () => {
  const rng = mulberry(42);
  let paid = 0, n = 20_000;
  for (let k = 0; k < n; k++) {
    const r = startHilo({ stake: 1_000_000, unit: 1, floor: 'x' }, rng);
    const open = Object.entries(hiloPublic(r).options).filter(([, o]) => o.open).map(([k]) => k);
    hiloMove(r, open[Math.floor(rng() * open.length)]);
    if (r.status === 'PLAYING') hiloMove(r, 'CASH');
    paid += r.result.value;
  }
  const rtp = paid / (n * 1_000_000);
  assert.ok(rtp > 0.95 && rtp < 0.99, `rtp ${rtp}`);
});

test('하이로우 through the API: lock, call, take the prize once', async () => {
  const s = defaultState();
  s.users.hanseo.account.available = 300_000_000;
  const h = api(s), { call } = h;
  const start = await call('POST', '/api/hilo/start', { stake: 10_000_000, floor: 'high-limit' }, 'hilo-key-0001');
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const round = start.data.round;
  assert.equal(round.deck, undefined);
  assert.equal(start.data.state.user.account.locked, 10_000_000);
  const again = await call('POST', '/api/hilo/start', { stake: 10_000_000, floor: 'high-limit' }, 'hilo-key-0001');
  assert.equal(again.data.round.id, round.id, 'a retried start is the same round');
  assert.equal((await call('POST', '/api/hilo/start', { stake: 10_000_000, floor: 'high-limit' }, 'hilo-key-0002')).data.error, 'OPEN_HILO_ROUND');
  const open = await call('GET', '/api/hilo/open');
  assert.equal(open.data.round.id, round.id);

  let v = round;
  while (v.status === 'PLAYING') {
    const best = Object.entries(v.options).filter(([, o]) => o.open).sort((a, b) => b[1].chance - a[1].chance)[0];
    const move = v.wins >= 2 ? 'CASH' : best ? best[0] : 'SKIP';
    const res = await call('POST', '/api/hilo/move', { roundId: v.id, move, seq: v.seq });
    // A second tap on the same step changes nothing.
    const dup = await call('POST', '/api/hilo/move', { roundId: v.id, move, seq: v.seq });
    assert.equal(dup.data.replayed, true, JSON.stringify(dup.data).slice(0, 300));
    v = res.data.round;
  }
  const user = h.state.users.hanseo;
  assert.equal(user.account.locked, 0);
  assert.equal(user.account.available, 300_000_000 - 10_000_000 + (v.result.value));
  assert.equal(user.stats[HILO_GAME].rounds, 1);
  assert.ok(RP_CAPPED_GAMES.has(HILO_GAME) && RP_CAPPED_GAMES.has(MARKET_GAME));
});

// ---------- VEGAS 거래소 ----------
const day = (ticker, seed, prevClose = tickerOf(ticker).base) => ({ id: `d-${seed}`, seed: String(seed), ticker, open: prevClose, prevClose, startedAt: 0 });
const tickerOf = id => TICKERS.find(t => t.id === id);

test('거래소: prices sit on the exchange tick grid within 상한가·하한가', () => {
  for (const t of TICKERS) for (let k = 0; k < 40; k++) {
    const p = dayPath(day(t.id, `${t.id}-${k}`));
    const { hi, lo } = limitsOf(t.base);
    assert.equal(p.price.length, TICKS);
    for (const x of p.price) {
      assert.ok(Number.isInteger(x) && x <= hi && x >= lo, `${t.id} ${x}`);
      assert.equal(x % tickSize(x), 0);
    }
    // A halt (VI) freezes the price.
    p.halt.forEach((h, i) => { if (h) assert.equal(p.price[i], p.price[i - 1]); });
  }
});

test('거래소: no moment to buy or sell beats the fee on average', () => {
  for (const t of TICKERS) {
    let back = 0, n = 0;
    for (let k = 0; k < 3000; k++) {
      const path = dayPath(day(t.id, crypto.randomBytes(6).toString('hex')));
      for (const side of ['LONG', 'SHORT']) for (const lev of [1, 5, 10, 20, 50].filter(l => levOk(t.id, l))) {
        const entryIdx = k % 200, pos = { side, lev, margin: marginFor(t.id, lev), stake: 10_000, unit: 100, fee: feeOf(10_000, 100, lev), entryIdx, entryPrice: path.price[entryIdx] };
        const exit = Math.min(TICKS - 1, entryIdx + 5 + (k * 7) % 60), liq = liquidationTick(pos, path);
        back += liq !== null && liq <= exit ? 0 : payoutAt(pos, path.price[exit]); n += 10_000;
      }
    }
    assert.ok(back / n > 0.85 && back / n < 0.99, `${t.id} ${back / n}`);
  }
  assert.equal(feeOf(10_000, 100), 100, '1 per 100 traded');
  assert.equal(feeOf(10_000, 100, 5), 500, '5배 trades five times the stake');
  assert.equal(feeOf(1_000, 100), 100, 'the fee is at least one chip');
  assert.equal(feeOf(10_000, 100, 50), 500, 'never more than 5 per 100 of the stake');
  // 반대매매 at 10배 with 30% left: a 7% move against.
  const p10 = { side: 'SHORT', lev: 10, margin: 30, stake: 10_000, entryPrice: 10_000 };
  assert.equal(Math.round(liquidationPrice(p10)), 10_700);
});

test('거래소 through the API: future ticks stay hidden, trades settle in whole chips', async () => {
  const realNow = Date.now;
  let clock = 1_800_000_000_000;
  Date.now = () => clock;
  try {
    const s = defaultState();
    s.users.hanseo.account.available = 300_000_000;
    const h = api(s), { call } = h;
    const bell = await call('POST', '/api/market/bell', { ticker: 'NBIO' });
    assert.equal(bell.status, 200, JSON.stringify(bell.data));
    assert.equal(bell.data.session.ticker, 'NBIO');
    assert.equal(bell.data.session.seed, undefined);
    assert.equal(JSON.stringify(bell.data).includes(h.state.users.hanseo.market.session.seed), false, 'the seed never leaves the server');

    clock += 10 * TICK_MS;
    let ticks = await call('GET', '/api/market/ticks?since=0');
    assert.equal(ticks.data.ticks.upTo, 10);
    assert.equal(ticks.data.ticks.price.length, 11, 'only the ticks whose time has come');

    const buy = await call('POST', '/api/market/buy', { stake: 10_000_000, floor: 'high-limit', side: 'LONG', lev: 2, sessionId: bell.data.session.id }, 'market-0001');
    if (buy.status === 200) {
      const pos = buy.data.position;
      assert.equal(pos.entryIdx, 10);
      assert.equal(pos.day, undefined);
      assert.equal(h.state.users.hanseo.account.locked, 10_000_000);
      assert.equal((await call('POST', '/api/market/buy', { stake: 10_000_000, floor: 'high-limit', side: 'SHORT', lev: 1 }, 'market-0002')).data.error, 'MARKET_POSITION_OPEN');
      assert.equal((await call('POST', '/api/market/bell', { ticker: 'VGE' })).data.error, 'MARKET_POSITION_OPEN');
      // Past the close: the next poll settles it at the close (or where it was wiped out).
      clock += DAY_MS;
      ticks = await call('GET', '/api/market/ticks?since=11');
      assert.ok(ticks.data.settled, 'settled at the bell');
      assert.ok(['CLOSE', 'LIQUIDATED'].includes(ticks.data.settled.exit.reason));
      const u = h.state.users.hanseo;
      assert.equal(u.account.locked, 0);
      assert.equal(Math.abs(u.account.available - 300_000_000) % 1_000_000, 0, 'whole chips');
      assert.equal(u.stats[MARKET_GAME].rounds, 1);
      // The next day opens from today's close.
      const next = await call('POST', '/api/market/bell', { ticker: 'NBIO' });
      assert.equal(next.data.session.prevClose, h.state.users.hanseo.market.days.NBIO.close);
    }

    // Selling straight away loses about the fee.
    clock += 20 * TICK_MS;
    const sid = h.state.users.hanseo.market.session.id;
    const path = dayPath(h.state.users.hanseo.market.session);
    let i = 20; while (path.halt[i]) { clock += TICK_MS; i++; }
    const b2 = await call('POST', '/api/market/buy', { stake: 10_000_000, floor: 'high-limit', side: 'SHORT', lev: 1, sessionId: sid }, 'market-0003');
    assert.equal(b2.status, 200, JSON.stringify(b2.data));
    const sold = await call('POST', '/api/market/sell', { roundId: b2.data.position.id });
    assert.equal(sold.data.sold.exit.reason, 'SELL');
    assert.equal(sold.data.sold.netPnl, -1_000_000, 'the fee: 1 per 100 chips traded, at least one 100만');
  } finally { Date.now = realNow; }
});

test('거래소: no orders in the closing auction', async () => {
  const realNow = Date.now;
  let clock = 1_800_000_000_000;
  Date.now = () => clock;
  try {
    const s = defaultState();
    s.users.hanseo.account.available = 300_000_000;
    const { call } = api(s);
    const bell = await call('POST', '/api/market/bell', { ticker: 'VGE' });
    clock += (TICKS - AUCTION_TICKS + 1) * TICK_MS;
    assert.equal((await call('POST', '/api/market/buy', { stake: 10_000_000, floor: 'high-limit', side: 'LONG', lev: 1, sessionId: bell.data.session.id })).data.error, 'MARKET_AUCTION');
  } finally { Date.now = realNow; }
});
