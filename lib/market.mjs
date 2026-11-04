// VEGAS 거래소: a stock-market table. One trading day (09:00 to 15:30) runs in 60 seconds of
// 240 ticks. The server draws the whole day from a secret seed when the bell rings and only ever
// shows the ticks whose time has come, so nobody can see the price ahead. The player buys (매수:
// wins when the price rises) or goes inverse (인버스: wins when it falls) at 1·2·5배 leverage at a
// moment of their choosing, and sells when they like; the close settles whatever is still held.
//
// The price is a martingale tick to tick (each step's expected ratio is 1, news jumps included),
// so no timing beats it on average; the house's cut is a fee of 1 per 100 chips traded (거래대금:
// the stake times the leverage), so 5배 pays 5 per 100 staked. Korean market
// touches: 호가 단위 (tick sizes), 상한가·하한가 at ±30% of the last close, VI (a 2-second halt
// after a 10% swing), the closing auction (동시호가) and the next day opening from today's close.
import crypto from 'node:crypto';
import { id } from './state.mjs';

export const MARKET_GAME = 'Stock Market';
export const MARKET_ENGINE = 'market-v1';
export const TICKS = 240;
export const TICK_MS = 250;
export const DAY_MS = TICKS * TICK_MS;
// The last 6 ticks are the closing auction (15:20–15:30): no orders, everything still held
// settles at the close.
export const AUCTION_TICKS = 6;
export const LIMIT = 0.3;       // 상한가·하한가: ±30% of the last close
export const VI_SWING = 0.1;    // a 10% move from the reference price halts the stock …
export const VI_TICKS = 8;      // … for 8 ticks (2 seconds)
export const FEE_PER_100 = 1;   // 수수료: 1 chip per 100 chips traded (stake × leverage)
// 레버리지 (한서 2026-11-04 "인버스 높여도 되게"): up to 50배 either way. From 10배 the position is
// closed out (반대매매) while some margin is still left, as a broker would: a jump between ticks
// at 50배 would otherwise cost the player less than the move, and the high levers would pay out
// more than they take in. The margin is the percent of the stake left at that point, set per
// stock like a broker's 종목별 증거금률: the jumpier the stock, the sooner. Each was tuned by
// simulation so no lever and no holding time pays back more than about 96 of 100.
export const LEVERAGES = [1, 2, 5, 10, 20, 50];
// A stock too jumpy for a lever has no entry for it: 네온바이오 goes up to 20배.
export const MARGINS = {
  VGE: { 1: 0, 2: 0, 5: 0, 10: 15, 20: 25, 50: 40 },
  STRM: { 1: 0, 2: 0, 5: 0, 10: 15, 20: 30, 50: 60 },
  MOON: { 1: 0, 2: 0, 5: 5, 10: 20, 20: 40, 50: 70 },
  NBIO: { 1: 0, 2: 0, 5: 10, 10: 35, 20: 55 }
};
export const marginFor = (ticker, lev) => MARGINS[ticker]?.[lev] ?? 0;
export const levOk = (ticker, lev) => LEVERAGES.includes(lev) && MARGINS[ticker]?.[lev] != null;
// The fee is 1 per 100 traded, but never more than 5 per 100 of the stake.
export const FEE_CAP_PER_100 = 5;
export const SIDES = ['LONG', 'SHORT'];
const HISTORY_DAYS = 20;

// vol: the day's spread; jumps: news a day on average; jump: the size of a news move.
export const TICKERS = [
  { id: 'VGE', name: '베가스전자', sector: '반도체', tag: '대형 우량주, 잔잔하게', base: 72_000, vol: 0.1, jumps: 0.9, jump: [0.04, 0.08] },
  { id: 'STRM', name: '스트립모터스', sector: '전기차', tag: '성장주, 실적 발표에 출렁', base: 246_000, vol: 0.16, jumps: 1.3, jump: [0.06, 0.12] },
  { id: 'MOON', name: '문라이트엔터', sector: '엔터', tag: '컴백·열애설에 춤추는 종목', base: 38_500, vol: 0.2, jumps: 1.7, jump: [0.07, 0.15] },
  { id: 'NBIO', name: '네온바이오', sector: '바이오', tag: '임상 결과 하나에 상한가·하한가', base: 18_400, vol: 0.26, jumps: 2.1, jump: [0.1, 0.22] }
];
const byTicker = Object.fromEntries(TICKERS.map(t => [t.id, t]));
export const tickerOf = id => byTicker[id] || null;

