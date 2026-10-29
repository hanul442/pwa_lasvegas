// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
const clientFiles = async () => {
  const out = ['app.js'];
  for (const dir of ['js', 'js/games']) for (const f of await readdir(new URL(`../public/${dir}/`, import.meta.url))) if (f.endsWith('.js')) out.push(`${dir}/${f}`);
  return out;
};

test('the client economy matches the server, so a new tab does not reload and drop the pay sheet', async () => {
  const { ECONOMY_VERSION } = await import('../lib/economy-upgrade.mjs');
  const api = await read('js/api.js');
  assert.equal(Number(api.match(/export const ECONOMY = (\d+);/)[1]), ECONOMY_VERSION);
});

test('every client module is in the offline shell', async () => {
  const sw = await read('sw.js');
  for (const f of await clientFiles()) assert.match(sw, new RegExp(`'${f.replace('.', '\\.')}'`), f);
});

test('no native alert() popups in the client', async () => {
  for (const f of await clientFiles()) assert.doesNotMatch(await read(f), /(^|[^.\w])alert\(/, f);
});

test('one Korean name per game, from ids and from server labels', async () => {
  const { gameName } = await import('../public/js/names.js');
  assert.equal(gameName('dice'), '식보');
  assert.equal(gameName('Sic Bo'), '식보');
  assert.equal(gameName('poker'), '홀덤');
  assert.equal(gameName('holdem'), '홀덤');
  assert.equal(gameName("Hold'em"), '홀덤');
  assert.equal(gameName('slots'), '슬롯');
  for (const f of ['js/games/dice.js', 'js/games/slots.js', 'js/games/roulette.js', 'js/games/baccarat.js', 'js/games/blackjack.js', 'js/games/holdem.js']) {
    assert.doesNotMatch(await read(f), /title: (?:ev \? ev\.title : )?'(?:Sic Bo|Slots|Roulette|Baccarat|Blackjack)'/, f);
  }
  const html = await read('index.html');
  assert.doesNotMatch(html, /게임 머니|포인트/);
});

test('ledger rows sort into 게임, 보너스 and 은행', async () => {
  globalThis.window ??= { matchMedia: () => ({ matches: false }) };
  const { ledgerKind } = await import('../public/js/ledger.js');
  assert.equal(ledgerKind({ type: 'GAME_WIN', metadata: { game: 'Slots' } }), 'game');
  assert.equal(ledgerKind({ type: 'BET_LOCK' }), 'game');
  assert.equal(ledgerKind({ type: 'DAILY_BONUS' }), 'bonus');
  assert.equal(ledgerKind({ type: 'WELFARE' }), 'bonus');
  assert.equal(ledgerKind({ type: 'LOAN_DISBURSE' }), 'bank');
  assert.equal(ledgerKind({ type: 'BANKRUPTCY_SEIZURE' }), 'bank');
});

test('instant rounds reuse their idempotency key on retry and slots auto-spin stops on its own', async () => {
  const table = await read('js/table.js');
  assert.match(table, /roundKey\(/);
  assert.match(table, /if \(this\.pendingRound\?\.fp !== fp\)/);
  for (const [f, call] of [['js/games/slots.js', 'api.slots'], ['js/games/dice.js', 'api.sicboRoll'], ['js/games/roulette.js', 'api.rouletteSpin'], ['js/games/baccarat.js', 'api.baccarat']]) {
    const src = await read(f);
    assert.match(src, /t\.roundKey\(/, f);
    assert.match(src, new RegExp(`${call.replace('.', '\\.')}\\([^;]*key[,)]`), f);
  }
  const slots = await read('js/games/slots.js');
  for (const stop of ['isBigWin', "addEventListener('pointerdown'", 'visibilitychange', 't.available < stake']) assert.ok(slots.includes(stop), stop);
});

test('the push ask waits for the pay sheet and a first round, and never opens "blocked" on its own', async () => {
  const notify = await read('js/notify.js');
  assert.match(notify, /if \(!user && \(state === 'blocked' \|\| !isReady\(\)\)\) return;/);
  const app = await read('app.js');
  assert.match(app, /askReady = \(\) => Boolean\(state\) && !dailyDue\(state\)/);
});
