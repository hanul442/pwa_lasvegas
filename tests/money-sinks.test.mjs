// 돈 쓰는 곳 (2026-10-29): 승급전 참가비, 이벤트 입장료, 시즌 한정 꾸미기.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { noteRp, rpView, rpOf } from '../lib/rank-points.mjs';
import { startPromo, promoView } from '../lib/promo.mjs';
import { chargeEventFee, eventFeesView, eventFee } from '../lib/event-fee.mjs';
import { eventById } from '../lib/events.mjs';
import { buyItem, shopView } from '../lib/shop.mjs';

const OCT = Date.parse('2026-10-29T12:00:00+09:00');
const NOV = Date.parse('2026-11-10T12:00:00+09:00');
const DEC = Date.parse('2026-12-03T12:00:00+09:00');
const 억 = 100_000_000;
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };
const player = (state, id, wallet) => { const u = newUser(state, id, id.toUpperCase()); u.account.wallet = wallet; return u; };
const withPoints = (u, points, now) => { rpOf(u, now); u.rp.points = points; u.rp.peak = points; };

test('승급전: only in a tier\'s division I, the fee comes from the wallet, three wins lift to the next tier', () => {
  const state = defaultState();
  const u = player(state, 'p', 10 * 억);
  at(OCT, () => withPoints(u, 50, OCT));
  assert.equal(at(OCT, () => promoView(u)).offer, null, 'division II: no series yet');
  assert.throws(() => at(OCT, () => startPromo(state, u)), /PROMO_NOT_AVAILABLE/);
  u.rp.points = 85;
  const offer = at(OCT, () => promoView(u)).offer;
  assert.deepEqual(offer, { target: 'bronze', fee: 2 * 억, minStake: 10_000_000, wins: 3, losses: 3 });
  at(OCT, () => startPromo(state, u));
  assert.equal(u.account.wallet, 8 * 억);
  assert.equal(state.ledger.at(-1).type, 'PROMO_FEE');
  assert.equal(state.ledger.at(-1).amount, -2 * 억);
  assert.throws(() => at(OCT, () => startPromo(state, u)), /PROMO_ACTIVE/);
  noteRp(u, { game: 'Baccarat', stake: 1_000_000, netPnl: -1_000_000 }, OCT);
  assert.equal(u.rp.promo.wins, 0, 'a bet under the series minimum does not count');
  noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: 10_000_000 }, OCT);
  noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: -10_000_000 }, OCT);
  assert.equal(u.rp.promo.active, true);
  noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: 10_000_000 }, OCT);
  assert.equal(u.rp.promo.active, true, 'two wins of three');
  noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: 10_000_000 }, OCT);
  assert.equal(u.rp.promo.result, 'won');
  assert.equal(u.rp.promo.log, 'WLWW', 'the order of results, for the five circles');
  assert.ok(u.rp.points >= 100);
  assert.equal(rpView(u, OCT).tier, 'bronze');
});

test('승급전: three losses end it and the fee is gone; a new season drops an open series', () => {
  const state = defaultState();
  const u = player(state, 'q', 10 * 억);
  at(OCT, () => withPoints(u, 190, OCT));
  const s = at(OCT, () => startPromo(state, u));
  assert.equal(s.target, 'silver');
  assert.equal(s.fee, 30_000_000 * 20, 'silver plays High Limit: 20 of its 3천만 bets');
  noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: -10_000_000 }, OCT);
  noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: -10_000_000 }, OCT);
  assert.equal(u.rp.promo.active, true, 'two losses of three');
  noteRp(u, { game: 'Baccarat', stake: 10_000_000, netPnl: -10_000_000 }, OCT);
  assert.equal(u.rp.promo.result, 'lost');
  assert.ok(u.rp.points < 190);
  const v = player(state, 'r', 10 * 억);
  at(NOV, () => withPoints(v, 80, NOV));
  at(NOV, () => startPromo(state, v));
  assert.equal(at(DEC, () => promoView(v)).active, null, 'December is a new season');
});

