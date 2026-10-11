import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { HWATU, SEOTDA_DECK } from '../lib/hwatu.mjs';
import { startMatgo, matgoAct, matgoScore, matgoPublic, runMatgoAi, matgoActor, matgoAiDecision } from '../lib/matgo.mjs';
import { startSeotda, seotdaAct, seotdaHand, seotdaCompare, seotdaPublic, runSeotdaAi, seotdaNet } from '../lib/seotda.mjs';

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
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? `k-room-${++n}` : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('hwatu deck has 48 cards, four per month, and 섯다 uses twenty of them', () => {
  assert.equal(HWATU.length, 48);
  assert.equal(new Set(HWATU.map(c => c.id)).size, 48);
  for (let m = 1; m <= 12; m++) assert.equal(HWATU.filter(c => c.month === m).length, 4);
  assert.equal(HWATU.filter(c => c.kind === 'gwang').length, 5);
  assert.equal(HWATU.filter(c => c.bird).length, 3);
  assert.equal(SEOTDA_DECK.length, 20);
});

test('맞고 scoring counts 광, 고도리, 단 and 피 the standard way', () => {
  assert.equal(matgoScore(['01-1', '03-1', '08-1']).base, 3);
  assert.equal(matgoScore(['01-1', '03-1', '12-1']).base, 2, '비삼광');
  assert.equal(matgoScore(['02-1', '04-1', '08-2']).base, 5, '고도리');
  assert.equal(matgoScore(['01-2', '02-2', '03-2']).base, 3, '홍단');
  const pi = ['01-3', '01-4', '02-3', '02-4', '03-3', '03-4', '04-3', '04-4', '11-2'];
  assert.equal(matgoScore(pi).piCount, 10);
  assert.equal(matgoScore(pi).base, 1);
  // 국진 counts as 쌍피 when that scores more.
  assert.equal(matgoScore([...pi.slice(0, 8), '09-1']).base, 1);
});

test('맞고 deals 10/10/8/20 and conserves every card through full AI games', () => {
  for (let g = 0; g < 300; g++) {
    const r = startMatgo({ stake: 100, seats: [{ kind: 'ai' }, { kind: 'ai' }] });
    if (g === 0) {
      assert.deepEqual([r.hands[0].length, r.hands[1].length, r.floor.length, r.pile.length], [10, 10, 8, 20]);
    }
    runMatgoAi(r);
    const live = r.hands.flat().filter(x => !x.startsWith('BOMB')).length + r.floor.length + r.pile.length + r.captured.flat().length;
    assert.equal(live, 48);
    assert.equal(r.status, 'READY_TO_SETTLE');
    if (r.result.winner !== null) assert.ok(r.result.points >= 7);
  }
});

test('맞고 enforces turns and hides the opponent hand', () => {
  const r = startMatgo({ stake: 100, first: 0 });
  assert.throws(() => matgoAct(r, 1, { type: 'PLAY', card: r.hands[1][0] }), /NOT_YOUR_TURN/);
  assert.throws(() => matgoAct(r, 0, { type: 'PLAY', card: r.hands[1][0] }), /CARD_NOT_IN_HAND/);
  const view = matgoPublic(r, 0);
  assert.equal(view.opponentHand, 10);
  assert.equal(JSON.stringify(view).includes(r.hands[1][0]), false);
  const events = matgoAct(r, 0, matgoAiDecision(r, 0));
  assert.equal(events[0].type, 'play');
  assert.ok(events.some(e => e.type === 'flip'));
  assert.ok(matgoActor(r) === 1 || r.phase !== 'PLAY');
});

