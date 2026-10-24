import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openRoundsView } from '../lib/open-rounds.mjs';

const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');

test('open rounds name the screen and table that resume them', () => {
  const user = { id: 'u1' };
  const state = {
    rounds: [
      { id: 'r1', userId: 'u1', game: 'Blackjack', status: 'PLAYING', floor: 'gold-room', stake: 2_000_000 },
      { id: 'r2', userId: 'u1', game: 'Matgo', status: 'PLAYING', venue: 'high-limit', floor: 3, deposit: 40_000_000 },
      { id: 'r3', userId: 'u1', game: "Hold'em", status: 'SEATED', floor: 'sky-lounge', buyIn: 9, royale: { event: 'royale' } },
      { id: 'r4', userId: 'u1', game: 'Roulette', status: 'SETTLED', floor: 'gold-room', stake: 1 },
      { id: 'r5', userId: 'u2', game: 'Blackjack', status: 'PLAYING', floor: 'gold-room', stake: 1 },
      { id: 'r6', userId: 'u1', game: 'Gostop', status: 'SETTLED', venue: 'gold-room', deposit: 1 }
    ]
  };
  const open = openRoundsView(state, user);
  assert.deepEqual(open.map(r => [r.game, r.floor, r.locked]), [['blackjack', 'gold-room', 2_000_000], ['matgo', 'high-limit', 40_000_000], ['royale', 'sky-lounge', 9]]);
});

test('home offers the last table, a resume notice and a table switcher', async () => {
  const [app, html, table, sw, nav] = await Promise.all(['app.js', 'index.html', 'js/table.js', 'sw.js', 'js/table-nav.js'].map(read));
  assert.match(app, /다시 앉기 · \$\{recent\.game\.name\}/);
  assert.match(html, /data-resume/);
  assert.match(app, /진행 중인 판이 있어요 · 이어하기/);
  assert.match(app, /quickTier\(game\)/, 'one open table skips the tier picker');
  assert.match(nav, /vegas:recent-tables/);
  assert.match(nav, /vegas:last-tier:/);
  assert.match(table, /onSwitch/);
  assert.match(sw, /'js\/table-nav\.js'/);
});