// [속보] headlines by ticker: good ones go with a jump up, bad ones with a jump down.
const NEWS = {
  VGE: {
    good: ['3분기 영업이익 사상 최대', 'AI 반도체 대규모 수주', '외국인 순매수 1위', '자사주 소각 결정'],
    bad: ['메모리 가격 하락 전망', '공장 화재로 일부 라인 중단', '외국인 대량 매도', '실적 시장 기대 밑돌아']
  },
  STRM: {
    good: ['신차 사전예약 30만 대 돌파', '미국 공장 증설 발표', '자율주행 승인 획득', '분기 흑자 전환'],
    bad: ['대규모 리콜 발표', '배터리 화재 조사 착수', 'CEO 지분 매도', '판매량 3개월 연속 감소']
  },
  MOON: {
    good: ['간판 그룹 컴백 확정', '월드투어 전석 매진', '해외 OTT와 대형 계약', '신인 데뷔곡 차트 1위'],
    bad: ['간판 멤버 열애설', '재계약 불발 소식', '앨범 판매 부진', '소속 배우 탈세 의혹']
  },
  NBIO: {
    good: ['신약 임상 3상 성공', '글로벌 제약사 기술수출', 'FDA 신속심사 지정', '희귀병 치료제 허가'],
    bad: ['임상 3상 실패', '최대주주 횡령 의혹', '유상증자 결정', '식약처 판매 중지 명령']
  }
};

// 호가 단위 (KRX tick sizes).
export function tickSize(p) {
  if (p < 2_000) return 1;
  if (p < 5_000) return 5;
  if (p < 20_000) return 10;
  if (p < 50_000) return 50;
  if (p < 200_000) return 100;
  if (p < 500_000) return 500;
  return 1_000;
}
const toTick = p => { const s = tickSize(p); return Math.max(s, Math.round(p / s) * s); };
// 상한가 rounds down to a tick, 하한가 up, as on the exchange.
export const limitsOf = prevClose => {
  const hiRaw = prevClose * (1 + LIMIT), loRaw = prevClose * (1 - LIMIT);
  return { hi: Math.floor(hiRaw / tickSize(hiRaw)) * tickSize(hiRaw), lo: Math.ceil(loRaw / tickSize(loRaw)) * tickSize(loRaw) };
};

// A stream of numbers in [0, 1) from sha256(seed, block).
function stream(seed) {
  let buf = null, at = 8, block = 0;
  return () => {
    if (at >= 8) { buf = crypto.createHash('sha256').update(`${seed}|${block++}`).digest(); at = 0; }
    const v = buf.readUInt32BE(at * 4); at++;
    return (v + 0.5) / 2 ** 32;
  };
}
const gauss = rng => Math.sqrt(-2 * Math.log(rng())) * Math.cos(2 * Math.PI * rng());

// The whole day: price per tick, the halted ticks (VI) and the news, from the seed alone.
const cache = new Map();
export function dayPath({ id: sessionId, seed, ticker, open, prevClose }) {
  const key = `${sessionId}|${seed}`;
  if (cache.has(key)) return cache.get(key);
  const t = tickerOf(ticker);
  const rng = stream(seed);
  const { hi, lo } = limitsOf(prevClose);
  const base = t.vol / Math.sqrt(TICKS);
  // Calm stretches and frantic ones: six parts of the day, each at its own pace.
  const pace = Array.from({ length: 6 }, () => [0.6, 1, 1, 1.6][Math.floor(rng() * 4)]);
  const price = new Array(TICKS), halt = new Array(TICKS).fill(false), news = [];
  let latent = open, ref = open, haltLeft = 0, frozen = 0, lastNews = -99;
  const bag = { good: [...NEWS[ticker].good], bad: [...NEWS[ticker].bad] };
  for (let i = 0; i < TICKS; i++) {
    if (i > 0) {
      const s = base * pace[Math.floor(i / (TICKS / 6))];
      latent *= Math.exp(s * gauss(rng) - (s * s) / 2);
      // News: a jump up or down, equally likely, sized so the expected ratio stays 1.
      const r1 = rng(), r2 = rng(), r3 = rng();
      if (i >= 8 && i < TICKS - AUCTION_TICKS - 4 && i - lastNews > 20 && r1 < t.jumps / TICKS) {
        const size = t.jump[0] + (t.jump[1] - t.jump[0]) * r2, up = r3 < 0.5;
        latent *= Math.exp(up ? size : -size) / Math.cosh(size);
        const list = up ? bag.good : bag.bad;
        const text = list.length ? list.splice(Math.floor(rng() * list.length), 1)[0] : (up ? '대규모 호재' : '대규모 악재');
        news.push({ i, up, text });
        lastNews = i;
      }
    }
    const shown = toTick(Math.min(hi, Math.max(lo, latent)));
    if (haltLeft > 0) { haltLeft--; halt[i] = true; price[i] = frozen; if (!haltLeft) ref = shown; continue; }
    price[i] = shown;
    // VI: a 10% swing from the reference halts trading for two seconds; the price then reopens
    // wherever it got to.
    if (i > 0 && i < TICKS - AUCTION_TICKS - VI_TICKS - 2 && Math.abs(shown / ref - 1) >= VI_SWING && shown !== hi && shown !== lo) {
      haltLeft = VI_TICKS; frozen = shown;
    }
  }
  const path = { price, halt, news, hi, lo };
  cache.set(key, path);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return path;
}

