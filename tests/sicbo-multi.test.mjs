import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { handleApi } from '../lib/api.mjs';
import { playSicBoBets, validateSicBoBets, sicboBetNet, SICBO_TOTAL_PAY } from '../lib/games.mjs';
import { sicboEntries } from '../lib/hand-book.mjs';

const allDice = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) allDice.push([a, b, c]);
const edge = bet => -allDice.reduce((t, d) => t + sicboBetNet({ ...bet, stake: 1 }, d), 0) / 216;

test('every 식보 spot keeps a house edge, the singles at the Macau 7.9%', () => {
  for (let n = 1; n <= 6; n++) assert.ok(Math.abs(edge({ betType: 'SINGLE', target: n }) - 17 / 216) < 1e-12);
  for (const t of ['SMALL', 'BIG', 'ODD', 'EVEN']) assert.ok(Math.abs(edge({ betType: t }) - 6 / 216) < 1e-12, t);
  for (const n of Object.keys(SICBO_TOTAL_PAY)) assert.ok(edge({ betType: 'TOTAL', target: Number(n) }) > 0.05, `total ${n}`);
  assert.ok(edge({ betType: 'ANY_TRIPLE' }) > 0.1);
  assert.equal(sicboBetNet({ betType: 'SINGLE', target: 5, stake: 1 }, [5, 2, 5]), 2);
  assert.equal(sicboBetNet({ betType: 'SINGLE', target: 5, stake: 1 }, [5, 5, 5]), 3);
  assert.equal(sicboBetNet({ betType: 'SINGLE', target: 4, stake: 1 }, [5, 5, 5]), -1);
});

test('one roll settles every spot on its own', () => {
  const r = playSicBoBets([{ betType: 'BIG', stake: 2 }, { betType: 'TOTAL', target: 11, stake: 1 }, { betType: 'SINGLE', target: 2, stake: 1 }, { betType: 'SMALL', stake: 1 }], [5, 4, 2]);
  assert.deepEqual(r.bets.map(b => b.netPnl), [2, 6, 1, -1]);
  assert.equal(r.netPnl, 8);
  assert.equal(r.stake, 5);
  assert.equal(r.total, 11);
  assert.throws(() => validateSicBoBets([]), /INVALID_BETS/);
  assert.throws(() => validateSicBoBets([{ betType: 'BIG', stake: 1 }, { betType: 'BIG', stake: 1 }]), /DUPLICATE_BET/);
  assert.throws(() => validateSicBoBets([{ betType: 'SINGLE', target: 7, stake: 1 }]), /INVALID_TARGET/);
  assert.throws(() => validateSicBoBets([{ betType: 'TOTAL', target: 3, stake: 1 }]), /INVALID_TARGET/);
  assert.throws(() => validateSicBoBets([{ betType: 'PAIR', stake: 1 }]), /INVALID_BET_TYPE/);
  assert.deepEqual(sicboEntries({ bets: [{ betType: 'ANY_TRIPLE', netPnl: 30 }, { betType: 'TOTAL', target: 4, netPnl: -1 }], netPnl: 29 }), ['sb-triple']);
});

function api(initial) {
  let state = initial;
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (path, body, key) => handleApi({ method: 'POST', header: n => (n === 'x-idempotency-key' ? key : undefined), body: async () => body }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });
  return { call, get state() { return state; } };
}

test('/api/sicbo/roll takes many spots in one idempotent round under the table limits', async () => {
  const s = defaultState();
  s.users.hanseo.account.available = 300_000_000;
  const h = api(s);
  const bets = [{ betType: 'BIG', stake: 5_000_000 }, { betType: 'SINGLE', target: 6, stake: 5_000_000 }, { betType: 'TOTAL', target: 10, stake: 1_000_000 }];
  const res = await h.call('/api/sicbo/roll', { floor: 'high-limit', bets }, 'sicbo-roll-0001');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const round = res.data.round;
  assert.equal(round.bets.length, 3);
  assert.equal(round.stake, 11_000_000);
  assert.equal(round.netPnl, round.bets.reduce((a, b) => a + sicboBetNet(b, round.dice), 0));
  assert.equal(res.data.state.user.account.available, 300_000_000 + round.netPnl);
  const again = await h.call('/api/sicbo/roll', { floor: 'high-limit', bets }, 'sicbo-roll-0001');
  assert.equal(again.data.replayed, true);
  assert.deepEqual(again.data.round.dice, round.dice);
  assert.equal(again.data.state.user.account.available, res.data.state.user.account.available);
  assert.equal((await h.call('/api/sicbo/roll', { floor: 'high-limit', bets: [{ ...bets[0], stake: 6_000_000 }, ...bets.slice(1)] }, 'sicbo-roll-0001')).data.error, 'IDEMPOTENCY_CONFLICT');
  // Together at least the minimum; each spot under the maximum; whole units.
  const err = async b => (await h.call('/api/sicbo/roll', { floor: 'high-limit', bets: b })).data.error;
  assert.equal(await err([{ betType: 'BIG', stake: 1_000_000 }]), 'BET_OUTSIDE_TABLE_LIMIT');
  assert.equal(await err([{ betType: 'BIG', stake: 200_000_000 }]), 'BET_OUTSIDE_TABLE_LIMIT');
  assert.equal(await err([{ betType: 'BIG', stake: 10_500_000 }]), 'BET_NOT_IN_UNITS');
  assert.equal(await err([{ betType: 'BIG', stake: 200_000_000 }, { betType: 'SMALL', stake: 200_000_000 }]), 'BET_OUTSIDE_TABLE_LIMIT');
});
