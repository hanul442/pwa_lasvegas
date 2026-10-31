// 금액 전수 점검 (2026-10-31, 한서 "구제금융 만원 ㅇㅈㄹ 하는데 그냥 다 점검해라"). Every amount the app
// shows or charges, on every floor: whole numbers only, no decimal point, no 원 written after a chip
// count, and each one matching what the server really pays or takes. New amounts belong here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { RP_TIER_STARTS } from '../lib/rank-points.mjs';
import { monthBoundary } from '../lib/rank-tier.mjs';
import { EVENTS, eventBuyIn, eventFloor, alwaysEvents, eventOfWeek } from '../lib/events.mjs';
import { eventFee } from '../lib/event-fee.mjs';
import { COSMETICS, cleanPrice } from '../lib/cosmetics.mjs';
import { WELFARE_BELOW, supportStatus } from '../lib/engagement.mjs';
import { settleHouseGame, totalBalance } from '../lib/economy.mjs';
import { formatCH, formatMoney, formatWon, wonCH, chipCount, setTableUnits, chipValueFor } from '../public/js/money.js';
import { forceHotTable } from '../lib/hot-table.mjs';

forceHotTable('off');
const ROOT = new URL('../public/', import.meta.url);
const sources = () => {
  const out = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
      else if (e.name.endsWith('.js')) out.push([new URL(e.name, dir).pathname.split('/public/')[1], readFileSync(new URL(e.name, dir), 'utf8')]);
    }
  };
  walk(ROOT);
  return out;
};

async function stateAt(floorIndex, edit = () => {}) {
  let state = defaultState();
  const u = state.users.hanseo;
  Object.assign(u.account, { available: 0, locked: 0, wallet: FLOORS[floorIndex].minBet * 300 });
  const pts = RP_TIER_STARTS[floorIndex + 1] + 10;
  u.rp = { season: monthBoundary(Date.now()).id, points: pts, peak: pts, rounds: 50, day: null, dayGain: 0 };
  edit(state, u);
  const store = { load: async () => structuredClone(state), mutate: async fn => { const n = structuredClone(state); const o = await fn(n); state = n; return o; } };
  const res = await handleApi({ method: 'GET', header: () => undefined, body: async () => ({}) }, new URL('http://x/api/state'), store, { NODE_ENV: 'production' });
  assert.equal(res.status, 200);
  return res.data;
}

test('money text never has a decimal point, for any amount, in 원 or at a table in 칩', () => {
  const values = [];
  for (let e = 0; e <= 15; e++) for (const m of [1, 1.2, 1.5, 2.5, 3.33, 9.99, 9.9999]) values.push(Math.round(m * 10 ** e));
  for (const f of FLOORS) values.push(f.minBet, f.maxBet, f.minBet / 3, f.minBet * 0.95, f.minBet * 333);
  for (const v of values) {
    for (const s of [formatCH(v), formatMoney(v), formatWon(v), wonCH(v), chipCount(v)]) assert.doesNotMatch(s, /\d\.\d/, `${v} → ${s}`);
    for (const f of FLOORS) {
      setTableUnits(true, chipValueFor(f.minBet));
      for (const s of [formatCH(v), formatMoney(v)]) assert.doesNotMatch(s, /\d\.\d/, `${f.slug} ${v} → ${s}`);
      setTableUnits(false);
    }
  }
});

