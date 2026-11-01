// 맞고/고스톱 losses past the 10-point deposit (2026-10-29, 한서 "보증금 오바되는 금액은 빚으로
// 생기거나 지갑에서 더 가져가거나 하지를 않아서 좀 유리해 보인다"): the overflow comes out of
// the table chips, then the wallet, as far as they go. No debt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser } from '../lib/state.mjs';
import { lockBet, settleLockedHouseGame } from '../lib/economy.mjs';
import { chargeOverDeposit } from '../lib/cashier.mjs';

const M = 1_000_000;
function seated({ chips, wallet }) {
  const state = defaultState();
  const user = newUser(state, 'tester', 'TESTER');
  user.account.available = chips;
  user.account.wallet = wallet;
  user.account.locked = 0;
  user.account.seat = { floor: 'gold', at: new Date().toISOString() };
  return { state, user };
}

function play(state, user, { deposit, net }) {
  const roundId = `r-${Math.random()}`;
  lockBet(state, user, { stake: deposit, game: 'Matgo', roundId });
  const out = chargeOverDeposit(state, user, { net, locked: deposit, game: 'Matgo', roundId });
  settleLockedHouseGame(state, user, { game: 'Matgo', stake: out.locked, netPnl: out.net, roundId });
  return out;
}

const total = u => u.account.available + u.account.locked + u.account.wallet;

test('a loss inside the table chips leaves the wallet alone', () => {
  const { state, user } = seated({ chips: 50 * M, wallet: 500 * M });
  const out = play(state, user, { deposit: 10 * M, net: -30 * M });
  assert.equal(out.net, -30 * M);
  assert.equal(user.account.available, 20 * M);
  assert.equal(user.account.wallet, 500 * M);
});

test('a loss past the table chips takes the rest from the wallet', () => {
  const { state, user } = seated({ chips: 20 * M, wallet: 500 * M });
  const before = total(user);
  const out = play(state, user, { deposit: 10 * M, net: -80 * M });
  assert.equal(out.net, -80 * M, 'the whole bill is paid');
  assert.equal(total(user), before - 80 * M);
  assert.equal(user.account.available, 0);
  assert.equal(user.account.wallet, 440 * M);
  assert.equal(user.account.locked, 0);
});

test('with table chips and wallet both short, the player pays everything and no debt is made', () => {
  const { state, user } = seated({ chips: 20 * M, wallet: 30 * M });
  const out = play(state, user, { deposit: 10 * M, net: -200 * M });
  assert.equal(out.net, -50 * M);
  // Everything went, so it is a bust (the day's 구제금융 may pay straight back in).
  assert.equal(user.bankruptcies?.length, 1);
  assert.ok(!(user.account.debt > 0) && !(user.loans?.length));
});

test('a win is untouched', () => {
  const { state, user } = seated({ chips: 20 * M, wallet: 30 * M });
  const out = play(state, user, { deposit: 10 * M, net: 120 * M });
  assert.equal(out.net, 120 * M);
  assert.equal(user.account.wallet, 30 * M);
  assert.equal(user.account.available, 140 * M);
});

