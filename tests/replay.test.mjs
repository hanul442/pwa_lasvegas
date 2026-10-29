// 큰 판 다시보기 (2026-10-29): which rounds are kept, and that the list never grows past its cap
// while the biggest wins and losses stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const { keepList, isBigLoss, recordReplay, updateReplay, loadReplays, KEEP, PINNED, BIG_LOSS_AT } = await import('../public/js/replay.js');

test('a loss counts as big at 25 table minimums', () => {
  assert.equal(BIG_LOSS_AT, 25);
  assert.equal(isBigLoss(-25_000_000, 1_000_000), true);
  assert.equal(isBigLoss(-24_000_000, 1_000_000), false);
  assert.equal(isBigLoss(30_000_000, 1_000_000), false);
});

test('the list keeps the newest, but never drops the biggest wins and losses', () => {
  const huge = { at: 1, net: 9e9 }, awful = { at: 2, net: -9e9 };
  const list = [...Array.from({ length: KEEP + 5 }, (_, i) => ({ at: 100 + i, net: i % 2 ? 1e6 : -1e6 })).reverse(), huge, awful];
  const kept = keepList(list);
  assert.equal(kept.length, KEEP);
  assert.ok(kept.includes(huge) && kept.includes(awful));
  assert.equal(kept[0].at, 100 + KEEP + 4); // newest first
  assert.ok(PINNED >= 1);
});

test('a round and its big-win screen make one replay', () => {
  store.clear();
  const groups = [{ who: '딜러', kind: 'card', cards: ['10♠', '7♥'] }, { who: '나', kind: 'card', cards: ['A♠', 'K♠'] }];
  const e = recordReplay({ game: 'blackjack', gameTitle: '블랙잭', tier: 'Gold Room', net: 30_000_000, staked: 10_000_000, min: 1_000_000, label: 'Blackjack', groups });
  updateReplay(e, { title: 'BLACKJACK', groups: [] });
  const list = loadReplays();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'BLACKJACK');
  assert.deepEqual(list[0].groups, groups);
  assert.equal(list[0].level, 1);
  assert.ok(JSON.stringify(list[0]).length < 600, 'a replay is a few hundred bytes');
});

test('every table round ending can leave a replay, and the profile lists them', () => {
  const table = readFileSync(new URL('../public/js/table.js', import.meta.url), 'utf8');
  assert.match(table, /this\.keepReplay\(net, \{ label, staked \}\)/);
  assert.match(table, /this\.keepReplay\(amount, \{ title, force: true \}\)/);
  for (const f of ['seotda', 'holdem-view']) assert.match(readFileSync(new URL(`../public/js/games/${f}.js`, import.meta.url), 'utf8'), /t\.keepReplay\(net/);
  assert.match(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), /replayBlock\(state\)/);
  assert.match(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), /'js\/replay\.js'/);
});