test('nothing writes 원 right after a number that turns into chips at a table', () => {
  // formatCH switches to a chip count while a table is open (money.js), so "${formatCH(x)}원" read
  // "+10만 원" for a 100억 구제금융 at the 홀 table. Amounts in 원 use wonCH / formatWon.
  const bad = [];
  for (const [file, src] of sources()) {
    if (file.endsWith('money.js')) continue;
    src.split('\n').forEach((line, i) => {
      if (/formatCH\((?:[^()]|\([^()]*\))*\)\}\s*(?:<[a-z]+>)?\s*원/.test(line)) bad.push(`${file}:${i + 1}`);
      if (/data-amount>\$\{formatCH/.test(line)) bad.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('the 구제금융 popup and the bust screen count in 원 even at a table', () => {
  const src = readFileSync(new URL('js/bust.js', ROOT), 'utf8');
  assert.doesNotMatch(src, /formatCH/, 'bust.js shows wallet money: wonCH / formatWon only');
  setTableUnits(true, chipValueFor(FLOORS[0].minBet));
  assert.equal(`+${wonCH(10_000_000_000)}원`, '+100억원');
  setTableUnits(false);
});

test('the 구제금융 covers anyone who cannot sit at the cheapest table, not only an exact 0', () => {
  assert.equal(WELFARE_BELOW, FLOORS[0].minBet);
  const state = defaultState();
  const u = state.users.hanseo;
  Object.assign(u.account, { available: 15_000_000, locked: 0, wallet: 0 });
  // 1천만 lost of 1500만: 500만 left, no table takes it.
  settleHouseGame(state, u, { game: 'Blackjack', stake: 10_000_000, netPnl: -10_000_000, roundId: 'r-audit-1' });
  const bail = state.ledger.find(x => x.userId === u.id && x.type === 'WELFARE');
  assert.ok(bail, 'paid without asking');
  assert.equal(bail.amount, 10_000_000_000);
  assert.ok(bail.metadata.auto);
  assert.equal(totalBalance(u), 5_000_000 + 10_000_000_000);
  // Money sitting in the wallet is not "on a table".
  const rich = defaultState().users.hanseo;
  Object.assign(rich.account, { available: 0, locked: 0, wallet: 3_000_000_000 });
  assert.equal(supportStatus(rich).welfare.reason, 'CHIPS');
});

test('every floor: the state the app gets holds whole numbers for every amount and no decimal in any text', async () => {
  const MONEY_KEY = /amount|fee|price|reward|prize|^min|^max|bet|buyIn|entry|stake|cap|base|below|wallet|available|locked|payout|pay$|daily|weekly|monthly|need|jackpot/i;
  for (let i = 0; i < FLOORS.length; i++) {
    const data = await stateAt(i);
    const bad = [];
    const walk = (v, path, key) => {
      // Loan rates belong to the retired bank (shown only for loans left from before the RP season).
      if (typeof v === 'number') { if (MONEY_KEY.test(key) && !/rate/i.test(key) && !Number.isSafeInteger(v)) bad.push(`${path} = ${v}`); }
      else if (typeof v === 'string') { if (/\d\.\d/.test(v) && /칩|원|만|억|조|배|RP/.test(v)) bad.push(`${path}: ${v}`); }
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, k);
    };
    walk(data, FLOORS[i].slug, '');
    assert.deepEqual(bad, [], FLOORS[i].slug);
    // What the bank page and the popups say about the 구제금융 is what the server pays.
    assert.equal(data.engagement.support.welfare.below, FLOORS[0].minBet);
    // Every table amount on the open floors is a whole number of that floor's chips.
    for (const [slug, r] of Object.entries(data.cashier.floors)) {
      const chip = FLOORS.find(f => f.slug === slug).minBet / 100;
      for (const k of ['min', 'max', 'default']) assert.equal(r[k] % chip, 0, `${slug} buy-in ${k}`);
    }
  }
});

test('event rules say the buy-in that is charged, and fees are whole smallest bets of the event table', () => {
  const live = [...alwaysEvents(), ...[0, 1, 2, 3, 4].map(eventOfWeek)];
  for (const e of live) {
    const floor = FLOORS.find(f => f.slug === eventFloor(e));
    assert.equal(eventFee(e) % floor.minBet, 0, `${e.id} fee ${eventFee(e)}`);
    const line = e.rules.find(r => r.startsWith('바이인'));
    if (line) assert.equal(line, `바이인 ${wonCH(eventBuyIn(e))} 고정`, e.id);
    for (const r of e.rules) assert.doesNotMatch(r, /\{|\d\.\d/, `${e.id}: ${r}`);
  }
  for (const e of EVENTS) assert.doesNotMatch(e.blurb, /\d\.\d/);
  const app = readFileSync(new URL('app.js', ROOT), 'utf8');
  const whale = app.match(/id: 'whale'[^\n]*바이인 ([^,]+),/);
  assert.equal(whale?.[1], wonCH(eventBuyIn(EVENTS.find(e => e.id === 'whale'))), 'the Whale Room card says its real buy-in');
});

test('shop prices sit on clean steps (1천만, 1500만, 2천만 …), never 2300만 or 9억 9천만', () => {
  for (const c of COSMETICS) {
    if (!c.price) continue;
    assert.equal(cleanPrice(c.price), c.price, `${c.id} ${wonCH(c.price)}`);
    assert.doesNotMatch(wonCH(c.price), /\d\.\d/, `${c.id} ${wonCH(c.price)}`);
  }
});

test('table guides give their examples in 칩, as the tables count, not old 원 amounts', () => {
  const src = readFileSync(new URL('js/guides.js', ROOT), 'utf8');
  assert.doesNotMatch(src, /\d+ ?(만|억|천만) ?\d*원/, 'an example in 원');
  assert.doesNotMatch(src, /100만 단위/);
});

test('push and news texts: the duel prize is what is paid, the 구제금융 is not at a bank', async () => {
  const news = readFileSync(new URL('../lib/news.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(news, /이기면 1억원|상금 1억원/);
  const push = readFileSync(new URL('../lib/notifications.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(push, /은행에서/);
  const api = readFileSync(new URL('js/api.js', ROOT), 'utf8');
  assert.doesNotMatch(api, /100만원 (미만|단위)|칩을 100억 이상|펜트하우스 테이블에서만/);
});

test('the RP rules show whole RP, never a ×0.75 multiplier', () => {
  const src = readFileSync(new URL('js/rank-tab.js', ROOT), 'utf8');
  assert.doesNotMatch(src, /times\(g\.(win|loss)\)|times\(r\.downFloor\)/);
  assert.doesNotMatch(src, /0\.5배|1\.3배|3\/4/);
});

test('a friends duel pays the same everywhere, like pay and missions (it paid 3조 at the 올림포스)', async () => {
  const { challengePrizeFor } = await import('../lib/social-competition.mjs');
  for (let i = 0; i < FLOORS.length; i++) {
    const data = await stateAt(i);
    assert.equal(data.socialCompetition.prize, 100 * FLOORS[0].minBet, FLOORS[i].slug);
  }
  assert.equal(challengePrizeFor(defaultState().users.hanseo), 1_000_000_000);
});