// Friends' 맞고: two people, each sitting with only the deposit in table chips and money left in
// the wallet. Whoever loses big pays the whole bill from the wallet, so the winner gets all of it.
test('맞고 room: a loss past the table chips is paid from the wallet and the winner gets it all', async () => {
  const { createRoom, joinRoom, startRoom, roomAction, tick, NEXT_HAND_MS } = await import('../lib/table-room.mjs');
  const { matgoAiDecision } = await import('../lib/matgo.mjs');
  const { validateRoomStake } = await import('../lib/stakes.mjs');
  const { FLOORS } = await import('../lib/constants.mjs');
  const floor = FLOORS[0], stake = floor.minBet, deposit = stake * 10;
  const state = defaultState();
  const a = newUser(state, 'pa', 'PA'), b = newUser(state, 'pb', 'PB');
  for (const u of [a, b]) { u.account.available = deposit; u.account.locked = 0; u.account.wallet = 5_000 * stake; u.account.seat = { floor: floor.slug, at: new Date().toISOString() }; }
  let x = 11, clock = Date.now();
  const rand = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const ctx = () => ({ now: clock, rand, validateStake: (user, f, s) => validateRoomStake(user, FLOORS.find(y => y.slug === f), s) });
  const { rpOf } = await import('../lib/rank-points.mjs');
  for (const u of [a, b]) { rpOf(u, clock); u.rp.points = 190; } // 아이언 I: room for a big loss, no 방어전
  const room = createRoom(state, a, { game: 'matgo', stake, floor: floor.slug }, ctx());
  joinRoom(state, b, room.code, ctx());
  startRoom(state, a, room.code, ctx());
  let big = 0, seen = new Set();
  for (let step = 0; step < 20000 && big < 1 && seen.size < 200; step++) {
    const r = room.round;
    if (!r || r.status === 'SETTLED') {
      if (r && !seen.has(r.id)) {
        seen.add(r.id);
        const nets = Object.values(r.nets);
        assert.equal(nets[0] + nets[1], 0, 'what one paid the other got');
        for (const u of [a, b]) assert.equal(u.account.locked, 0, 'nothing stays locked between hands');
        if (Math.min(...nets) < -deposit) {
          big++;
          // RP counts the loss against the deposit, like the win: losing 30 points is −30 × 0.75, not −10.
          const loser = [a, b].find(u => r.nets[u.id] < -deposit);
          assert.equal(loser.rp.last.delta, Math.round(r.nets[loser.id] / deposit * 10 * 0.75));
          assert.ok(loser.rp.last.delta < -8, 'a loss past the deposit costs more than a whole-deposit loss');
        }
        // Back to just the deposit on the table for the next hand.
        for (const u of [a, b]) { u.account.wallet += u.account.available - deposit; u.account.available = deposit; }
      }
      clock += NEXT_HAND_MS; tick(state, room, ctx());
      continue;
    }
    const seat = r.phase === 'PLAY' ? r.turn : r.pending.seat;
    const user = state.users[r.seats[seat].userId];
    roomAction(state, user, room.code, { handNo: room.handNo, seq: room.events.length, ...matgoAiDecision(r, seat, m => Math.floor(rand() * m)) }, ctx());
  }
  assert.ok(big >= 1, `a hand lost more than the deposit within ${seen.size} hands`);
});

// 2026-11-01 한서 "Rp 내려가는건 왜 배율이 없냐": a 54-point win was +54 but a 54-point loss only
// −10, because the loss was measured against the lock that grew to cover it. Both sides count
// against the 10-point deposit now.
test('맞고: a loss past the deposit moves RP as far as a win of the same size', async () => {
  const { rpOf } = await import('../lib/rank-points.mjs');
  const { state, user } = seated({ chips: 100 * M, wallet: 500 * M });
  rpOf(user); user.rp.points = 190;
  const roundId = 'big-loss';
  lockBet(state, user, { stake: 10 * M, game: 'Matgo', roundId });
  const out = chargeOverDeposit(state, user, { net: -54 * M, locked: 10 * M, game: 'Matgo', roundId });
  settleLockedHouseGame(state, user, { game: 'Matgo', stake: out.locked, netPnl: out.net, roundId, rpStake: 10 * M });
  assert.equal(user.rp.last.delta, Math.round(-54 * 0.75), '아이언 loses 3/4: −41, not −8');
});

test('맞고·고스톱 settle code passes the deposit as the RP stake', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../lib/card-room.mjs', import.meta.url), 'utf8');
  assert.equal(src.match(/game: '(Matgo|Gostop)', stake: locked, netPnl: net, roundId: round\.id, rpStake: deposit/g)?.length, 2);
});
