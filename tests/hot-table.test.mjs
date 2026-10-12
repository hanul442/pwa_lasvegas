import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { HOT_GAMES, HOT_BONUS, HOT_WINDOW, hotGameOfHour, hotTableAt, nextHotTable, hotTableView, hotTableBonus, forceHotTable } from '../lib/hot-table.mjs';
import { settleHouseGame, settleLockedHouseGame, lockBet, addLedger } from '../lib/economy.mjs';
import { defaultState } from '../lib/state.mjs';
import { handleApi } from '../lib/api.mjs';
import { claimDaily } from '../lib/engagement.mjs';
import { messageFor, planPushes, subscribe } from '../lib/notifications.mjs';
import { b64url } from '../lib/webpush.mjs';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const H0 = Math.floor(Date.parse('2026-10-14T00:00:00Z') / HOUR);
// The first hour from H0 whose hot table is `key`, and a moment `min` minutes into it.
const hourOf = key => { for (let h = H0; ; h++) if (hotGameOfHour(h).key === key) return h; };
const at = (key, min = 3) => hourOf(key) * HOUR + min * 60_000;
// Runs fn with the clock stopped at `now` (the settlement path reads Date.now()).
async function frozen(now, fn) {
  const real = Date.now;
  Date.now = () => now;
  try { return await fn(); } finally { Date.now = real; }
}
// The same chain check as scripts/verify-ledger.mjs: every row starts where the last one ended,
// and the account matches the end of its chain.
function assertLedger(state) {
  for (const user of Object.values(state.users)) {
    let available = 0, locked = 0;
    for (const tx of state.ledger.filter(x => x.userId === user.id)) {
      assert.equal(tx.availableBefore, available, `${user.id} ${tx.type} chain`);
      assert.equal(tx.lockedBefore ?? locked, locked, `${user.id} ${tx.type} locked chain`);
      assert.equal(tx.availableAfter, tx.availableBefore + tx.amount);
      available = tx.availableAfter; locked = tx.lockedAfter ?? locked;
    }
    assert.equal(user.account.available, available, `${user.id} available`);
    assert.equal(user.account.locked, locked, `${user.id} locked`);
  }
}

test('the schedule follows the clock alone: one listed game per hour, ten minutes from :00', () => {
  forceHotTable(null);
  const keys = new Set(HOT_GAMES.map(g => g.key));
  const seen = new Set();
  for (let h = H0; h < H0 + 24 * 14; h++) {
    const g = hotGameOfHour(h);
    assert.ok(keys.has(g.key), g.key);
    assert.deepEqual(hotGameOfHour(h), g); // same answer every time, on any runtime
    if (h % 24) assert.notEqual(hotGameOfHour(h - 1).key, g.key, 'never the same game two hours running within a day');
    seen.add(g.key);
    const start = h * HOUR;
    const w = hotTableAt(start);
    assert.equal(w.game, g.key);
    assert.equal(w.startsAt, start);
    assert.equal(w.endsAt, start + HOT_WINDOW);
    assert.equal(hotTableAt(start + HOT_WINDOW - 1)?.game, g.key);
    assert.equal(hotTableAt(start + HOT_WINDOW), null);
    assert.equal(hotTableAt(start - 1)?.game ?? null, null);
    assert.equal(nextHotTable(start + 1).startsAt, start + HOUR);
  }
  assert.deepEqual([...seen].sort(), [...keys].sort(), 'every listed game gets its turn');
  assert.equal(HOT_WINDOW, 10 * 60_000);
  for (const g of ['matgo', 'gostop', 'seotda', 'poker', 'holdem']) assert.ok(!keys.has(g));
});

test('the state view carries the hot table now and the next one', () => {
  const now = at('roulette');
  const view = hotTableView(now);
  assert.equal(view.hotTable.game, 'roulette');
  assert.equal(view.hotTable.bonus, HOT_BONUS);
  assert.equal(Date.parse(view.hotTable.endsAt), hourOf('roulette') * HOUR + HOT_WINDOW);
  assert.equal(Date.parse(view.hotNext.startsAt), hourOf('roulette') * HOUR + HOUR);
  const cold = hotTableView(now + 20 * 60_000);
  assert.equal(cold.hotTable, null);
  assert.ok(Date.parse(cold.hotNext.startsAt) > now);
});