// The day's tick for a moment: 0 at the bell, TICKS-1 from the close on.
export const tickAt = (session, now = Date.now()) => Math.max(0, Math.min(TICKS - 1, Math.floor((now - session.startedAt) / TICK_MS)));
export const dayOver = (session, now = Date.now()) => now >= session.startedAt + DAY_MS;
const auction = i => i >= TICKS - AUCTION_TICKS;

// ---------- the player's book ----------
function bookOf(user) {
  const m = (user.market ||= {});
  m.days ||= {};
  return m;
}
// Read-only look at the book (polls read the state without saving it).
const peek = user => (user.market && user.market.days ? user.market : { days: {}, ...(user.market || {}) });
// Yesterday's close for a ticker, or a starting price near the ticker's base.
function lastClose(user, ticker, rng) {
  const d = bookOf(user).days[ticker];
  if (d?.close > 0) return d.close;
  return toTick(tickerOf(ticker).base * (0.9 + 0.2 * rng()));
}

// Rings the bell: a new day for `ticker`, opening a little away from yesterday's close.
export function openDay(user, ticker, now = Date.now()) {
  if (!tickerOf(ticker)) throw new Error('MARKET_TICKER_UNKNOWN');
  const m = bookOf(user);
  closeDay(user, now);
  const seed = crypto.randomBytes(16).toString('hex');
  const rng = stream(`${seed}|open`);
  const prevClose = lastClose(user, ticker, rng);
  const gap = 0.012;
  const { hi, lo } = limitsOf(prevClose);
  const open = toTick(Math.min(hi, Math.max(lo, prevClose * Math.exp(gap * gauss(rng) - gap * gap / 2))));
  // Days traded on this stock, this one included.
  const d = (m.days[ticker] ||= { closes: [] });
  d.opened = (d.opened || 0) + 1;
  m.session = { id: id('day'), ticker, seed, startedAt: now, prevClose, open, dayNo: d.opened };
  return m.session;
}

// Once the day is over its close goes in the book (the next day opens from it).
export function closeDay(user, now = Date.now()) {
  const m = bookOf(user), s = m.session;
  if (!s || s.closed || !dayOver(s, now)) return null;
  const path = dayPath(s);
  const close = path.price[TICKS - 1];
  const d = (m.days[s.ticker] ||= { closes: [] });
  d.close = close;
  d.closes = [...(d.closes || []), { open: s.open, close, hi: Math.max(...path.price), lo: Math.min(...path.price) }].slice(-HISTORY_DAYS);
  s.closed = true;
  return close;
}

export const feeOf = (stake, unit, lev = 1) => Math.max(unit, Math.round(stake * Math.min(lev * FEE_PER_100, FEE_CAP_PER_100) / 100 / unit) * unit);
const dir = side => (side === 'SHORT' ? -1 : 1);
// What a position is worth at a price, before the fee: never below 0.
const rawEquity = (pos, price) => pos.stake * (1 + pos.lev * dir(pos.side) * (price / pos.entryPrice - 1));
export const equityAt = (pos, price) => Math.max(0, rawEquity(pos, price));
export const marginOf = pos => pos.margin ?? marginFor(pos.ticker, pos.lev);
// The price at which the position is closed out: where what is left falls to its margin.
export const liquidationPrice = pos => pos.entryPrice * (1 + dir(pos.side) * (marginOf(pos) / 100 - 1) / pos.lev);
// The first tick after the entry where the position is closed out (반대매매), or null.
export function liquidationTick(pos, path) {
  const floor = pos.stake * marginOf(pos) / 100;
  for (let i = pos.entryIdx + 1; i < TICKS; i++) if (rawEquity(pos, path.price[i]) <= floor) return i;
  return null;
}
// What the player takes home at a tick, in whole units: equity less the fee.
export function payoutAt(pos, price) {
  const eq = equityAt(pos, price);
  if (eq <= 0) return 0;
  return Math.max(0, Math.floor(eq / pos.unit + 1e-9) * pos.unit - pos.fee);
}

