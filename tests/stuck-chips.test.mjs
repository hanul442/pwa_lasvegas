// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRoom, joinRoom, leaveRoom, startRoom, sweepRooms, TURN_MS, NEXT_HAND_MS } from '../lib/table-room.mjs';
import { validateRoomStake } from '../lib/stakes.mjs';
import { FLOORS } from '../lib/constants.mjs';
import { defaultState } from '../lib/state.mjs';
import { supportStatus, WELFARE_BELOW } from '../lib/engagement.mjs';
import { openRoundsView } from '../lib/open-rounds.mjs';

function seeded(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const validateStake = (user, floor, stake) => validateRoomStake(user, FLOORS.find(f => f.slug === floor), stake);

// Reported 2026-10-17: players got up from a friends' 섯다 hand and the others closed the app.
// Nobody polled the room again, so the hand never ended and the chips stayed on the table: the
// wallet read 0원 while the bank counted them, and 구제금융 said "대상 아님".
test('a hand everyone stopped watching still finishes and gives the chips back', () => {
  const state = defaultState();
  for (const uid of ['hanseo', 'min']) state.users[uid].account.available = 50_000_000;
  let now = 1_000_000;
  const rand = seeded(Number(process.env.STUCK_SEED || 3));
  const ctx = () => ({ now, rand, validateStake });
  const room = createRoom(state, state.users.hanseo, { game: 'seotda', stake: 5_000_000, floor: 'gold-room', size: 2 }, ctx());
  joinRoom(state, state.users.min, room.code, ctx());
  startRoom(state, state.users.hanseo, room.code, ctx());
  assert.ok(state.users.hanseo.account.locked > 0, 'the deposit is on the table');
  leaveRoom(state, state.users.hanseo, room.code, ctx());
  // min closes the app: no more polls. hanseo's chips are still locked, in a room they left.
  assert.ok(state.users.hanseo.account.locked > 0);
  assert.ok(openRoundsView(state, state.users.hanseo).some(r => r.left), 'the bank can say where the chips are');
  for (let i = 0; i < 40 && state.users.hanseo.account.locked > 0; i++) { now += TURN_MS + NEXT_HAND_MS; sweepRooms(state, { now, rand }); }
  assert.equal(state.users.hanseo.account.locked, 0, 'the hand played out and settled');
});

test('구제금융 says why a player with chips on a table does not qualify yet', () => {
  const user = defaultState().users.hanseo;
  user.account.available = 0; user.account.locked = 5_000_000;
  const w = supportStatus(user).welfare;
  assert.equal(w.qualified, false);
  assert.equal(w.reason, 'TABLE');
  assert.equal(w.onTable, 5_000_000);
  user.account.locked = 0; user.account.available = WELFARE_BELOW;
  assert.equal(supportStatus(user).welfare.reason, 'CHIPS');
  user.account.available = 0;
  assert.equal(supportStatus(user).welfare.qualified, true);
  assert.equal(supportStatus(user).welfare.reason, null);
});

test('every state change sweeps the friends tables first', async () => {
  const api = await readFile(new URL('../lib/api.mjs', import.meta.url), 'utf8');
  assert.match(api, /export function prepareState\(state\)\{[^}]*sweepTables\(state\);\}/);
  assert.match(api, /prepareState\(state\);const r=await fn\(state\)/);
});

test('the bank and the top bar show chips on a table apart from the wallet', async () => {
  const [bank, app, html] = await Promise.all(['js/bank.js', 'app.js', 'index.html'].map(p => readFile(new URL(`../public/${p}`, import.meta.url), 'utf8')));
  assert.match(bank, /테이블에 걸린 칩/);
  assert.match(bank, /reason === 'TABLE'/);
  assert.match(html, /data-wallet-held/);
  assert.match(app, /walletHeld/);
});
