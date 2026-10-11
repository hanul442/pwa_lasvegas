import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { startGostop, gostopAct, gostopActor, gostopAiDecision, runGostopAi, gostopPublic, gostopNet, GOSTOP_GOAL } from '../lib/gostop.mjs';
import { startMatgo, runMatgoAi } from '../lib/matgo.mjs';

function memoryStore() {
  let state = defaultState();
  let queue = Promise.resolve();
  return {
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; });
      queue = task.catch(() => {});
      return task;
    }
  };
}
let n = 0;
const call = (store, method, path, body) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? `k-gostop-${++n}` : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

// A seeded rng so engine tests are repeatable.
function seeded(seed) {
  let s = seed >>> 0;
  return max => { s = (s * 1664525 + 1013904223) >>> 0; return s % max; };
}
const aiSeats = () => [{ kind: 'ai', name: 'A' }, { kind: 'ai', name: 'B' }, { kind: 'ai', name: 'C' }];
const live = r => r.hands.flat().filter(x => !x.startsWith('BOMB')).length + r.floor.length + r.pile.length + r.captured.flat().length;

test('고스톱 deals 7/7/7, six on the floor and 21 in the pile', () => {
  const r = startGostop({ stake: 100, rng: seeded(1) });
  assert.deepEqual(r.hands.map(h => h.length), [7, 7, 7]);
  assert.equal(r.floor.length, 6);
  assert.equal(r.pile.length, 21);
  assert.equal(live(r), 48);
  assert.equal(new Set([...r.hands.flat(), ...r.floor, ...r.pile]).size, 48);
  assert.equal(r.seats.length, 3);
});

test('고스톱 turns rotate through all three seats', () => {
  const r = startGostop({ stake: 100, first: 1, rng: seeded(2) });
  assert.equal(gostopActor(r), 1);
  assert.throws(() => gostopAct(r, 0, { type: 'PLAY', card: r.hands[0][0] }), /NOT_YOUR_TURN/);
  const order = [];
  for (let i = 0; i < 6 && r.status === 'PLAYING'; i++) {
    const seat = gostopActor(r);
    if (r.phase === 'PLAY') order.push(seat);
    gostopAct(r, seat, gostopAiDecision(r, seat, seeded(i)));
  }
  assert.deepEqual(order.slice(0, 3), [1, 2, 0]);
});

test('고스톱 AI decides from its own view: other hands and the pile do not change its move', () => {
  for (let g = 0; g < 40; g++) {
    const r = startGostop({ stake: 100, seats: aiSeats(), rng: seeded(100 + g) });
    for (let k = 0; k < 8 && r.status === 'PLAYING'; k++) {
      const seat = gostopActor(r);
      const a = gostopAiDecision(r, seat, seeded(7));
      // Swap the hidden cards around: the other two hands and the pile.
      const twin = structuredClone(r);
      const others = [0, 1, 2].filter(s => s !== seat);
      const hidden = [...twin.hands[others[0]], ...twin.hands[others[1]], ...twin.pile].reverse();
      twin.hands[others[0]] = hidden.splice(0, twin.hands[others[0]].length);
      twin.hands[others[1]] = hidden.splice(0, twin.hands[others[1]].length);
      twin.pile = hidden;
      assert.deepEqual(gostopAiDecision(twin, seat, seeded(7)), a);
      gostopAct(r, seat, a);
    }
  }
});

test('고스톱 AI games always terminate, conserve cards and pay from the stop', () => {
  let stops = 0, nagari = 0;
  for (let g = 0; g < 400; g++) {
    const r = startGostop({ stake: 100, seats: aiSeats(), rng: seeded(g + 1) });
    const events = runGostopAi(r, [], seeded(g + 9));
    assert.equal(r.status, 'READY_TO_SETTLE', `game ${g} did not finish`);
    assert.equal(live(r), 48);
    assert.ok(r.turns <= 21);
    assert.equal(events.at(-1).type, 'end');
    const res = r.result;
    if (res.winner === null) { nagari++; assert.ok(r.hands.every(h => h.length === 0)); continue; }
    stops++;
    assert.ok(res.base >= GOSTOP_GOAL);
    assert.equal(res.shares.length, 2);
    // Zero-sum across the three seats.
    assert.equal([0, 1, 2].reduce((s, seat) => s + gostopNet(r, seat), 0), 0);
    assert.equal(gostopNet(r, res.winner), res.points * 100);
    for (const s of res.shares) assert.ok(s.points >= res.base + res.go);
  }
  assert.ok(stops > 200, `only ${stops} stops`);
  assert.ok(nagari >= 0);
});

test('쪽 / 쓸 steals a 피 from both opponents', () => {
  const r = startGostop({ stake: 100, first: 0, rng: seeded(5) });
  // Rig: 0 holds 1월; floor has nothing of 1월; pile top is another 1월 → 쪽.
  r.hands = [['01-1', '05-1'], ['06-1', '07-1'], ['10-1', '10-2']];
  r.floor = ['02-1', '03-1'];
  r.pile = ['01-3', '04-1', '04-2', '11-1'];
  r.captured = [[], ['08-3'], ['12-4', '09-3']];
  const events = gostopAct(r, 0, { type: 'PLAY', card: '01-1' });
  assert.ok(events.some(e => e.type === 'call' && e.text === '쪽'));
  const steals = events.filter(e => e.type === 'steal');
  assert.deepEqual(steals.map(e => e.from).sort(), [1, 2]);
  assert.ok(r.captured[0].includes('08-3'));
  assert.ok(r.captured[0].includes('09-3'), 'takes the single 피 before the 쌍피');
  assert.deepEqual(r.captured[2], ['12-4']);
  assert.equal(gostopActor(r), 1);
});