test('이벤트 입장료: a tenth of the entry, once a week for a rotating event and once a day for an always-open one', () => {
  const state = defaultState();
  const u = player(state, 'e', 50 * 억);
  const oceans = eventById('oceans'), casablanca = eventById('casablanca'), whale = eventById('whale');
  // A tenth of 100억, in whole chips of the 펜트하우스 (300만 each): 333칩.
  const FEE = 333 * 3_000_000;
  assert.equal(eventFee(oceans), FEE);
  assert.equal(eventFee(whale), 100 * 억);
  assert.equal(chargeEventFee(state, u, oceans, OCT), FEE);
  assert.equal(chargeEventFee(state, u, oceans, OCT + 3_600_000), 0, 'paid for the week');
  assert.equal(chargeEventFee(state, u, casablanca, OCT), FEE);
  assert.equal(chargeEventFee(state, u, casablanca, OCT + 86_400_000), FEE, 'a new day');
  assert.equal(u.account.wallet, 50 * 억 - 3 * FEE);
  assert.equal(state.ledger.filter(x => x.type === 'EVENT_FEE').length, 3);
  assert.deepEqual(eventFeesView(u, [oceans, casablanca], OCT + 86_400_000), { oceans: { fee: FEE, paid: true, per: 'week' }, casablanca: { fee: FEE, paid: true, per: 'day' } });
  assert.throws(() => chargeEventFee(state, u, whale, OCT), /INSUFFICIENT_BANKROLL/);
});

test('시즌 한정 꾸미기: sold only in its season, kept after, the next season brings its own', () => {
  const state = defaultState();
  const u = player(state, 's', 300 * 억);
  const ids = at(OCT, () => shopView(u).cosmetics.filter(x => x.season).map(x => x.id));
  assert.deepEqual(ids, ['felt-ember', 'back-ember', 'frame-ember', 'chips-ember']);
  at(NOV, () => buyItem(state, u, 'felt-ember'));
  assert.equal(u.account.wallet, 200 * 억);
  assert.throws(() => at(DEC, () => buyItem(state, u, 'back-ember')), /ITEM_SEASON_OVER/);
  const dec = at(DEC, () => shopView(u).cosmetics.filter(x => x.season));
  assert.deepEqual(dec.map(x => [x.id, x.onSale, x.owned]), [['felt-ember', false, true], ['felt-frost', true, false], ['back-frost', true, false], ['frame-frost', true, false], ['chips-frost', true, false]]);
});

test('over the API: an event table sells its chips at any RP, the first bet pays the fee, the next ones don\'t; 승급전 starts', async () => {
  const { handleApi } = await import('../lib/api.mjs');
  const { addLedger } = await import('../lib/economy.mjs');
  let state = defaultState();
  addLedger(state, state.users.hanseo, { type: 'ADMIN_GRANT', amount: 300 * 억, referenceType: 'TEST' });
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  let n = 0;
  const call = (method, path, body) => handleApi({ method, header: h => ({ 'x-player-id': 'hanseo', 'x-idempotency-key': `sink-key-${String(++n).padStart(4, '0')}` })[h], body: async () => body ?? {} }, new URL(`http://x${path}`), store, {});
  const s = (await call('GET', '/api/state')).data;
  assert.equal(s.eventFees.casablanca.paid, false);
  assert.equal((await call('POST', '/api/cashier/buyin', { floor: 'penthouse', amount: 150 * 억 })).data.error, 'FLOOR_RP_LOCKED', 'not as a plain table');
  const bought = await call('POST', '/api/cashier/buyin', { floor: 'penthouse', amount: 150 * 억, event: 'casablanca' });
  assert.equal(bought.status, 200, JSON.stringify(bought.data));
  const spin = () => call('POST', '/api/roulette/spin', { floor: 'penthouse', event: 'casablanca', bets: [{ betType: 'RED', stake: 300_000_000 }] });
  const first = await spin();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.state.eventFees.casablanca.paid, true);
  assert.equal((await spin()).status, 200);
  assert.equal(state.ledger.filter(x => x.type === 'EVENT_FEE').length, 1);
  assert.equal(state.ledger.find(x => x.type === 'EVENT_FEE').amount, -333 * 3_000_000, 'a tenth of 100억 in whole chips');
  state.users.hanseo.rp.points = 80;
  const promo = await call('POST', '/api/rank/promo');
  assert.equal(promo.status, 200, JSON.stringify(promo.data));
  assert.equal(promo.data.state.promo.active.target, 'bronze');
});
