// VEGAS 거래소: a trading day in 60 seconds. The server draws the day and hands over each tick
// only once its time has come (lib/market.mjs); this screen plays the ticks back a moment behind
// the server's clock so the chart moves smoothly, and dresses the day as a Korean exchange:
// 빨강 상승·파랑 하락, candles and volume, a 호가창, a ticker tape, [속보], 상한가·하한가, VI and the
// closing auction. Buying (매수) wins when the price rises, 인버스 when it falls, at 1·2·5배.
import { api, errorMessage } from '../api.js';
import { sound, haptic, el, formatUnit, reducedMotion, audioContext, isMuted, chipValueFor } from '../fx.js';
import { Table } from '../table.js';
import { gameName } from '../names.js';

const LAG = 380;       // the screen plays the day this far behind the server
const POLL = 320;
const PER_CANDLE = 10; // ticks per candle (about 16 minutes of the day)
const LEVS = [1, 2, 5];
const PREF = 'vegas:stocks';
const readPref = () => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } };
const savePref = p => { try { localStorage.setItem(PREF, JSON.stringify({ ...readPref(), ...p })); } catch {} };

const won = n => Math.round(n).toLocaleString('ko-KR');
const pct = (a, b) => Math.round((a / b - 1) * 100);
const signed = n => (n > 0 ? `+${n}` : `${n}`);
const arrow = d => (d > 0 ? '▲' : d < 0 ? '▼' : '');
const tone = d => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');
// 09:00 at the bell, 15:30 at the close.
const clockAt = (i, ticks) => { const m = 540 + Math.round(i * 390 / (ticks - 1)); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const tickSize = p => (p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000);

// The tape: the four tables' stocks and a few more names that just scroll by.
const EXTRA = [['VEGAS 지수', 2614], ['라스반도체', 41200], ['네바다에너지', 12850], ['카지노항공', 8930], ['스트립건설', 23400], ['블랙잭게임즈', 56700], ['럭키세븐금융', 9120], ['네온화학', 104500]];
// 종토방: what the crowd types as the day goes.
const TALK = {
  up: ['가즈아!!', '오늘 뭔가 된다', '익절 각 나왔다', '어제 판 사람 울고 있냐', '이 가격이면 아직 싸다', '불기둥 보소'],
  down: ['물렸다…', '존버는 승리한다', '손절 할까 말까', '이거 바닥 아님?', '왜 내가 사면 떨어짐', '물타기 들어갑니다'],
  flat: ['횡보 지겹다', '거래량 터지면 간다', '눈치 싸움 중', '세력 들어온 듯?', '점심 먹고 오자'],
  limitUp: ['상한가 굳히기 들어간다', '점상 가나요?', '내일 갭 뜬다'],
  limitDown: ['하한가… 할 말 잃음', '반등은 언제…'],
  vi: ['VI 걸렸다 ㄷㄷ', '단일가 들어갔네'],
  newsUp: ['속보 떴다!! 가즈아', '이거 진짜임?', '뉴스 보고 들어간다'],
  newsDown: ['악재 떴다 탈출!!', '이건 좀 크다…', '뉴스에 팔라 했잖아']
};
const NICKS = ['개미왕', '존버장인', '단타의신', '야수의심장', '물타기달인', '상따전문', '눈팅족', '익절요정', '세력추적자', '퇴근길투자'];
const pick = list => list[Math.floor(Math.random() * list.length)];

// The opening and closing bell: two struck partials.
function bell(times = 2) {
  if (isMuted()) return;
  const ac = audioContext(); if (!ac) return;
  for (let k = 0; k < times; k++) {
    const at = ac.currentTime + k * 0.42;
    for (const [f, g] of [[880, 0.22], [1320, 0.08], [2210, 0.04]]) {
      const o = ac.createOscillator(), v = ac.createGain();
      o.frequency.value = f; v.gain.setValueAtTime(0, at); v.gain.linearRampToValueAtTime(g, at + 0.005); v.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      o.connect(v).connect(ac.destination); o.start(at); o.stop(at + 1.2);
    }
  }
}

export async function mountStocks(ctx) {
  const t = new Table({ ...ctx, game: 'stocks', title: gameName('stocks'), feltClass: 'felt--market', skin: false });
  const pref = readPref();
  let side = pref.side === 'SHORT' ? 'SHORT' : 'LONG';
  let lev = LEVS.includes(pref.lev) ? pref.lev : 1;
  t.body.innerHTML = `
    <div class="mk" data-phase="idle">
      <div class="mk-tape" aria-hidden="true"><div class="mk-tape-run" data-tape></div></div>
      <header class="mk-head">
        <button type="button" class="mk-pick" data-pick aria-haspopup="dialog"><strong data-name>종목 고르기</strong><small data-sector></small><i aria-hidden="true">▾</i></button>
        <div class="mk-quote"><strong class="mk-price" data-price>—</strong><span class="mk-chg" data-chg></span></div>
        <div class="mk-clock"><b data-clock>09:00</b><small data-state>장 시작 전</small></div>
      </header>
      <div class="mk-chart" data-chartbox>
        <canvas class="mk-canvas" aria-hidden="true"></canvas>
        <div class="mk-news" data-news aria-live="polite"></div>
        <div class="mk-stamp" data-stamp aria-hidden="true"></div>
        <div class="mk-board" data-board hidden></div>
      </div>
      <div class="mk-mid">
        <ol class="mk-book" data-book aria-label="호가창"></ol>
        <ul class="mk-talk" data-talk aria-label="종목 토론방" aria-live="off"></ul>
      </div>
      <div class="mk-pos" data-pos hidden></div>
      <div class="mk-order" data-order>
        <div class="mk-seg mk-side" role="group" aria-label="방향">
          <button type="button" data-side="LONG" aria-pressed="false"><i aria-hidden="true">▲</i>매수<small>오르면 수익</small></button>
          <button type="button" data-side="SHORT" aria-pressed="false"><i aria-hidden="true">▼</i>인버스<small>내리면 수익</small></button>
        </div>
        <div class="mk-seg mk-lev" role="group" aria-label="레버리지">${LEVS.map(n => `<button type="button" data-lev="${n}" aria-pressed="false">${n}배</button>`).join('')}</div>
        <button type="button" class="zone mk-zone" data-zone="ORDER"><strong>주문</strong><small data-fee>수수료 거래대금의 1%</small></button>
      </div>
    </div>`;
  const root = t.body.querySelector('.mk');
  const $ = s => root.querySelector(s);
  const canvas = $('canvas'), g = canvas.getContext('2d');
  const chartBox = $('[data-chartbox]');
  const priceEl = $('[data-price]'), chgEl = $('[data-chg]'), clockEl = $('[data-clock]'), stateEl = $('[data-state]');
  const nameEl = $('[data-name]'), sectorEl = $('[data-sector]');
  const newsEl = $('[data-news]'), stampEl = $('[data-stamp]'), boardEl = $('[data-board]');
  const bookEl = $('[data-book]'), talkEl = $('[data-talk]'), posEl = $('[data-pos]'), tapeEl = $('[data-tape]');
  const sideBtns = [...root.querySelectorAll('[data-side]')], levBtns = [...root.querySelectorAll('[data-lev]')];
  t.addZone($('[data-zone="ORDER"]'));

  // ---------- the day as this screen knows it ----------
  let tickers = [], session = null, position = null, last = null;
  let prices = [], halts = [], volumes = [], newsAt = new Map();
  let have = 0;            // ticks received
  let startLocal = 0;      // performance.now() at the bell, by the server's clock
  let shownIdx = -1;       // the tick on screen
  let alive = true, polling = false, raf = 0, pollTimer = 0;
  let selling = false, ending = false;
  let lastStamp = '';

  const tickerById = id => tickers.find(x => x.id === id);
  const elapsedIdx = () => Math.floor((performance.now() - startLocal - LAG) / (session?.tickMs || 250));
  const nowIdx = () => Math.min(have - 1, session ? Math.min(session.ticks - 1, elapsedIdx()) : -1);
  const auctionAt = i => session && i >= session.ticks - session.auction;

  // ---------- tape ----------
  function paintTape() {
    const items = [
      ...tickers.map(x => {
        const live = session?.ticker === x.id && shownIdx >= 0 ? prices[shownIdx] : x.close;
        const base = session?.ticker === x.id ? session.prevClose : x.closes.at(-2) ?? x.close;
        const d = live && base ? live - base : 0;
        return live ? `<span class="mk-t mk-t--${tone(d)}"><b>${x.name}</b>${won(live)} ${arrow(d)}${d ? won(Math.abs(d)) : ''}</span>` : '';
      }),
      ...EXTRA.map(([n, p]) => { const d = Math.round((Math.random() - 0.48) * p * 0.02 / tickSize(p)) * tickSize(p); return `<span class="mk-t mk-t--${tone(d)}"><b>${n}</b>${won(p + d)} ${arrow(d)}${d ? won(Math.abs(d)) : ''}</span>`; })
    ].join('');
    tapeEl.innerHTML = items + items; // twice, so the scroll loops without a gap
  }

  // ---------- 호가창 ----------
  let bookSeed = [];
  function paintBook() {
    const p = shownIdx >= 0 ? prices[shownIdx] : session?.open;
    if (!p) { bookEl.replaceChildren(); return; }
    const step = tickSize(p), n = matchMedia('(min-width:700px)').matches ? 5 : 2;
    const trend = shownIdx > 5 ? Math.sign(prices[shownIdx] - prices[shownIdx - 5]) : 0;
    if (bookSeed.length !== n * 2 || Math.random() < 0.5) bookSeed = Array.from({ length: n * 2 }, () => 0.3 + Math.random());
    const rows = [];
    for (let k = n; k >= 1; k--) rows.push({ price: p + step * k, qty: bookSeed[n - k] * (trend < 0 ? 1.5 : 1), ask: true });
    for (let k = 0; k < n; k++) rows.push({ price: p - step * k, qty: bookSeed[n + k] * (trend > 0 ? 1.5 : 1), ask: false, now: k === 0 });
    const max = Math.max(...rows.map(r => r.qty));
    const at = session?.hi && p >= session.hi ? '상한가' : session?.lo && p <= session.lo ? '하한가' : '';
    bookEl.innerHTML = rows.map(r => `<li class="mk-q ${r.ask ? 'is-ask' : 'is-bid'}${r.now ? ' is-now' : ''}"><span class="mk-q-bar" style="--w:${Math.round(r.qty / max * 100)}%"></span><b>${won(r.price)}</b><small>${won(r.qty * 1800)}</small></li>`).join('') + (at ? `<li class="mk-q-limit">${at}</li>` : '');
  }

  // ---------- 종토방 ----------
  function say(kind) {
    const li = el('li', 'mk-say');
    li.innerHTML = `<b>${pick(NICKS)}</b>${pick(TALK[kind])}`;
    talkEl.prepend(li);
    while (talkEl.children.length > 4) talkEl.lastElementChild.remove();
  }

  // ---------- chart ----------
  function size() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }
  const RED = '#ff5a5f', BLUE = '#4d9bff';
  function draw(frac = 1) {
    const { w, h, dpr } = size();
    g.clearRect(0, 0, w, h);
    if (!session || shownIdx < 0 || !prices.length) return;
    const ticks = session.ticks, upTo = Math.max(0, shownIdx);
    const padL = 6 * dpr, padR = 58 * dpr, padT = 10 * dpr, volH = h * 0.16, padB = 16 * dpr;
    const plotH = h - padT - padB - volH;
    const seen = prices.slice(0, upTo + 1);
    const ref = session.prevClose;
    let lo = Math.min(ref, ...seen), hi = Math.max(ref, ...seen);
    if (position) { lo = Math.min(lo, position.entryPrice); hi = Math.max(hi, position.entryPrice); }
    const span = Math.max(hi - lo, ref * 0.04);
    lo -= span * 0.12; hi += span * 0.12;
    const x = i => padL + (w - padL - padR) * (i / (ticks - 1));
    const y = p => padT + plotH * (1 - (p - lo) / (hi - lo));
    // grid and 기준가
    g.strokeStyle = '#ffffff14'; g.lineWidth = dpr;
    for (let k = 1; k < 4; k++) { const yy = padT + plotH * k / 4; g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - padR, yy); g.stroke(); }
    g.font = `600 ${10.5 * dpr}px Archivo, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const label = (p, text, color, dash) => {
      if (p < lo || p > hi) return;
      g.save(); g.strokeStyle = color; g.setLineDash(dash ? [4 * dpr, 4 * dpr] : []); g.beginPath(); g.moveTo(padL, y(p)); g.lineTo(w - padR, y(p)); g.stroke(); g.restore();
      g.fillStyle = color; g.fillText(text, w - padR + 4 * dpr, y(p));
    };
    label(ref, won(ref), '#ffffff66', true);
    if (session.hi <= hi) label(session.hi, '상한가', RED, true);
    if (session.lo >= lo) label(session.lo, '하한가', BLUE, true);
    // candles
    const cw = (w - padL - padR) / (ticks / PER_CANDLE) * 0.62;
    for (let c = 0; c * PER_CANDLE <= upTo; c++) {
      const a = c * PER_CANDLE, b = Math.min(upTo, a + PER_CANDLE - 1);
      const seg = prices.slice(a, b + 1), open = c ? prices[a - 1] : session.open, close = seg.at(-1);
      const cx = x(a + (PER_CANDLE - 1) / 2);
      const col = close > open ? RED : close < open ? BLUE : '#c4c9cf';
      g.strokeStyle = col; g.fillStyle = col;
      g.beginPath(); g.moveTo(cx, y(Math.max(...seg, open))); g.lineTo(cx, y(Math.min(...seg, open))); g.stroke();
      const top = y(Math.max(open, close)), bot = y(Math.min(open, close));
      g.globalAlpha = 0.85; g.fillRect(cx - cw / 2, top, cw, Math.max(dpr, bot - top)); g.globalAlpha = 1;
    }
    // the live price line over the candles, the last step eased in
    g.beginPath(); g.lineWidth = 1.6 * dpr; g.strokeStyle = '#f4f5f7';
    for (let i = 0; i <= upTo; i++) {
      const px = i === upTo && i > 0 ? x(i - 1) + (x(i) - x(i - 1)) * frac : x(i);
      const pp = i === upTo && i > 0 ? prices[i - 1] + (prices[i] - prices[i - 1]) * frac : prices[i];
      if (i) g.lineTo(px, y(pp)); else g.moveTo(px, y(pp));
    }
    g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1;
    // volume
    const vb = h - padB, vw = Math.max(dpr, (w - padL - padR) / ticks * 0.7), vmax = Math.max(1, ...volumes.slice(0, upTo + 1));
    for (let i = 0; i <= upTo; i++) {
      const d = i ? prices[i] - prices[i - 1] : 0;
      g.fillStyle = d > 0 ? '#ff5a5f88' : d < 0 ? '#4d9bff88' : '#ffffff33';
      const vh = volH * 0.9 * volumes[i] / vmax;
      g.fillRect(x(i) - vw / 2, vb - vh, vw, vh);
    }
    // my entry
    if (position && position.entryIdx <= upTo) {
      const col = position.side === 'LONG' ? RED : BLUE;
      label(position.entryPrice, won(position.entryPrice), col, false);
      g.fillStyle = col; g.beginPath(); g.arc(x(position.entryIdx), y(position.entryPrice), 4 * dpr, 0, Math.PI * 2); g.fill();
    }
    // the dot at the price now
    const p = prices[upTo], d = p - ref;
    g.fillStyle = d > 0 ? RED : d < 0 ? BLUE : '#f4f5f7';
    const dotX = upTo ? x(upTo - 1) + (x(upTo) - x(upTo - 1)) * frac : x(0);
    g.beginPath(); g.arc(dotX, y(upTo ? prices[upTo - 1] + (p - prices[upTo - 1]) * frac : p), 3.5 * dpr, 0, Math.PI * 2); g.fill();
    // time axis
    g.fillStyle = '#ffffff73'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (const [i, s] of [[0, '09:00'], [Math.round((ticks - 1) * 180 / 390), '12:00'], [ticks - 1, '15:30']]) g.fillText(s, Math.min(w - padR - 14 * dpr, Math.max(padL + 14 * dpr, x(i))), h - 3 * dpr);
  }

  // ---------- what the head and the position show ----------
  function paintQuote() {
    if (!session || shownIdx < 0) { priceEl.textContent = '—'; chgEl.textContent = ''; return; }
    const p = prices[shownIdx], d = p - session.prevClose;
    priceEl.textContent = won(p);
    priceEl.dataset.tone = tone(d);
    chgEl.dataset.tone = tone(d);
    const pc = pct(p, session.prevClose);
    chgEl.textContent = d ? `${arrow(d)}${won(Math.abs(d))}${pc ? ` ${signed(pc)}%` : ''}` : '보합';
    clockEl.textContent = clockAt(shownIdx, session.ticks);
    const phase = session.over && shownIdx >= session.ticks - 1 ? 'closed' : halts[shownIdx] ? 'vi' : auctionAt(shownIdx) ? 'auction' : 'open';
    root.dataset.phase = phase;
    stateEl.textContent = { open: '장중', vi: 'VI 발동', auction: '동시호가', closed: '장 마감' }[phase];
  }
  const equity = (pos, p) => Math.max(0, pos.stake * (1 + pos.lev * (pos.side === 'SHORT' ? -1 : 1) * (p / pos.entryPrice - 1)));
  const takeHome = (pos, p) => { const e = equity(pos, p); return e <= 0 ? 0 : Math.max(0, Math.floor(e / pos.unit + 1e-9) * pos.unit - pos.fee); };
  function paintPosition() {
    if (!position) { posEl.hidden = true; return; }
    posEl.hidden = false;
    const p = shownIdx >= 0 ? prices[Math.max(shownIdx, position.entryIdx)] : position.entryPrice;
    const value = takeHome(position, p), net = value - position.stake;
    const rate = Math.round(net / position.stake * 100);
    posEl.dataset.tone = tone(net);
    posEl.innerHTML = `<span class="mk-pos-k">${position.side === 'LONG' ? '매수' : '인버스'} ${position.lev}배 · ${tickerById(position.ticker)?.name || ''}</span>
      <span class="mk-pos-in">매수가 ${won(position.entryPrice)} · 원금 ${formatUnit(position.stake)}</span>
      <strong class="mk-pos-pl">${net > 0 ? '+' : ''}${formatUnit(net)} <small>${signed(rate)}%</small></strong>`;
    refreshActions();
  }

  // ---------- the order panel ----------
  function paintOrder() {
    sideBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.side === side)));
    levBtns.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.lev) === lev)));
    root.dataset.side = side;
    const stake = t.total || t.tier.min;
    $('[data-fee]').textContent = lev > 1 ? `1% 움직이면 ${lev}% · 수수료 ${formatUnit(feeOf(stake))}` : `칩을 놓고 사요 · 수수료 ${formatUnit(feeOf(stake))}`;
  }
  const unit = () => chipValueFor(t.tier.min); // one chip
  const feeOf = stake => Math.max(unit(), Math.round(stake * lev / 100 / unit()) * unit()); // lib/market.mjs feeOf
  sideBtns.forEach(b => b.addEventListener('click', () => { if (position || t.busy) return; side = b.dataset.side; savePref({ side }); sound.tick(); paintOrder(); refreshActions(); }));
  levBtns.forEach(b => b.addEventListener('click', () => { if (position || t.busy) return; lev = Number(b.dataset.lev); savePref({ lev }); sound.tick(); paintOrder(); refreshActions(); }));

  // ---------- actions ----------
  function refreshActions() {
    const phase = root.dataset.phase;
    if (!session) { t.setActions([{ label: '종목 고르기', key: '↵', primary: true, onClick: openPicker }]); return; }
    if (position) {
      const p = shownIdx >= 0 ? prices[Math.max(shownIdx, position.entryIdx)] : position.entryPrice;
      const value = takeHome(position, p);
      const hold = phase === 'vi' || phase === 'auction' || phase === 'closed';
      t.setActions([{ label: phase === 'auction' || phase === 'closed' ? '종가에 정리돼요' : phase === 'vi' ? 'VI 발동 중' : `팔기 ${formatUnit(value)}`, key: '↵', primary: true, disabled: hold || selling, onClick: sell }]);
      return;
    }
    if (phase === 'closed' || session.over) {
      t.setActions([{ label: '종목 바꾸기', ghost: true, onClick: openPicker }, { label: '다음 장 열기', key: '↵', primary: true, onClick: () => ring(session.ticker, true) }]);
      return;
    }
    const label = side === 'LONG' ? `${lev}배 매수` : `${lev}배 인버스`;
    const list = t.idleActions(label, buy, { againLabel: `같은 금액 ${label}` });
    if (phase === 'vi' || phase === 'auction') list.forEach(a => { if (a.primary) { a.disabled = true; a.label = phase === 'vi' ? 'VI 발동 중' : '동시호가 · 주문 마감'; } });
    t.setActions(list);
  }
  t.refreshActions = refreshActions;
  t.onBetChange = () => { paintOrder(); refreshActions(); };

  async function buy() {
    if (!t.betReady || !session || position) return;
    const stake = t.total, key = t.roundKey(`${side}${lev}`);
    t.lock();
    let res;
    try { res = await api.marketBuy(stake, t.tier.floor, side, lev, session.id, key); }
    catch (e) { t.roundFailed(e, buy); refreshActions(); return; }
    t.roundDone();
    t.setServerState(res.state);
    position = res.position;
    sound.chips(2); haptic(12);
    flash(side === 'LONG' ? '매수 체결' : '인버스 체결', side === 'LONG' ? 'up' : 'down', `${won(position.entryPrice)}에 ${formatUnit(position.stake)}`);
    paintPosition(); refreshActions();
  }

  async function sell() {
    if (!position || selling) return;
    selling = true; refreshActions();
    let res;
    try { res = await api.marketSell(position.id); }
    catch (e) { selling = false; t.toast(errorMessage(e)); refreshActions(); return; }
    t.setServerState(res.state);
    await closeOut(res.sold);
    selling = false;
  }

  // A trade is over (sold, wiped out, or settled at the close): the chips go home or to the rack.
  async function closeOut(sold) {
    if (!sold || ending) return;
    ending = true;
    const was = position;
    position = null;
    const reason = sold.exit?.reason;
    if (reason === 'LIQUIDATED') { stamp('반대매매', 'down'); sound.thud(); }
    const net = sold.netPnl ?? (sold.exit.value - sold.stake);
    const label = reason === 'LIQUIDATED' ? '반대매매 · 강제 청산' : reason === 'CLOSE' ? `종가 ${won(sold.exit.price)}에 정리` : `${won(sold.exit.price)}에 매도`;
    if (was) paintPosition();
    await t.settle(net, { label });
    await t.syncBalance();
    ending = false;
    paintOrder(); refreshActions();
  }

  // ---------- moments ----------
  let newsTimer = 0;
  function flash(title, kind, line = '') {
    newsEl.innerHTML = `<b>${title}</b>${line ? `<span>${line}</span>` : ''}`;
    newsEl.dataset.tone = kind;
    newsEl.classList.remove('is-shown'); void newsEl.offsetWidth; newsEl.classList.add('is-shown');
    clearTimeout(newsTimer); newsTimer = setTimeout(() => newsEl.classList.remove('is-shown'), 3200);
  }
  function stamp(text, kind) {
    if (lastStamp === text) return;
    lastStamp = text;
    stampEl.textContent = text; stampEl.dataset.tone = kind;
    stampEl.classList.remove('is-shown'); void stampEl.offsetWidth; stampEl.classList.add('is-shown');
  }
  function unstamp() { if (lastStamp) { lastStamp = ''; stampEl.classList.remove('is-shown'); } }

  // What happens as each new tick comes on screen.
  function onTick(i) {
    const p = prices[i], prev = i ? prices[i - 1] : session.open;
    const n = newsAt.get(i);
    if (n) {
      flash(`[속보] ${tickerById(session.ticker)?.name || ''}`, n.up ? 'up' : 'down', n.text);
      sound.strike(); haptic([20, 40, 20]);
      say(n.up ? 'newsUp' : 'newsDown');
    }
    if (halts[i] && !halts[i - 1]) { stamp('VI 발동', 'vi'); say('vi'); sound.shutter(); }
    else if (p >= session.hi && prev < session.hi) { stamp('상한가', 'up'); say('limitUp'); sound.levelUp(3); haptic([30, 30, 60]); }
    else if (p <= session.lo && prev > session.lo) { stamp('하한가', 'down'); say('limitDown'); sound.thud(); }
    else if (!halts[i] && p < session.hi && p > session.lo) unstamp();
    if (i === session.ticks - session.auction) flash('동시호가', 'flat', '15:20부터 주문 없이 종가를 정해요');
    if (i % 14 === 7 && Math.random() < 0.7) {
      const back = prices[Math.max(0, i - 14)];
      say(p > back * 1.01 ? 'up' : p < back * 0.99 ? 'down' : 'flat');
    }
    if (i % 4 === 0) paintBook();
    if (i % 24 === 0) paintTape();
    if (position) paintPosition();
  }

  function dayEnd() {
    if (boardEl.hidden === false) return;
    bell(2);
    const close = prices[session.ticks - 1], d = close - session.prevClose;
    const hi = Math.max(...prices), lo = Math.min(...prices);
    boardEl.innerHTML = `<b>장 마감</b><span class="mk-board-close" data-tone="${tone(d)}">${won(close)} <small>${arrow(d)}${won(Math.abs(d))} ${signed(pct(close, session.prevClose))}%</small></span><span class="mk-board-row"><i>시가 ${won(session.open)}</i><i>고가 ${won(hi)}</i><i>저가 ${won(lo)}</i></span><small>내일 장은 오늘 종가에서 시작해요</small>`;
    boardEl.hidden = false;
    paintQuote();
    refreshActions();
  }

  // ---------- the clock ----------
  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!session) return;
    const target = nowIdx();
    while (shownIdx < target) { shownIdx++; onTick(shownIdx); paintQuote(); if (shownIdx === target) refreshActions(); }
    const frac = reducedMotion() ? 1 : Math.max(0, Math.min(1, (performance.now() - startLocal - LAG) / session.tickMs - shownIdx));
    draw(shownIdx > 0 && shownIdx < session.ticks - 1 ? frac : 1);
    if (session.over && shownIdx >= session.ticks - 1 && boardEl.hidden) dayEnd();
  }

  function addTicks(tk) {
    if (!session || tk.id !== session.id) return;
    for (let k = 0; k < tk.price.length; k++) {
      const i = tk.from + k;
      if (i < have) continue;
      prices[i] = tk.price[k]; halts[i] = tk.halt[k];
      const d = i ? Math.abs(tk.price[k] - prices[i - 1]) / tickSize(tk.price[k]) : 1;
      volumes[i] = halts[i] ? 0.2 : 0.6 + d * 0.8 + Math.random() * 0.9;
      have = i + 1;
    }
    for (const n of tk.news || []) newsAt.set(n.i, n);
    if (tk.over) session.over = true;
  }

  async function poll() {
    if (!alive || polling || !session || document.hidden) return;
    if (have >= session.ticks && !position) return;
    polling = true;
    try {
      const res = await api.marketTicks(have);
      addTicks(res.ticks);
      if (res.settled) { if (res.state) t.setServerState(res.state); await closeOut(res.settled); }
      else if (position && !res.position) {
        // Settled elsewhere (another tab): catch up.
        position = null; paintPosition(); refreshActions();
      }
    } catch {}
    polling = false;
  }

  function startDay(s) {
    session = { ...s };
    prices = []; halts = []; volumes = []; newsAt = new Map(); have = 0; shownIdx = -1; lastStamp = '';
    startLocal = performance.now() - s.elapsed;
    boardEl.hidden = true; boardEl.innerHTML = '';
    unstamp(); talkEl.replaceChildren();
    const tk = tickerById(s.ticker);
    nameEl.textContent = tk?.name || s.ticker;
    sectorEl.textContent = tk ? `${tk.sector} · ${s.dayNo}일째` : '';
    t.root.querySelector('.table-title').textContent = tk?.name || gameName('stocks');
    paintTape();
    if (s.elapsed < 1500) { bell(1); flash('09:00 장 시작', 'flat', `${tk?.name || ''} 기준가 ${won(s.prevClose)}`); }
  }

  async function ring(ticker, fresh = false) {
    let res;
    try { res = await api.marketBell(ticker, fresh); }
    catch (e) { t.toast(errorMessage(e)); return; }
    tickers = res.tickers;
    savePref({ ticker });
    t.setServerState(res.state);
    startDay(res.session);
    await poll();
    refreshActions();
  }

  // ---------- picking a stock ----------
  function spark(closes) {
    if (closes.length < 2) return '<svg class="mk-spark" viewBox="0 0 60 20" aria-hidden="true"><path d="M0 10H60"/></svg>';
    const lo = Math.min(...closes), hi = Math.max(...closes), sp = hi - lo || 1;
    const pts = closes.map((c, i) => `${(i / (closes.length - 1) * 60).toFixed(1)},${(18 - (c - lo) / sp * 16).toFixed(1)}`).join(' ');
    return `<svg class="mk-spark" data-tone="${tone(closes.at(-1) - closes[0])}" viewBox="0 0 60 20" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  }
  function openPicker() {
    if (position) { t.toast('들고 있는 주식을 먼저 팔아 주세요'); return; }
    const sheet = el('div', 'mk-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '종목 고르기');
    sheet.innerHTML = `<div class="mk-sheet-card"><header><strong>오늘 거래할 종목</strong><button type="button" class="mk-sheet-x" data-close aria-label="닫기">✕</button></header><ul>${tickers.map(x => `
      <li><button type="button" data-ticker="${x.id}"${session?.ticker === x.id && !session.over ? ' aria-current="true"' : ''}>
        <span class="mk-sheet-name"><b>${x.name}</b><small>${x.sector} · ${x.tag}</small></span>
        ${spark(x.closes)}
        <span class="mk-sheet-close">${x.close ? `${won(x.close)}<small>어제 종가</small>` : '<small>첫 거래</small>'}</span>
      </button></li>`).join('')}</ul></div>`;
    const close = () => sheet.remove();
    sheet.addEventListener('click', e => {
      if (e.target === sheet || e.target.closest('[data-close]')) return close();
      const b = e.target.closest('[data-ticker]');
      if (b) { close(); sound.tick(); t.run(() => ring(b.dataset.ticker, session?.ticker === b.dataset.ticker ? false : true)); }
    });
    t.root.append(sheet);
    const card = sheet.querySelector('.mk-sheet-card');
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
    sheet.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  $('[data-pick]').addEventListener('click', openPicker);

  // ---------- start ----------
  t.onKey(e => { const a = !t.busy && e.key === 'Enter' && !e.target.closest('button') && t.enterAction(); if (a) { e.preventDefault(); t.run(a.onClick); } });
  const onVisible = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVisible);
  const ro = new ResizeObserver(() => { draw(1); paintBook(); });
  ro.observe(chartBox);
  const leave = t.destroy?.bind(t);
  t.destroy = () => { alive = false; cancelAnimationFrame(raf); clearInterval(pollTimer); clearTimeout(newsTimer); ro.disconnect(); document.removeEventListener("visibilitychange", onVisible); return leave?.(); };

  paintOrder();
  try {
    const open = await api.marketOpen();
    tickers = open.tickers;
    if (open.state) t.setServerState(open.state);
    position = open.position;
    if (position) { t.placeLocked('ORDER', position.stake); t.lock(); t.refreshBet(); side = position.side; lev = position.lev; paintOrder(); }
    if (open.session && !open.session.over) startDay(open.session);
    else if (position) startDay(open.session);
    else {
      // No day running: the last stock traded opens again (or the first, the first time).
      const want = tickerById(pref.ticker) ? pref.ticker : tickers[0].id;
      await ring(want, true);
    }
  } catch (e) { t.toast(errorMessage(e)); }
  paintTape(); paintBook(); refreshActions();
  pollTimer = setInterval(poll, POLL);
  poll();
  raf = requestAnimationFrame(frame);
  return t;
}
