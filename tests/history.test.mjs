import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultState } from '../lib/state.mjs';
import { compactHistory, LEDGER_PER_USER } from '../lib/history.mjs';
import { buildSocialCompetitionSnapshot } from '../lib/social-competition.mjs';

const NOW = Date.parse('2026-10-13T03:00:00.000Z');
const ago = days => new Date(NOW - days * 86_400_000).toISOString();
const tx = (userId, days, extra = {}) => ({ id: `tx_${userId}_${days}_${Math.random()}`, userId, type: 'GAME_WIN', amount: 1, qualifiedPnlDelta: 1, rawPnlDelta: 1, referenceType: 'GAME_ROUND', metadata: { stake: 1 }, createdAt: ago(days), ...extra });

test('old ledger rows move to the archive; recent ones, the last 50 per player and admin rows stay', () => {
  const state = defaultState();
  state.ledger = [];
  for (let i = 0; i < 80; i++) state.ledger.push(tx('hanseo', 40 - i * 0.1));
  state.ledger.push(tx('zero', 60), tx('min', 60, { referenceType: 'ADMIN_PANEL' }));
  for (let i = 0; i < 70; i++) state.ledger.push(tx('hanseo', 1));
  const total = state.ledger.length;
  const cold = compactHistory(state, NOW);
  assert.equal(cold.ledger.length + state.ledger.length, total);
  assert.ok(cold.ledger.every(t => Date.parse(t.createdAt) < NOW - 14 * 86_400_000));
  // zero's only row and the admin row survive; hanseo keeps the week's 70 rows.
  assert.ok(state.ledger.some(t => t.userId === 'zero'));
  assert.ok(state.ledger.some(t => t.referenceType === 'ADMIN_PANEL'));
  assert.equal(state.ledger.filter(t => t.userId === 'hanseo').length, 70);
  assert.ok(70 >= LEDGER_PER_USER);
  // Order is kept on both sides.
  assert.deepEqual(state.ledger.map(t => t.createdAt), [...state.ledger.map(t => t.createdAt)].sort());
  assert.equal(state.meta.archived.ledger, cold.ledger.length);
});

test('settled rounds older than a day leave, but open rounds and each game\'s last round stay', () => {
  const state = defaultState();
  state.rounds = [
    { id: 'a', userId: 'hanseo', game: 'Blackjack', status: 'SETTLED', createdAt: ago(3) },
    { id: 'b', userId: 'hanseo', game: 'Blackjack', status: 'SETTLED', createdAt: ago(2) },
    { id: 'c', userId: 'hanseo', game: 'Roulette', status: 'SETTLED', createdAt: ago(5) },
    { id: 'e', userId: 'hanseo', game: "Hold'em", status: 'SETTLED', createdAt: ago(9) },
    { id: 'd', userId: 'hanseo', game: "Hold'em", status: 'SEATED', createdAt: ago(9) },
    { id: 'f', userId: 'hanseo', game: 'Slots', status: 'SETTLED', createdAt: ago(0.1) },
    { id: 'g', userId: 'hanseo', game: 'Slots', status: 'SETTLED', createdAt: ago(0.05) }
  ];
  const cold = compactHistory(state, NOW);
  assert.deepEqual(cold.rounds.map(r => r.id), ['a', 'e']);
  assert.deepEqual(state.rounds.map(r => r.id), ['b', 'c', 'd', 'f', 'g']);
});

test('compaction runs at most once an hour and returns null when nothing is cold', () => {
  const state = defaultState();
  assert.equal(compactHistory(state, NOW), null);
  state.ledger.push(...Array.from({ length: 60 }, () => tx('hanseo', 30)));
  assert.equal(compactHistory(state, NOW + 10 * 60_000), null);
  assert.ok(compactHistory(state, NOW + 61 * 60_000));
});

test('rows inside a running duel stay, and a finished duel keeps its score after its rows leave', () => {
  const state = defaultState();
  state.socialCompetition = { version: 1, rivals: [], challenges: [
    { id: 'live', challengerId: 'hanseo', opponentId: 'zero', status: 'ACTIVE', metric: 'WINS', startsAt: ago(20), endsAt: ago(-1) },
    { id: 'done', challengerId: 'hanseo', opponentId: 'zero', status: 'COMPLETED', metric: 'WINS', winnerId: 'hanseo', startsAt: ago(40), endsAt: ago(33) }
  ] };
  state.ledger = [
    ...Array.from({ length: 60 }, () => tx('hanseo', 35)),
    ...Array.from({ length: 60 }, () => tx('hanseo', 18))
  ];
  const before = buildSocialCompetitionSnapshot(state, 'hanseo').challenges.find(c => c.id === 'done').score;
  assert.equal(before.me, 60);
  const cold = compactHistory(state, NOW);
  assert.equal(cold.ledger.length, 60);
  assert.ok(state.ledger.every(t => Date.parse(t.createdAt) >= NOW - 20 * 86_400_000));
  const after = buildSocialCompetitionSnapshot(state, 'hanseo').challenges.find(c => c.id === 'done').score;
  assert.deepEqual(after, before);
});

test('the Worker keeps the floor in memory and archives cold history in the same save', async () => {
  const src = await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(this\.state\) return this\.state;/);
  assert.match(src, /this\.state = null;/);
  assert.match(src, /compactHistory\(state\)/);
  assert.match(src, /archive:\$\{stamp\}/);
});
