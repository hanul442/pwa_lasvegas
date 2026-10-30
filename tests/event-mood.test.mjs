// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');

test('event tables switch the music to the noir theme and back', async () => {
  const app = await read('app.js');
  const music = await read('js/music.js');
  assert.match(app, /music\.theme\(selectedGame\.event \? 'noir' : selectedGame\.id\)/);
  assert.match(app, /voice\.hush\(\);\n  music\.theme\('lounge'\)/, 'leaving a table brings the big band back');
  assert.match(music, /function scheduleNoirBar/);
  assert.match(music, /theme\(name\)/);
});

test('the lobby and every game have their own music', async () => {
  const app = await read('app.js');
  const music = await read('js/music.js');
  const themes = music.slice(music.indexOf('const THEMES = {'));
  const games = [...app.matchAll(/^  \{ id: '(\w+)', name:/gm)].map(m => m[1]);
  assert.ok(games.length >= 9, 'found the game list');
  for (const id of ['lounge', 'noir', ...games]) assert.match(themes, new RegExp(`\\n  ${id}: \\{ tempo: \\d+, bar:`), `${id} has a theme`);
  assert.match(music, /if \(!THEMES\[name\]\) name = 'lounge';/, 'an unknown game falls back to the lobby band');
});

test('the dealer never falls behind the bots, and bots speak one at a time', async () => {
  const voice = await read('js/voice.js');
  const view = await read('js/games/holdem-view.js');
  const npc = await read('js/npc.js');
  assert.match(voice, /if \(drop && this\.busy\) return;/);
  assert.doesNotMatch(view, /voice\.idle/, 'the table never waits on the dealer\'s voice');
  assert.match(view, /ev\.action === 'BET' \|\| ev\.action === 'RAISE'\) voice\.say\(betLine\(ev\.action, ev\.bet\), \{ next: true \}\)/, 'only a new size is read, newest first; calls go unsaid');
  assert.match(view, /quietUntil/);
  assert.match(npc, /quietUntil/);
});

test('events live in their own tab, out of the game lists', async () => {
  const html = await read('index.html');
  const app = await read('app.js');
  assert.match(html, /class="subtab" type="button" data-nav="events">이벤트</);
  assert.match(html, /data-surface="events"/);
  assert.match(app, /GAMES\.filter\(g => !g\.event\)/);
  assert.match(app, /if \(name === 'events'\) renderEventTab\(\)/);
});

test('events end on their own victory and defeat screens', async () => {
  const result = await read('js/event-result.js');
  const holdem = await read('js/games/holdem.js');
  const streak = await read('js/event-table.js');
  const gostop = await read('js/games/gostop.js');
  for (const id of ['royale', 'whale', 'rounders', 'oceans', 'montecarlo', 'tazza']) assert.match(result, new RegExp(`\\b${id}: \\{ win:`), id);
  assert.match(holdem, /await eventResult\(\{ event, win: won/, 'a tournament ends on the event screen, won or lost');
  assert.match(streak, /eventResult\(\{ event: ev\.id, win: true/);
  assert.match(gostop, /if \(tazzaWin\) await eventResult/);
});