test('the bonus pays only wins, only at the hot game, only inside its window, up to the stake', () => {
  const now = at('baccarat');
  const s = 10_000_000;
  assert.equal(hotTableBonus('Baccarat', s, s, now), s * HOT_BONUS);
  assert.equal(hotTableBonus('Baccarat', s, 9_500_000, now), 5_000_000); // whole 100만s
  assert.equal(hotTableBonus('Baccarat', s, 80_000_000, now), s); // never more than the stake
  assert.equal(hotTableBonus('Baccarat', s, 0, now), 0);
  assert.equal(hotTableBonus('Baccarat', s, -s, now), 0);
  assert.equal(hotTableBonus('Roulette', s, s, now), 0);
  assert.equal(hotTableBonus('Baccarat', s, s, now + HOT_WINDOW), 0);
  assert.equal(hotTableBonus('Baccarat', s, s, hourOf('baccarat') * HOUR - 1), 0);
});

test('settlement adds the bonus to the winning row, house-funded, and the ledger still chains', async () => {
  forceHotTable(null);
  const state = defaultState(), u = state.users.hanseo;
  const start = u.account.available, s = 10_000_000;
  await frozen(at('dice'), () => {
    const win = settleHouseGame(state, u, { game: 'Sic Bo', stake: s, netPnl: s, roundId: 'r1', hot: true });
    assert.equal(win.type, 'GAME_WIN');
    assert.equal(win.amount, s + s * HOT_BONUS);
    assert.deepEqual(win.metadata.hotTable, { bonus: s * HOT_BONUS, rate: HOT_BONUS });
    const loss = settleHouseGame(state, u, { game: 'Sic Bo', stake: s, netPnl: -s, roundId: 'r2', hot: true });
    assert.equal(loss.amount, -s);
    assert.equal(loss.metadata.hotTable, undefined);
    const push = settleHouseGame(state, u, { game: 'Sic Bo', stake: s, netPnl: 0, roundId: 'r3', hot: true });
    assert.equal(push.type, 'GAME_PUSH');
    assert.equal(push.amount, 0);
    // A round that does not opt in (event tables, rooms, other games) settles as before.
    assert.equal(settleHouseGame(state, u, { game: 'Sic Bo', stake: s, netPnl: s, roundId: 'r4' }).amount, s);
    assert.equal(settleHouseGame(state, u, { game: 'Roulette', stake: s, netPnl: s, roundId: 'r5', hot: true }).amount, s);
    // The locked path: the stake comes back with the win and the bonus.
    lockBet(state, u, { stake: s, game: 'Sic Bo', roundId: 'r6' });
    const locked = settleLockedHouseGame(state, u, { game: 'Sic Bo', stake: s, netPnl: s, roundId: 'r6', hot: true });
    assert.equal(locked.amount, 2 * s + s * HOT_BONUS);
    assert.equal(locked.lockedAfter, 0);
  });
  // Outside the window the same win is plain.
  await frozen(at('dice', 12), () => {
    assert.equal(settleHouseGame(state, u, { game: 'Sic Bo', stake: s, netPnl: s, roundId: 'r7', hot: true }).metadata.hotTable, undefined);
  });
  assert.equal(u.account.available, start + 2 * s * HOT_BONUS + 4 * s); // bonuses on r1 and r6 only
  assert.equal(u.stats['Sic Bo'].pnl, u.account.available - start - s); // r5 went to Roulette
  assertLedger(state);
});

