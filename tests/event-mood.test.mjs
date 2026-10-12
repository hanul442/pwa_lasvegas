import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');

test('event tables switch the music to the noir theme and back', async () => {
  const app = await read('app.js');
  const music = await read('js/music.js');
  assert.match(app, /music\.theme\(selectedGame\.event \? 'noir' : 'lounge'\)/);
  assert.match(app, /voice\.hush\(\);\n  music\.theme\('lounge'\)/, 'leaving a table brings the big band back');
  assert.match(music, /function scheduleNoirBar/);
  assert.match(music, /theme\(name\)/);
});

test('the dealer never falls behind the bots, and bots speak one at a time', async () => {
  const voice = await read('js/voice.js');
  const view = await read('js/games/holdem-view.js');
  const npc = await read('js/npc.js');
  assert.match(voice, /if \(drop && this\.busy\) return;/);
  assert.doesNotMatch(view, /voice\.idle/, 'the table never waits on the dealer\'s voice');
  assert.match(view, /voice\.say\(betLine\(ev\.action, ev\.bet\), \{ next: true \}\)/, 'every bet is read with its size, newest first');
  assert.match(view, /quietUntil/);
  assert.match(npc, /quietUntil/);
});

test('events live in their own tab, out of the game lists', async () => {
  const html = await read('index.html');
  const app = await read('app.js');
  assert.match(html, /data-nav="events">이벤트</);
  assert.match(html, /data-surface="events"/);
  assert.match(app, /GAMES\.filter\(g => !g\.event\)/);
  assert.match(app, /if \(name === 'events'\) renderEventTab\(\)/);
});
