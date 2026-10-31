// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const pub = path => new URL(`../public/${path}`, import.meta.url);
globalThis.window = { matchMedia: () => ({ matches: false }) };
const { handLine, sicboLine, goLine, rouletteLine, betLine, amountWords, OPENS_WITH_BETS } = await import('../public/js/voice.js');
const { HAND_NAMES } = await import('../lib/holdem.mjs');

const files = new Set((await readdir(pub('voice'))).filter(f => f.endsWith('.mp3')).map(f => f.slice(0, -4)));
const listed = JSON.parse(await readFile(pub('voice/lines.json'), 'utf8'));

test('every recorded line is listed for offline caching, and every listed line exists', () => {
  assert.deepEqual([...files].sort(), [...listed].sort());
});

test('every call-out the tables ask for has a recording', async () => {
  const sources = await Promise.all(['app.js', 'js/voice.js', ...['blackjack', 'baccarat', 'roulette', 'dice', 'holdem', 'holdem-view', 'holdem-room', 'matgo', 'seotda'].map(g => `js/games/${g}.js`)].map(p => readFile(pub(p), 'utf8')));
  const asked = new Set();
  // Every quoted id on a line that speaks, picks a line, or lists a table's lines.
  for (const [i, src] of sources.entries()) for (const row of src.split('\n')) {
    const tableList = i === 1 && /^\s+\w+: \['/.test(row);
    const at = tableList ? 0 : Math.max(row.indexOf('voice.say('), row.indexOf('const line ='), row.indexOf('const LINE ='));
    if (at < 0) continue;
    for (const [, id] of row.slice(at).matchAll(/'([a-z][a-z0-9-]*)'/g)) asked.add(id);
  }
  for (const id of ['place-bets', 'no-more-bets', 'your-action', 'your-turn', 'all-in', 'flop', 'turn', 'river']) assert.ok(asked.has(id), `${id} is never called`);
  for (const id of asked) assert.ok(files.has(id), `missing public/voice/${id}.mp3`);
  for (const street of ['FLOP', 'TURN', 'RIVER']) assert.ok(files.has(street.toLowerCase()));
});

test('generated line ids cover every outcome', () => {
  HAND_NAMES.forEach(name => assert.ok(files.has(handLine(name, [])), name));
  assert.equal(handLine('스트레이트 플러시', ['A♠', 'K♠', 'Q♠', 'J♠', '10♠', '2♥', '3♦']), 'royal-flush');
  assert.equal(handLine('스트레이트 플러시', ['9♠', 'K♠', 'Q♠', 'J♠', '10♠', 'A♥', '3♦']), 'hand-8');
  for (let n = 0; n <= 36; n++) assert.ok(files.has(rouletteLine(n)));
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) assert.ok(files.has(sicboLine([a, b, c])), `${a}${b}${c}`);
  for (let n = 1; n <= 5; n++) assert.ok(files.has(goLine(n)));
  assert.equal(goLine(6), null);
  assert.ok(OPENS_WITH_BETS.has('roulette') && !OPENS_WITH_BETS.has('poker'));
});

test('bet amounts are spoken in words from recorded pieces', () => {
  assert.deepEqual(amountWords(250_000), ['two', 'hundred', 'fifty', 'thousand']);
  assert.deepEqual(amountWords(1_250_000), ['one', 'million', 'two', 'hundred', 'fifty', 'thousand']);
  assert.deepEqual(amountWords(17_500), ['seventeen', 'thousand', 'five', 'hundred']);
  assert.deepEqual(amountWords(1e12), ['one', 'trillion']);
  assert.deepEqual(amountWords(0), []);
  assert.deepEqual(betLine('CALL', 50_000), ['n-fifty', 'n-thousand-end'], 'only the amount is spoken');
  assert.deepEqual(betLine('RAISE', 2_000_000), ['n-two', 'n-million-end']);
  assert.equal(betLine('FOLD', 100), null);
  // At a table it says the chips the screen shows: 1,200만 at the 클럽 (30만 a chip) is forty chips.
  assert.deepEqual(betLine('RAISE', 12_000_000, 300_000), ['n-forty-end']);
  assert.deepEqual(betLine('BET', 3_000_000_000, 3_000_000), ['n-one', 'n-thousand-end']);
  // Every amount a table can produce, up to the vault's limits, resolves to recorded pieces.
  for (const n of [1, 19, 20, 99, 101, 999, 5_000, 12_345, 999_999, 1_000_001, 987_654_321, 123_456_789_012, 999_999_999_999_999]) {
    for (const action of ['CALL', 'RAISE', 'BET', 'ALL_IN']) for (const id of betLine(action, n)) assert.ok(files.has(id), `${n}: missing ${id}`);
  }
});

test('my hand is named as the board comes out', async () => {
  const { handName } = await import('../public/js/poker-hand.js');
  assert.equal(handName(['A♠', 'K♠']), '하이카드');
  assert.equal(handName(['5♦', '5♣']), '원페어');
  assert.equal(handName(['3♣', 'Q♣', '3♦', 'Q♥', '8♥']), '투페어');
  assert.equal(handName(['A♠', '2♦', '3♣', '4♥', '5♠', 'K♦']), '스트레이트');
  assert.equal(handName(['2♥', '6♥', '8♥', 'Q♥', 'K♥', 'K♣', 'K♦']), '플러시');
  assert.equal(handName(['3♣', '3♦', '3♥', 'Q♣', 'Q♦']), '풀하우스');
  assert.equal(handName(['10♠', 'J♠', 'Q♠', 'K♠', 'A♠']), '스트레이트 플러시');
});
