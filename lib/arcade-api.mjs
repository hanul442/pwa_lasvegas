// API for 하이로우 (/api/hilo/*) and VEGAS 거래소 (/api/market/*). Both hold the stake locked on
// the server while the round is open and settle it once, like the other games with a session.
import { FLOORS, tableUnitOf } from './constants.mjs';
import { lockBet, settleLockedHouseGame } from './economy.mjs';
import { normalizeIdempotencyKey } from './instant-idempotency.mjs';
import { HILO_GAME, startHilo, hiloMove, hiloPublic, hiloNet } from './hilo.mjs';
import { MARKET_GAME, openDay, closeDay, openPosition, exitFor, autoExit, sessionPublic, ticksSince, positionPublic, dayOver, LEVERAGES } from './market.mjs';

const ok = data => ({ status: 200, data });
const openOf = (state, userId, game) => state.rounds.find(r => r.userId === userId && r.game === game && r.status !== 'SETTLED') || null;
const floorBySlug = slug => FLOORS.find(f => f.slug === slug) || null;
// A table's unit (one chip) on the round's floor: prizes and fees are whole units.
const unitFor = slug => tableUnitOf(floorBySlug(slug) || FLOORS[0]);

// ---------- 하이로우 ----------
function settleHilo(state, user, round) {
  const net = hiloNet(round);
  settleLockedHouseGame(state, user, { game: HILO_GAME, stake: round.stake, netPnl: net, roundId: round.id, details: { wins: round.wins, result: round.result?.kind } });
  round.status = 'SETTLED';
  round.netPnl = net;
  round.settledAt = new Date().toISOString();
  delete round.deck; // nothing left to draw
}

async function handleHilo(req, url, { mutate, loadState, getUser, summarize, validateStake }) {
  const verb = url.pathname.slice('/api/hilo/'.length);
  if (verb === 'open' && req.method === 'GET') {
    const state = await loadState();
    const user = getUser(state, req);
    const round = openOf(state, user.id, HILO_GAME);
    return ok({ round: hiloPublic(round), floor: round?.floor ?? null, state: summarize(state, user) });
  }
  if (req.method !== 'POST') return null;
  const body = await req.body();
  const key = normalizeIdempotencyKey(req.header('x-idempotency-key'));
  if (verb === 'start') {
    return ok(await mutate(state => {
      const user = getUser(state, req);
      const stake = Number(body.stake), floor = body.floor || FLOORS[0].slug;
      // The same start sent again after a dropped connection gets the round it made.
      if (key) {
        const again = state.rounds.findLast(r => r.userId === user.id && r.game === HILO_GAME && r.startKey === key);
        if (again) return { round: hiloPublic(again), replayed: true, state: summarize(state, user) };
      }
      validateStake(user, floor, stake);
      if (openOf(state, user.id, HILO_GAME)) throw new Error('OPEN_HILO_ROUND');
      const round = startHilo({ stake, unit: unitFor(floor), floor });
      round.userId = user.id;
      if (key) round.startKey = key;
      lockBet(state, user, { stake, game: HILO_GAME, roundId: round.id, metadata: { engineVersion: round.engineVersion } });
      state.rounds.push(round);
      return { round: hiloPublic(round), replayed: false, state: summarize(state, user) };
    }));
  }
  if (verb === 'move') {
    return ok(await mutate(state => {
      const user = getUser(state, req);
      const round = state.rounds.find(r => r.id === body.roundId && r.userId === user.id && r.game === HILO_GAME);
      if (!round) throw new Error('ROUND_NOT_FOUND');
      // A move for a step already played (a retry, a second tap) just gets the table as it is.
      if (Number(body.seq) !== round.seq || round.status === 'SETTLED') return { round: hiloPublic(round), event: null, replayed: true, state: summarize(state, user) };
      const event = hiloMove(round, String(body.move || ''));
      if (round.status === 'READY_TO_SETTLE') settleHilo(state, user, round);
      return { round: hiloPublic(round), event, replayed: false, state: summarize(state, user) };
    }));
  }
  return null;
}

// ---------- VEGAS 거래소 ----------
function settleTrade(state, user, pos, exit) {
  const net = exit.value - pos.stake;
  settleLockedHouseGame(state, user, { game: MARKET_GAME, stake: pos.stake, netPnl: net, roundId: pos.id, details: { ticker: pos.ticker, side: pos.side, lev: pos.lev, entry: pos.entryPrice, exit: exit.price, reason: exit.reason } });
  pos.status = 'SETTLED';
  pos.netPnl = net;
  pos.exit = { i: exit.i, price: exit.price, reason: exit.reason, value: exit.value };
  pos.settledAt = new Date().toISOString();
  delete pos.day.seed; // the day is over for this trade; its future stays private either way
}
// A trade wiped out or carried to the close settles on the next visit, asked or not.
function settleDue(state, user, now = Date.now()) {
  const pos = openOf(state, user.id, MARKET_GAME);
  if (!pos) return null;
  const exit = autoExit(pos, now);
  if (!exit) return null;
  settleTrade(state, user, pos, exit);
  return pos;
}
function marketView(state, user, now = Date.now()) {
  const pos = openOf(state, user.id, MARKET_GAME);
  const last = pos ? null : state.rounds.findLast(r => r.userId === user.id && r.game === MARKET_GAME && r.status === 'SETTLED');
  return { ...sessionPublic(user, now), position: positionPublic(pos), last: positionPublic(last), serverNow: now };
}
const needsSettling = (state, user, now) => { const pos = openOf(state, user.id, MARKET_GAME); return Boolean(pos && autoExit(pos, now)); };