export function openPosition(user, { stake, side, lev, unit, floor }, now = Date.now()) {
  const s = bookOf(user).session;
  if (!s || s.closed || dayOver(s, now)) throw new Error('MARKET_CLOSED');
  if (!SIDES.includes(side)) throw new Error('MARKET_BAD_SIDE');
  if (!levOk(s.ticker, lev)) throw new Error('MARKET_BAD_LEVERAGE');
  const path = dayPath(s), i = tickAt(s, now);
  if (auction(i)) throw new Error('MARKET_AUCTION');
  if (path.halt[i]) throw new Error('MARKET_HALTED');
  return {
    id: id('trade'), game: MARKET_GAME, engineVersion: MARKET_ENGINE, status: 'OPEN',
    sessionId: s.id, ticker: s.ticker, side, lev, margin: marginFor(s.ticker, lev), stake, unit, floor, fee: feeOf(stake, unit, lev),
    entryIdx: i, entryPrice: path.price[i],
    day: { id: s.id, ticker: s.ticker, seed: s.seed, startedAt: s.startedAt, prevClose: s.prevClose, open: s.open },
    createdAt: new Date(now).toISOString()
  };
}

// Where a position closes when the player sells now: now, or earlier if it was wiped out, or
// the close when the day is over. A sale in a VI halt or the closing auction waits (refused).
export function exitFor(pos, { force = false } = {}, now = Date.now()) {
  // The position keeps its own copy of its day, so it settles the same whatever came after.
  const day = pos.day;
  if (!day) throw new Error('MARKET_DAY_LOST');
  const path = dayPath(day);
  const liq = liquidationTick(pos, path);
  const over = dayOver(day, now);
  let i = over ? TICKS - 1 : tickAt(day, now);
  let reason = over ? 'CLOSE' : 'SELL';
  if (liq !== null && liq <= i) { i = liq; reason = 'LIQUIDATED'; }
  if (!force && reason === 'SELL') {
    if (auction(i)) throw new Error('MARKET_AUCTION');
    if (path.halt[i]) throw new Error('MARKET_HALTED');
  }
  if (reason === 'SELL' && i <= pos.entryIdx) i = pos.entryIdx;
  const price = path.price[i];
  return { i, price, reason, value: reason === 'LIQUIDATED' ? 0 : payoutAt(pos, price) };
}
// Whether a position must settle now without being asked: wiped out, or the day closed.
export function autoExit(pos, now = Date.now()) {
  try {
    const e = exitFor(pos, { force: true }, now);
    return e.reason === 'SELL' ? null : e;
  } catch { return null; }
}

// ---------- what the screen sees ----------
export function sessionPublic(user, now = Date.now()) {
  const m = peek(user), s = m.session;
  const tickers = TICKERS.map(t => ({ id: t.id, name: t.name, sector: t.sector, tag: t.tag, margins: MARGINS[t.id] || {}, close: m.days[t.id]?.close ?? null, closes: (m.days[t.id]?.closes || []).map(d => d.close) }));
  if (!s) return { session: null, tickers };
  const { hi, lo } = dayPath(s);
  return {
    tickers,
    session: {
      id: s.id, ticker: s.ticker, dayNo: s.dayNo, prevClose: s.prevClose, open: s.open, hi, lo,
      ticks: TICKS, tickMs: TICK_MS, auction: AUCTION_TICKS,
      elapsed: Math.max(0, now - s.startedAt), over: dayOver(s, now)
    }
  };
}
// Ticks from `since` up to now (never one ahead of the clock), with any news among them.
export function ticksSince(user, since = 0, now = Date.now()) {
  const s = peek(user).session;
  if (!s) return { id: null, upTo: -1, price: [], halt: [], news: [] };
  const path = dayPath(s);
  const upTo = dayOver(s, now) ? TICKS - 1 : tickAt(s, now);
  const from = Math.max(0, Math.min(Number(since) || 0, upTo + 1));
  return {
    id: s.id, from, upTo, over: dayOver(s, now),
    price: path.price.slice(from, upTo + 1),
    halt: path.halt.slice(from, upTo + 1).map(Boolean),
    news: path.news.filter(n => n.i >= from && n.i <= upTo)
  };
}
export function positionPublic(pos) {
  if (!pos) return null;
  return { id: pos.id, sessionId: pos.sessionId, ticker: pos.ticker, side: pos.side, lev: pos.lev, margin: marginOf(pos), liqPrice: marginOf(pos) ? Math.round(liquidationPrice(pos)) : null, stake: pos.stake, fee: pos.fee, unit: pos.unit, entryIdx: pos.entryIdx, entryPrice: pos.entryPrice, status: pos.status, exit: pos.exit || null, netPnl: pos.status === 'SETTLED' ? pos.netPnl : null };
}
