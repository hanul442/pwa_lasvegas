// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { addLedger } from '../lib/economy.mjs';
import { noteVisit, visitDue, usageReport } from '../lib/usage.mjs';

const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };
const T = Date.parse('2027-03-24T12:00:00+09:00'), DAY = 86_400_000;

test('each day counts who came and how many rounds of which game, demo players left out', () => {
  const state = defaultState();
  const a = at(T - 2 * DAY, () => newUser(state, 'a', 'A'));
  const b = newUser(state, 'b', 'B');
  b.createdAt = new Date(T).toISOString();
  at(T - DAY, () => addLedger(state, a, { type: 'ADMIN_GRANT', amount: 1e8 }));
  at(T - DAY, () => addLedger(state, a, { type: 'GAME_WIN', amount: 1e6, metadata: { game: 'Blackjack', stake: 1e6 } }));
  at(T, () => {
    addLedger(state, a, { type: 'GAME_LOSS', amount: -1e6, metadata: { game: 'Blackjack', stake: 1e6 } });
    addLedger(state, a, { type: 'GAME_LOSS', amount: -1e6, metadata: { game: 'Roulette', stake: 1e6 } });
    addLedger(state, state.users.min, { type: 'GAME_LOSS', amount: -1e6, metadata: { game: 'Roulette', stake: 1e6 } });
  });
  assert.equal(visitDue(b, T), true);
  noteVisit(state, b, T);
  assert.equal(visitDue(b, T + 60_000), false, 'once a day');
  assert.equal(visitDue(state.users.min, T), false, 'demo players never count');
  const r = usageReport(state, T);
  assert.equal(r.totals.today, 2);
  assert.equal(r.totals.roundsToday, 2);
  assert.equal(r.daily.at(-1).signups, 1);
  assert.equal(r.daily.at(-1).active, 2);
  assert.deepEqual(r.games.map(g => g.game).sort(), ['Blackjack', 'Roulette']);
  assert.ok(!r.players.some(p => ['min', 'june', 'zero'].includes(p.id)));
  assert.equal(r.players[0].id === 'a' || r.players[0].id === 'b', true);
});

test('only the operator can read 이용 현황, and a first look of the day is counted', async () => {
  const { handleApi } = await import('../lib/api.mjs');
  let state = defaultState();
  const store = { load: async () => structuredClone(state), mutate: async fn => { const s = structuredClone(state); const out = await fn(s); state = s; return out; } };
  const call = (path, user) => handleApi({ method: 'GET', header: n => (n === 'x-player-id' ? user : null), body: async () => ({}) }, new URL(`http://x${path}`), store, {});
  await call('/api/state', 'hanseo');
  assert.ok(state.users.hanseo.seen?.day);
  const ok = await call('/api/admin/usage', 'hanseo');
  assert.equal(ok.status, 200);
  assert.ok(ok.data.totals.today >= 1);
  const no = await call('/api/admin/usage', 'min');
  assert.notEqual(no.status, 200);
});