function memoryStore() {
  let state = defaultState();
  // Down to 3억, through the ledger, so a 1천만 table is open and the chain stays whole.
  const u = state.users.hanseo;
  addLedger(state, u, { type: 'ADMIN_ADJUST', amount: 300_000_000 - u.account.available });
  return { peek: () => state, load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
}
const call = (store, method, path, body, key) =>
  handleApi({ method, header: n => (n === 'x-idempotency-key' ? key : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('over the API: the hot game pays winners more, reports it on the round, and the state shows the window', async () => {
  forceHotTable(null);
  const store = memoryStore(), s = 10_000_000;
  let wins = 0, losses = 0;
  await frozen(at('roulette'), async () => {
    const st = await call(store, 'GET', '/api/state');
    assert.equal(st.data.hotTable.game, 'roulette');
    assert.ok(st.data.hotNext.startsAt > st.data.hotTable.startsAt);
    for (let i = 0; i < 60 && !(wins && losses); i++) {
      const before = store.peek().users.hanseo.account.available;
      const res = await call(store, 'POST', '/api/roulette/spin', { floor: 'high-limit', bets: [{ betType: 'RED', stake: s }] }, `hot-table-key-${String(i).padStart(4, "0")}`);
      assert.equal(res.status, 200, JSON.stringify(res.data));
      const { netPnl, hotTable } = res.data.round;
      const after = res.data.state.user.account.available;
      if (netPnl > 0) { wins++; assert.deepEqual(hotTable, { bonus: s * HOT_BONUS, rate: HOT_BONUS }); assert.equal(after, before + netPnl + s * HOT_BONUS); }
      else { losses++; assert.equal(hotTable, undefined); assert.equal(after, before + netPnl); }
      // A replay returns the same round and pays nothing twice.
      const again = await call(store, 'POST', '/api/roulette/spin', { floor: 'high-limit', bets: [{ betType: 'RED', stake: s }] }, `hot-table-key-${String(i).padStart(4, "0")}`);
      assert.equal(again.data.replayed, true);
      assert.deepEqual(again.data.round.hotTable, hotTable);
      assert.equal(again.data.state.user.account.available, after);
    }
    // Sic Bo is not the hot game this hour: a win there pays as usual.
    for (let i = 0; i < 40; i++) {
      const res = await call(store, 'POST', '/api/sicbo/play', { stake: s, floor: 'high-limit', betType: 'BIG' }, `cold-table-key-${String(i).padStart(4, "0")}`);
      assert.equal(res.data.round.hotTable, undefined);
    }
  });
  assert.ok(wins && losses, 'saw both a win and a loss');
  assertLedger(store.peek());
});

// ---------- the push ----------
const kst = (h, d = 0) => Date.parse('2026-10-14T00:00:00Z') - 9 * HOUR + h * HOUR + d * DAY;
function subscribedPlayer(lastSeen) {
  const state = defaultState(), u = state.users.hanseo;
  u.createdAt = new Date(lastSeen - 30 * DAY).toISOString();
  state.ledger = state.ledger.map(t => ({ ...t, createdAt: new Date(lastSeen - 30 * DAY).toISOString() }));
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  subscribe(state, u, { endpoint: `https://push.example.com/send/${crypto.randomUUID()}`, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)) } }, lastSeen);
  return { state, u };
}

test('a hot table push goes out on the hourly tick, at most once a day, within the usual rules', () => {
  forceHotTable(null);
  // Today's pay already collected early in the morning, so the morning reminder has nothing to say.
  const { state, u } = subscribedPlayer(kst(7));
  claimDaily(state, u, kst(7));
  state.ledger.forEach(t => { t.createdAt = new Date(kst(7)).toISOString(); });
  assert.equal(messageFor(state, u, kst(3)), null, 'never at night');
  assert.equal(messageFor(state, u, kst(10)), null, 'not before 11');
  const first = planPushes(state, kst(12) + 30_000);
  assert.equal(first.length, 1);
  assert.equal(first[0].message.tag, 'hot-table');
  const hot = hotTableAt(kst(12));
  assert.match(first[0].message.title, new RegExp(`${hot.label} \\+50%`));
  assert.equal(planPushes(state, kst(13) + 30_000).length, 0, 'once a day');
  // A tick that runs late in the window keeps quiet.
  const late = subscribedPlayer(kst(7));
  claimDaily(late.state, late.u, kst(7));
  late.state.ledger.forEach(t => { t.createdAt = new Date(kst(7)).toISOString(); });
  assert.equal(messageFor(late.state, late.u, kst(12) + 6 * 60_000), null);
  assert.equal(messageFor(late.state, late.u, kst(12) + 20 * 60_000), null, 'between windows');
  // A day that already had the morning reminder gets no hot push: still two a day at most.
  const morning = subscribedPlayer(kst(8, -1));
  assert.equal(planPushes(morning.state, kst(10))[0].message.tag, 'daily');
  for (let h = 11; h < 22; h++) assert.equal(messageFor(morning.state, morning.u, kst(h) + 30_000)?.slot === 'hot', false);
  // Someone at the tables right now hears nothing.
  const playing = subscribedPlayer(kst(12) - 10 * 60_000);
  claimDaily(playing.state, playing.u, kst(12) - 10 * 60_000);
  assert.equal(messageFor(playing.state, playing.u, kst(12) + 30_000), null);
});
