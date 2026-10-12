import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.window = { matchMedia: () => ({ matches: false }) };
const { settings, pace, DEFAULTS } = await import('../public/js/settings.js');
const { ms, reducedMotion } = await import('../public/js/fx.js');
const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');

test('pace setting scales every animation and minimal behaves like reduced motion', () => {
  assert.equal(pace(), 'normal');
  assert.equal(ms(400), 400);
  settings.set('pace', 'fast');
  assert.ok(ms(400) < 400);
  settings.set('pace', 'minimal');
  assert.equal(reducedMotion(), true);
  assert.ok(ms(400) <= 60);
  settings.reset();
  assert.equal(pace(), 'normal');
});

test('settings persist on this device and reset back to defaults', () => {
  settings.set('music', 25);
  assert.equal(JSON.parse(store.get('vegas:settings')).music, 25);
  settings.reset();
  assert.equal(settings.get('music'), DEFAULTS.music);
  assert.equal(store.has('vegas:settings'), false);
});

test('settings are a full surface reachable from the top bar and from every table', async () => {
  const html = await read('index.html');
  const app = await read('app.js');
  const sw = await read('sw.js');
  assert.match(html, /data-surface="settings"/);
  assert.match(html, /data-nav="settings"/);
  assert.match(app, /attachQuickSettings\(activeTable\)/);
  for (const f of ['js/settings.js', 'js/settings-panel.js']) assert.match(sw, new RegExp(f.replace('.', '\\.')));
});

test('baccarat squeeze is on by default, can be switched off, and ships in the offline shell', async () => {
  assert.equal(DEFAULTS.bacSqueeze, true);
  const sw = await read('sw.js');
  const panel = await read('js/settings-panel.js');
  const bac = await read('js/games/baccarat.js');
  assert.match(sw, /'js\/squeeze\.js'/);
  assert.match(panel, /toggle\('bacSqueeze'/);
  assert.match(bac, /from '\.\.\/squeeze\.js'/);
  // The squeeze only presents: the round still comes from the server before any card is peeled.
  assert.ok(bac.indexOf('api.baccarat(') < bac.indexOf('await squeeze('));
});