test('3 points lets a seat call 고, and stopping pays 피박 and 고박 per loser', () => {
  const r = startGostop({ stake: 1000, first: 0, rng: seeded(6) });
  // Seat 0 is one 광 short of 3광; seat 2 had already called 고 earlier.
  r.hands = [['08-1', '05-1', '05-2'], ['06-1', '06-2'], ['07-1', '07-2']];
  r.floor = ['08-3', '11-3'];
  r.pile = ['10-3', '10-4', '12-2', '12-3'];
  r.captured = [['01-1', '03-1'], ['02-3', '02-4', '04-3', '04-4', '05-3', '05-4', '06-3'], ['01-3', '01-4', '03-3', '03-4', '07-3', '07-4', '09-3', '09-4']];
  r.goCount = [0, 0, 1]; r.goScore = [0, 0, 3]; r.goAt = { 2: 3 };
  const events = gostopAct(r, 0, { type: 'PLAY', card: '08-1' });
  assert.ok(events.some(e => e.type === 'go-stop' && e.seat === 0 && e.score === 3));
  assert.equal(r.phase, 'GO_STOP');
  assert.deepEqual(gostopPublic(r, 0).pending, { score: 3 });
  gostopAct(r, 0, { type: 'STOP' });
  const res = r.result;
  assert.equal(res.winner, 0);
  assert.equal(res.base, 3);
  // Seat 1 has no 광 → 광박 ×2; seat 2 too. 고박: seat 2 pays both shares.
  assert.equal(res.gobak, 2);
  assert.deepEqual(res.shares.map(s => [s.seat, s.payer, s.points]), [[1, 2, 6], [2, 2, 6]]);
  assert.equal(gostopNet(r, 0), 12_000);
  assert.equal(gostopNet(r, 1), 0);
  assert.equal(gostopNet(r, 2), -12_000);
});

test('맞고 still plays two seats with the shared engine', () => {
  for (let g = 0; g < 100; g++) {
    const r = startMatgo({ stake: 100, seats: [{ kind: 'ai' }, { kind: 'ai' }], rng: seeded(g + 50) });
    runMatgoAi(r, [], seeded(g));
    assert.equal(r.status, 'READY_TO_SETTLE');
    if (r.result.winner !== null) assert.ok(r.result.base >= 7);
  }
});

test('고스톱 table is in the lobby, has a guide and plays through the server API', async () => {
  const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
  const [app, client, guides, sw, lounge] = await Promise.all(['app.js', 'js/games/gostop.js', 'js/guides.js', 'sw.js', 'js/lounge.js'].map(read));
  assert.match(app, /id: 'gostop', name: '고스톱'.*mount: mountGostop/);
  assert.ok(app.indexOf("id: 'gostop'") > app.indexOf("id: 'matgo'"));
  for (const call of ['gostopStart(', 'gostopAction(', 'gostopOpen()']) assert.ok(client.includes(`api.${call}`), call);
  assert.match(guides, /\n  gostop: \{\n    id: 'gostop'/);
  assert.match(sw, /'js\/games\/gostop\.js'/);
  assert.match(lounge, /Gostop: '고스톱'/);
});

test('고스톱 API locks a deposit, plays to the end against two AI and settles a clean ledger', async () => {
  for (let game = 0; game < 4; game++) {
    const store = memoryStore();
    const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
    let res = await call(store, 'POST', '/api/gostop/start', { stake: 10_000_000, floor: 'downtown' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    if (res.data.round.status === 'PLAYING') {
      assert.equal(res.data.state.user.account.locked, 100_000_000);
      assert.equal((await call(store, 'POST', '/api/gostop/start', { stake: 10_000_000, floor: 'downtown' })).status, 409);
      const open = await call(store, 'GET', '/api/gostop/open');
      assert.equal(open.data.round.id, res.data.round.id);
      assert.equal(open.data.round.seats.length, 3);
      assert.equal(JSON.stringify(open.data.round).includes('"hands"'), false);
    }
    for (let i = 0; i < 40 && res.data.round.status === 'PLAYING'; i++) {
      const v = res.data.round;
      let body;
      if (v.phase === 'GO_STOP') body = { type: game % 2 ? 'GO' : 'STOP' };
      else if (v.phase === 'CHOOSE_FLIP') body = { type: 'CHOOSE', target: v.pending.options[0] };
      else if (v.legal.cards.length) {
        const c = v.legal.cards[0];
        const pair = v.floor.filter(x => x.slice(0, 2) === c.slice(0, 2));
        body = { type: 'PLAY', card: c, target: pair[0] };
      } else body = { type: 'FLIP_ONLY' };
      res = await call(store, 'POST', '/api/gostop/action', { roundId: v.id, ...body });
      assert.equal(res.status, 200, JSON.stringify(res.data));
    }
    assert.equal(res.data.round.status, 'SETTLED');
    const account = res.data.state.user.account;
    assert.equal(account.locked, 0);
    assert.equal(account.available, start + res.data.netPnl);
  }
});
