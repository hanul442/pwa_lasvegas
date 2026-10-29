// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultState } from '../lib/state.mjs';
import { compactHistory, LEDGER_PER_USER } from '../lib/history.mjs';
import { ensureTally, weekTotals } from '../lib/tally.mjs';
import { buildSeasonPerformanceFromLedger } from '../lib/seasons.mjs';
import { weekBoundary, weeklySeason } from '../lib/engagement.mjs';
import { buildSocialCompetitionSnapshot, createChallenge, acceptChallenge } from '../lib/social-competition.mjs';
import { addLedger } from '../lib/economy.mjs';
import { handleApi } from '../lib/api.mjs';
import { forceHotTable } from '../lib/hot-table.mjs';

forceHotTable('off');
const NOW = Date.parse('2026-10-13T03:00:00.000Z');
const HOUR = 3_600_000;
const ago = hours => new Date(NOW - hours * HOUR).toISOString();
let n = 0;
const tx = (userId, hours, extra = {}) => ({ id: `tx_${n++}`, userId, type: 'GAME_WIN', amount: 1, qualifiedPnlDelta: 1, rawPnlDelta: 1, referenceType: 'GAME_ROUND', metadata: { stake: 1, game: 'Roulette' }, createdAt: ago(hours), ...extra });
const bare = () => { const s = defaultState(); s.ledger = []; s.rounds = []; return s; };

test('old ledger rows move to the archive; the last two hours, 50 per player, admin rows and big wins stay', () => {
  const state = bare();
  for (let i = 0; i < 80; i++) state.ledger.push(tx('hanseo', 30 - i * 0.1));
  state.ledger.push(tx('zero', 60), tx('min', 60, { referenceType: 'ADMIN_PANEL' }), tx('june', 50, { rawPnlDelta: 5_000_000_000 }));
  for (let i = 0; i < 70; i++) state.ledger.push(tx('hanseo', 1));
  const total = state.ledger.length;
  const cold = compactHistory(state, NOW);
  assert.equal(cold.ledger.length + state.ledger.length, total);
  assert.equal(cold.ledger.length, 80);
  assert.ok(state.ledger.some(t => t.userId === 'zero'));
  assert.ok(state.ledger.some(t => t.referenceType === 'ADMIN_PANEL'));
  assert.ok(state.ledger.some(t => t.userId === 'june'));
  assert.equal(state.ledger.filter(t => t.userId === 'hanseo').length, 70);
  assert.ok(70 >= LEDGER_PER_USER);
  assert.deepEqual(state.ledger.map(t => t.createdAt), [...state.ledger.map(t => t.createdAt)].sort());
  assert.equal(state.meta.archived.ledger, 80);
});

test('settled rounds leave after two minutes, but open rounds and each game\'s last round stay', () => {
  const state = bare();
  state.rounds = [
    { id: 'a', userId: 'hanseo', game: 'Blackjack', status: 'SETTLED', createdAt: ago(3) },
    { id: 'b', userId: 'hanseo', game: 'Blackjack', status: 'SETTLED', createdAt: ago(2) },
    { id: 'c', userId: 'hanseo', game: 'Roulette', status: 'SETTLED', createdAt: ago(5) },
    { id: 'e', userId: 'hanseo', game: "Hold'em", status: 'SETTLED', createdAt: ago(9) },
    { id: 'd', userId: 'hanseo', game: "Hold'em", status: 'SEATED', createdAt: ago(9) },
    { id: 'f', userId: 'hanseo', game: 'Slots', status: 'SETTLED', createdAt: ago(0.1) },
    { id: 'g', userId: 'hanseo', game: 'Slots', status: 'SETTLED', createdAt: ago(0.01) }
  ];
  const cold = compactHistory(state, NOW);
  assert.deepEqual(cold.rounds.map(r => r.id), ['a', 'e', 'f']);
  assert.deepEqual(state.rounds.map(r => r.id), ['b', 'c', 'd', 'g']);
});

test('compaction runs at most once a minute and returns null when nothing is cold', () => {
  const state = bare();
  assert.equal(compactHistory(state, NOW), null);
  state.ledger.push(...Array.from({ length: 60 }, () => tx('hanseo', 30)));
  assert.equal(compactHistory(state, NOW + 30_000), null);
  assert.ok(compactHistory(state, NOW + 2 * 60_000));
});