test('섯다 ranks 광땡, 땡, 알리 and the special catchers', () => {
  assert.equal(seotdaHand(['03-1', '08-1']).name, '38광땡');
  assert.equal(seotdaHand(['10-1', '10-3']).name, '장땡');
  assert.equal(seotdaHand(['01-1', '02-1']).name, '알리');
  assert.equal(seotdaHand(['05-1', '04-3']).name, '갑오');
  assert.equal(seotdaCompare(['03-1', '08-1'], ['10-1', '10-3']), 1);
  assert.equal(seotdaCompare(['04-1', '07-1'], ['01-1', '08-1']), 1, '암행어사 catches 18광땡');
  assert.equal(seotdaCompare(['03-1', '07-1'], ['09-1', '09-3']), 1, '땡잡이 catches 9땡');
  assert.equal(seotdaCompare(['03-1', '07-1'], ['10-1', '10-3']), -1, '땡잡이 loses to 장땡');
  assert.equal(seotdaCompare(['04-3', '09-1'], ['01-1', '02-1']), 'REDEAL');
  assert.equal(seotdaCompare(['04-1', '09-1'], ['08-1', '08-3']), 'REDEAL');
});

test('섯다 betting moves the pot and keeps the opponent face down until showdown', () => {
  const r = startSeotda({ stake: 100, first: 0, seats: [{ kind: 'human' }, { kind: 'human' }] });
  assert.equal(r.pot, 200);
  seotdaAct(r, 0, 'HALF');
  assert.equal(r.toCall, r.contrib[0] - r.contrib[1]);
  assert.deepEqual(seotdaPublic(r, 1).opponent, ['HIDDEN']);
  seotdaAct(r, 1, 'CALL');
  assert.equal(r.street, 2);
  assert.equal(r.hands[0].length, 2);
  seotdaAct(r, 0, 'CHECK');
  seotdaAct(r, 1, 'CHECK');
  assert.equal(r.status, 'READY_TO_SETTLE');
  const net = seotdaNet(r, 0);
  assert.ok(net === 0 || Math.abs(net) === r.contrib[0]);
});

test('섯다 AI games always finish', () => {
  for (let g = 0; g < 500; g++) {
    const r = startSeotda({ stake: 100, seats: [{ kind: 'ai' }, { kind: 'ai' }] });
    runSeotdaAi(r);
    assert.equal(r.status, 'READY_TO_SETTLE');
  }
});

test('맞고 API locks a 10-point deposit and settles back to a clean ledger', async () => {
  const store = memoryStore();
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  let res = await call(store, 'POST', '/api/matgo/start', { stake: 100_000, floor: 'downtown' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal((await call(store, 'POST', '/api/matgo/start', { stake: 100_000, floor: 'downtown' })).status, 409);
  const open = await call(store, 'GET', '/api/matgo/open');
  assert.equal(open.data.round.id, res.data.round.id);
  for (let i = 0; i < 40 && res.data.round.status === 'PLAYING'; i++) {
    const v = res.data.round;
    let body;
    if (v.phase === 'GO_STOP') body = { type: 'STOP' };
    else if (v.phase === 'CHOOSE_FLIP') body = { type: 'CHOOSE', target: v.pending.options[0] };
    else if (v.legal.cards.length) {
      const c = v.legal.cards[0];
      const pair = v.floor.filter(x => x.slice(0, 2) === c.slice(0, 2));
      body = { type: 'PLAY', card: c, target: pair[0] };
    } else body = { type: 'FLIP_ONLY' };
    res = await call(store, 'POST', '/api/matgo/action', { roundId: v.id, ...body });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }
  assert.equal(res.data.round.status, 'SETTLED');
  const account = res.data.state.user.account;
  assert.equal(account.locked, 0);
  assert.equal(account.available, start + res.data.netPnl);
});

test('섯다 API charges each raise and pays the pot', async () => {
  const store = memoryStore();
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  let res = await call(store, 'POST', '/api/seotda/start', { stake: 100_000, floor: 'downtown' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  for (let i = 0; i < 10 && res.data.round.status === 'PLAYING'; i++) {
    const opts = res.data.round.options.map(o => o.action);
    const action = opts.includes('CALL') ? 'CALL' : 'CHECK';
    res = await call(store, 'POST', '/api/seotda/action', { roundId: res.data.round.id, action });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    for (const e of res.data.events) if (e.type === 'deal' && e.seat === 1) assert.equal(e.card, 'HIDDEN', 'AI card must not leak before showdown');
  }
  assert.equal(res.data.round.status, 'SETTLED');
  assert.equal(res.data.state.user.account.locked, 0);
  assert.equal(res.data.state.user.account.available, start + res.data.netPnl);
});