async function handleMarket(req, url, { mutate, loadState, getUser, summarize, validateStake }) {
  const verb = url.pathname.slice('/api/market/'.length);
  if (verb === 'ticks' && req.method === 'GET') {
    // The poll: read only, unless a trade has to settle (wiped out, or the bell rang).
    const now = Date.now();
    let state = await loadState(), user = getUser(state, req), settled = null;
    if (needsSettling(state, user, now)) {
      settled = await mutate(s => { const u = getUser(s, req); const pos = settleDue(s, u, now); return pos ? positionPublic(pos) : null; });
      state = await loadState(); user = getUser(state, req);
    }
    const ticks = ticksSince(user, Number(url.searchParams.get('since')) || 0, now);
    const pos = openOf(state, user.id, MARKET_GAME);
    return ok({ ticks, position: positionPublic(pos), settled, serverNow: now, ...(settled ? { state: summarize(state, user) } : {}) });
  }
  if (verb === 'open' && req.method === 'GET') {
    const now = Date.now();
    let state = await loadState(), user = getUser(state, req);
    if (needsSettling(state, user, now) || (user.market?.session && !user.market.session.closed && dayOver(user.market.session, now))) {
      await mutate(s => { const u = getUser(s, req); settleDue(s, u, now); closeDay(u, now); return null; });
      state = await loadState(); user = getUser(state, req);
    }
    const pos = openOf(state, user.id, MARKET_GAME);
    return ok({ ...marketView(state, user, now), floor: pos?.floor ?? null, state: summarize(state, user) });
  }
  if (req.method !== 'POST') return null;
  const body = await req.body();
  const key = normalizeIdempotencyKey(req.header('x-idempotency-key'));
  if (verb === 'bell') {
    // A new trading day for a ticker. Not while a trade is open on a day still running.
    return ok(await mutate(state => {
      const now = Date.now();
      const user = getUser(state, req);
      settleDue(state, user, now);
      const s = user.market?.session;
      if (s && !dayOver(s, now) && s.ticker === body.ticker && !body.fresh) return { ...marketView(state, user, now), state: summarize(state, user) };
      if (openOf(state, user.id, MARKET_GAME)) throw new Error('MARKET_POSITION_OPEN');
      openDay(user, String(body.ticker || ''), now);
      return { ...marketView(state, user, now), state: summarize(state, user) };
    }));
  }
  if (verb === 'buy') {
    return ok(await mutate(state => {
      const now = Date.now();
      const user = getUser(state, req);
      if (key) {
        const again = state.rounds.findLast(r => r.userId === user.id && r.game === MARKET_GAME && r.startKey === key);
        if (again) return { ...marketView(state, user, now), position: positionPublic(again), replayed: true, state: summarize(state, user) };
      }
      settleDue(state, user, now);
      const stake = Number(body.stake), floor = body.floor || FLOORS[0].slug, lev = Number(body.lev), side = String(body.side || '');
      if (!LEVERAGES.includes(lev)) throw new Error('MARKET_BAD_LEVERAGE');
      validateStake(user, floor, stake);
      if (openOf(state, user.id, MARKET_GAME)) throw new Error('MARKET_POSITION_OPEN');
      if (body.sessionId && user.market?.session?.id !== body.sessionId) throw new Error('MARKET_CLOSED');
      const pos = openPosition(user, { stake, side, lev, unit: unitFor(floor), floor }, now);
      pos.userId = user.id;
      if (key) pos.startKey = key;
      lockBet(state, user, { stake, game: MARKET_GAME, roundId: pos.id, metadata: { engineVersion: pos.engineVersion, ticker: pos.ticker, side, lev } });
      state.rounds.push(pos);
      return { ...marketView(state, user, now), replayed: false, state: summarize(state, user) };
    }));
  }
  if (verb === 'sell') {
    return ok(await mutate(state => {
      const now = Date.now();
      const user = getUser(state, req);
      const pos = state.rounds.find(r => r.id === body.roundId && r.userId === user.id && r.game === MARKET_GAME);
      if (!pos) throw new Error('ROUND_NOT_FOUND');
      // Sold already (a retry, or the close beat the tap): the result as it stands.
      if (pos.status !== 'SETTLED') settleTrade(state, user, pos, exitFor(pos, {}, now));
      return { ...marketView(state, user, now), sold: positionPublic(pos), state: summarize(state, user) };
    }));
  }
  return null;
}

// Returns a response for /api/hilo/* and /api/market/*, or null for any other path.
export async function handleArcade(req, url, deps) {
  if (url.pathname.startsWith('/api/hilo/')) return handleHilo(req, url, deps);
  if (url.pathname.startsWith('/api/market/')) return handleMarket(req, url, deps);
  return null;
}