test('the weekly ranking reads the same from running totals as from the ledger, also after the rows leave', () => {
  const state = bare();
  const thisWeek = Date.parse(weekBoundary(NOW).startsAt);
  for (let i = 0; i < 40; i++) state.ledger.push(tx(i % 2 ? 'hanseo' : 'zero', (NOW - thisWeek) / HOUR - 1 - i, { type: i % 3 ? 'GAME_WIN' : 'GAME_LOSS', qualifiedPnlDelta: i % 3 ? 7 : -3, rawPnlDelta: i % 3 ? 7 : -3, metadata: { stake: 10 + i, game: 'Roulette' } }));
  const fromLedger = boundary => buildSeasonPerformanceFromLedger(state, boundary);
  const now = weekBoundary(NOW), prev = weekBoundary(NOW - 7 * 24 * HOUR);
  const expectNow = fromLedger(now), expectPrev = fromLedger(prev);
  ensureTally(state, NOW);
  assert.deepEqual(weekTotals(state, now), expectNow);
  assert.deepEqual(weekTotals(state, prev), expectPrev);
  // New rows land in the totals as they are written.
  addLedger(state, state.users.hanseo, { type: 'GAME_WIN', amount: 0, qualifiedPnlDelta: 50, rawPnlDelta: 50, referenceType: 'GAME_ROUND', referenceId: 'r', metadata: { stake: 5, game: 'Roulette' } });
  assert.deepEqual(weekTotals(state, weekBoundary(Date.now())), buildSeasonPerformanceFromLedger(state, weekBoundary(Date.now())));
  compactHistory(state, NOW + 50 * HOUR);
  assert.deepEqual(weekTotals(state, prev), expectPrev);
});

test('a running duel keeps counting from its totals once its rows leave, and a finished one keeps its score', () => {
  const state = bare();
  state.ledger.push(...Array.from({ length: 60 }, () => tx('hanseo', 70)));
  createChallenge(state, 'hanseo', 'zero', 'WINS', { now: ago(100), challengeId: 'live' });
  acceptChallenge(state, 'zero', 'live', { now: ago(80) });
  state.socialCompetition.challenges.push({ id: 'done', challengerId: 'hanseo', opponentId: 'zero', status: 'COMPLETED', metric: 'WINS', winnerId: 'hanseo', startsAt: ago(30 * 24), endsAt: ago(23 * 24) });
  state.ledger.unshift(...Array.from({ length: 5 }, () => tx('hanseo', 25 * 24)));
  const score = id => buildSocialCompetitionSnapshot(state, 'hanseo').challenges.find(c => c.id === id).score;
  assert.equal(score('live').me, 60);
  assert.equal(score('done').me, 5);
  compactHistory(state, NOW);
  assert.ok(state.ledger.length < 60);
  assert.equal(score('live').me, 60);
  assert.equal(score('done').me, 5);
});

test('after real bets the weekly ranking from totals matches the ledger', async () => {
  let state = defaultState();
  state.users.hanseo.account.available = 300_000_000;
  const store = { load: async () => state, mutate: async fn => fn(state) };
  const call = (p, b) => handleApi({ method: 'POST', header: () => undefined, body: async () => b }, new URL(`http://x${p}`), store, { NODE_ENV: 'production' });
  for (let i = 0; i < 30; i++) assert.equal((await call('/api/roulette/play', { stake: 10_000_000, floor: 'high-limit', betType: 'RED' })).status, 200);
  const week = weekBoundary(Date.now());
  assert.deepEqual(weeklySeason(state).performanceByUser, buildSeasonPerformanceFromLedger(state, week));
});

test('the Worker keeps the floor in memory and archives cold history before saving', async () => {
  const src = await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(this\.state\) return Promise\.resolve\(this\.state\);/);
  assert.match(src, /this\.reading \?\?= this\.readStorage\(\)/);
  assert.match(src, /this\.state = null;/);
  assert.match(src, /compactHistory\(state\)/);
  assert.match(src, /archive:\$\{stamp\}/);
});
