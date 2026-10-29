import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { HWATU, SEOTDA_DECK } from '../lib/hwatu.mjs';
import { startMatgo, matgoAct, matgoScore, matgoPublic, runMatgoAi, matgoActor, matgoAiDecision } from '../lib/matgo.mjs';
import { startSeotda, seotdaAct, seotdaHand, seotdaCompare, seotdaShowdown, seotdaPublic, runSeotdaAi, seotdaNet, seotdaOptions, seotdaSeats, seotdaNextLead } from '../lib/seotda.mjs';

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
  // A bomb or a shake is announced first ('call'), so the play is not always the first event.
  assert.equal(events.find(e => e.type !== 'call').type, 'play');
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

const humans = n => Array.from({ length: n }, () => ({ kind: 'human' }));
// Fix every seat's two cards: first cards in hand, second cards on top of the deck in seat order
// from the lead (seat 0 here), with spares below for a 재경기.
function rig(r, pairs) {
  const used = new Set(pairs.flat());
  r.hands = pairs.map(p => [p[0]]);
  r.deck = [...SEOTDA_DECK.map(c => c.id).filter(c => !used.has(c)), ...pairs.map(p => p[1]).reverse()];
  return r;
}
const checkAround = (r, seats) => seats.forEach(s => seotdaAct(r, s, 'CHECK'));

test('섯다 betting moves the pot and keeps the opponent face down until showdown', () => {
  const r = rig(startSeotda({ stake: 100, first: 0, seats: humans(2) }), [['01-1', '01-3'], ['05-1', '06-1']]);
  assert.equal(r.pot, 200);
  seotdaAct(r, 0, 'HALF');
  assert.equal(seotdaOptions(r, 1).find(o => o.action === 'CALL').cost, r.contrib[0] - r.contrib[1]);
  assert.deepEqual(seotdaPublic(r, 1).players[0].cards, ['HIDDEN']);
  seotdaAct(r, 1, 'CALL');
  assert.equal(r.street, 2);
  assert.equal(r.hands[0].length, 2);
  checkAround(r, [0, 1]);
  assert.equal(r.status, 'READY_TO_SETTLE');
  assert.deepEqual(r.result.winners, [0]);
  assert.equal(seotdaNet(r, 0), r.contrib[1]);
  assert.equal(seotdaNet(r, 1), -r.contrib[1]);
  assert.deepEqual(seotdaPublic(r, 1).players[0].cards, ['01-1', '01-3']);
});

test('섯다 따당 calls and doubles what was bet in front, and counts as a raise', () => {
  const r = rig(startSeotda({ stake: 100, first: 0, seats: humans(3) }), [['01-1', '02-1'], ['03-1', '03-3'], ['05-1', '06-1']]);
  assert.ok(!seotdaOptions(r, 0).some(o => o.action === 'DDADANG'), 'nothing to double before anyone bets');
  seotdaAct(r, 0, 'BBING');
  const dd = seotdaOptions(r, 1).find(o => o.action === 'DDADANG');
  assert.equal(dd.cost, 200, '삥 100 → 따당 200');
  seotdaAct(r, 1, 'DDADANG');
  assert.equal(r.contrib[1], 300);
  assert.equal(r.raises, 2);
  assert.ok(!seotdaOptions(r, 2).some(o => o.action === 'DDADANG' || o.action === 'HALF'), 'two raises a round');
  assert.equal(seotdaOptions(r, 2).find(o => o.action === 'CALL').cost, 200);
  seotdaAct(r, 2, 'CALL');
  assert.equal(r.turn, 0, 'the 삥 seat has to answer the 따당');
  assert.equal(seotdaOptions(r, 0).find(o => o.action === 'CALL').cost, 100);
});

test('섯다 올인: short of the call, the last chips go in and the rest is a side pot', () => {
  const r = rig(startSeotda({ stake: 100, first: 0, seats: humans(3) }), [['03-1', '03-3'], ['01-1', '02-1'], ['05-1', '06-1']]);
  r.stacks = [150, null, null];
  assert.ok(!seotdaOptions(r, 0).some(o => o.action === 'ALLIN'), 'nothing to go all in for yet');
  seotdaAct(r, 0, 'CHECK');
  seotdaAct(r, 1, 'BBING');
  seotdaAct(r, 2, 'DDADANG');
  assert.deepEqual(seotdaOptions(r, 0), [{ action: 'DIE', cost: 0 }, { action: 'ALLIN', cost: 150 }], 'only 다이 or 올인 when the call is out of reach');
  seotdaAct(r, 0, 'ALLIN');
  assert.equal(r.allin[0], true);
  assert.equal(r.stacks[0], 0);
  assert.equal(r.turn, 1, 'an all-in short of the bet reopens nothing');
  seotdaAct(r, 1, 'CALL');
  assert.equal(r.street, 2);
  assert.notEqual(r.turn, 0, 'the all-in seat is skipped');
  seotdaAct(r, 1, 'CHECK');
  seotdaAct(r, 2, 'CHECK');
  assert.equal(r.status, 'READY_TO_SETTLE');
  assert.equal(r.pot, 850);
  assert.deepEqual(r.result.winners, [0], '3땡 takes the main pot');
  assert.deepEqual(r.result.payouts, [750, 100, 0], 'main 250×3 to 3땡, side 50×2 to 알리');
  assert.equal(seotdaNet(r, 0), 500);
  assert.equal([0, 1, 2].reduce((a, s) => a + seotdaNet(r, s), 0), 0);
});

test('섯다 올인 also covers a raise past the wallet, and everyone all in runs the cards out', () => {
  const r = rig(startSeotda({ stake: 100, first: 0, seats: humans(2) }), [['05-1', '06-1'], ['01-1', '02-1']]);
  r.stacks = [80, 500];
  assert.deepEqual(seotdaOptions(r, 0), [{ action: 'DIE', cost: 0 }, { action: 'CHECK', cost: 0 }, { action: 'ALLIN', cost: 80 }], '삥 100 is past 80, so 올인 80 instead');
  seotdaAct(r, 0, 'ALLIN');
  assert.deepEqual(seotdaOptions(r, 1).map(o => o.action), ['DIE', 'CALL'], 'no raising against a seat that cannot answer');
  seotdaAct(r, 1, 'CALL');
  assert.equal(r.status, 'READY_TO_SETTLE', 'nobody left to bet: the cards run out to the showdown');
  assert.equal(r.hands[0].length, 2);
  assert.deepEqual(r.result.payouts, [0, 360]);
});

test('섯다 선: the last winner leads the next hand', () => {
  const r = rig(startSeotda({ stake: 100, first: 0, seats: humans(3) }), [['01-1', '02-1'], ['03-1', '03-3'], ['05-1', '06-1']]);
  for (const s of [0, 1, 2, 0, 1, 2]) seotdaAct(r, s, 'CHECK');
  assert.deepEqual(r.result.winners, [1], '3땡');
  assert.equal(seotdaNextLead(r), 1);
  const next = startSeotda({ stake: 100, first: seotdaNextLead(r), seats: humans(3) });
  assert.equal(next.first, 1);
  assert.equal(next.turn, 1);
  const out = startSeotda({ stake: 100, first: 7, seats: humans(3) });
  assert.ok(out.first >= 0 && out.first < 3, 'a 선 from a bigger table is drawn again');
});

test('섯다 seats 2–5 players with named AI opponents', () => {
  assert.throws(() => seotdaSeats(1), /INVALID_PLAYERS/);
  assert.throws(() => seotdaSeats(6), /INVALID_PLAYERS/);
  const seats = seotdaSeats(5);
  assert.equal(seats.length, 5);
  assert.equal(new Set(seats.slice(1).map(s => s.name)).size, 4);
  assert.ok(seats.slice(1).every(s => s.kind === 'ai' && s.temper));
  const r = startSeotda({ stake: 100, seats });
  assert.equal(r.pot, 500);
  assert.ok(r.hands.every(h => h.length === 1));
});

test('섯다 multi-seat betting goes round the table and reopens on a raise', () => {
  const r = rig(startSeotda({ stake: 100, first: 0, seats: humans(4) }), [['01-1', '02-1'], ['03-1', '03-3'], ['05-1', '06-1'], ['07-3', '08-3']]);
  seotdaAct(r, 0, 'CHECK');
  seotdaAct(r, 1, 'BBING');
  assert.equal(r.turn, 2);
  seotdaAct(r, 2, 'CALL');
  seotdaAct(r, 3, 'DIE');
  assert.equal(r.turn, 0, 'a raise reopens the action to the seat that checked');
  assert.equal(r.street, 1);
  seotdaAct(r, 0, 'CALL');
  assert.equal(r.street, 2);
  assert.equal(r.hands[3].length, 1, 'a folded seat gets no second card');
  assert.equal(r.pot, 700);
  assert.equal(r.turn, 0);
  seotdaAct(r, 0, 'HALF');
  seotdaAct(r, 1, 'HALF');
  assert.equal(seotdaOptions(r, 2).some(o => o.action === 'HALF'), false, 'raise cap per round');
  seotdaAct(r, 2, 'CALL');
  seotdaAct(r, 0, 'CALL');
  assert.equal(r.status, 'READY_TO_SETTLE');
  assert.deepEqual(r.result.winners, [1], '3땡 beats 알리 and 1끗');
  assert.equal(r.result.payouts[1], r.pot);
  assert.equal(seotdaNet(r, 3), -100, 'a fold loses only what it put in');
  assert.equal([0, 1, 2, 3].reduce((a, s) => a + seotdaNet(r, s), 0), 0, 'no house cut');
  const v = seotdaPublic(r, 0);
  assert.deepEqual(v.players[3].cards, ['HIDDEN'], 'a folded hand is never shown');
  assert.equal(v.players[1].handName, '3땡');
});

test('섯다 folds to one seat end the hand with the pot and no reveal', () => {
  const r = startSeotda({ stake: 100, first: 0, seats: humans(3) });
  seotdaAct(r, 0, 'HALF');
  seotdaAct(r, 1, 'DIE');
  assert.equal(r.status, 'PLAYING');
  seotdaAct(r, 2, 'DIE');
  assert.equal(r.result.reason, 'FOLD');
  assert.deepEqual(r.result.winners, [0]);
  assert.equal(seotdaNet(r, 0), 200);
  assert.deepEqual(seotdaPublic(r, 1).players[0].cards, ['HIDDEN']);
});

test('섯다 showdown among three or more picks the best hand and splits ties', () => {
  assert.deepEqual(seotdaShowdown([['01-1', '02-1'], ['05-1', '05-3'], ['06-1', '07-3'], null]).winners, [1]);
  const r = rig(startSeotda({ stake: 101, first: 0, seats: humans(3) }), [['02-1', '05-3'], ['03-1', '06-3'], ['01-3', '08-3']]);
  checkAround(r, [0, 1, 2]);
  checkAround(r, [0, 1, 2]);
  assert.equal(r.result.reason, 'TIE');
  assert.deepEqual(r.result.winners, [1, 2], 'two 갑오 split');
  assert.deepEqual(r.result.payouts, [0, 152, 151], 'odd chip to the first winner from the lead');
  // Splits with the human in: net is the share taken minus what went in.
  const t = rig(startSeotda({ stake: 101, first: 0, seats: humans(3) }), [['02-1', '07-1'], ['03-3', '06-3'], ['01-3', '05-3']]);
  checkAround(t, [0, 1, 2]);
  checkAround(t, [0, 1, 2]);
  assert.deepEqual(t.result.winners, [0, 1]);
  assert.deepEqual(t.result.payouts, [152, 151, 0]);
  assert.deepEqual([0, 1, 2].map(s => seotdaNet(t, s)), [51, 50, -101]);
});

test('섯다 specials only catch the hand they are meant to, against the best on the table', () => {
  const catcher = ['03-1', '07-1'], amhaeng = ['04-1', '07-1'];
  assert.deepEqual(seotdaShowdown([catcher, ['09-1', '09-3'], ['01-1', '02-1']]).winners, [0], '땡잡이 takes 9땡 at a 3-way table');
  assert.deepEqual(seotdaShowdown([catcher, ['09-1', '09-3'], ['10-1', '10-3']]).winners, [2], '장땡 on the table: 땡잡이 is just 망통');
  assert.deepEqual(seotdaShowdown([catcher, ['01-1', '02-1'], ['05-3', '06-3']]).winners, [1], 'no 땡 to catch');
  assert.deepEqual(seotdaShowdown([amhaeng, ['01-1', '08-1'], ['05-1', '05-3']]).winners, [0], '암행어사 takes 18광땡');
  assert.deepEqual(seotdaShowdown([amhaeng, ['03-1', '08-1'], ['05-1', '05-3']]).winners, [1], '38광땡 is out of reach');
  assert.deepEqual(seotdaShowdown([amhaeng, ['02-1', '03-3'], ['05-1', '06-3']]).winners, [1], '암행어사 alone is 1끗');
});

test('섯다 구사 calls a 재경기 among the seats still in; the pot carries over', () => {
  assert.equal(seotdaShowdown([['04-3', '09-3'], ['01-1', '02-1'], ['05-1', '06-3']]).redeal, true);
  assert.equal(seotdaShowdown([['04-3', '09-3'], ['01-1', '02-1'], ['03-1', '03-3']]).redeal, false, '3땡 at the table beats 구사');
  assert.equal(seotdaShowdown([['04-1', '09-1'], ['09-3', '06-1'], ['08-1', '08-3']]).redeal, true, '멍텅구리구사 calls off up to 9땡');
  assert.equal(seotdaShowdown([['04-1', '09-1'], ['10-1', '10-3']]).redeal, false);
  const r = rig(startSeotda({ stake: 100, first: 0, seats: humans(3) }), [['04-3', '09-3'], ['01-1', '02-1'], ['05-1', '06-3']]);
  seotdaAct(r, 0, 'CHECK');
  seotdaAct(r, 1, 'CHECK');
  seotdaAct(r, 2, 'DIE');
  const events = [];
  seotdaAct(r, 0, 'CHECK', events);
  seotdaAct(r, 1, 'CHECK', events);
  assert.equal(r.status, 'PLAYING');
  assert.equal(r.redeals, 1);
  assert.ok(events.some(e => e.type === 'redeal'));
  assert.equal(events.filter(e => e.type === 'deal' && e.street === 1).length, 2);
  assert.equal(r.pot, 300);
  assert.deepEqual(r.hands.map(h => h.length), [1, 1, 0], 'only live seats are dealt back in');
  assert.equal(r.street, 1);
  for (let i = 0; i < 20 && r.status === 'PLAYING'; i++) seotdaAct(r, r.turn, 'CHECK');
  assert.equal(r.status, 'READY_TO_SETTLE');
  assert.equal(seotdaNet(r, 2), -100);
  assert.equal([0, 1, 2].reduce((a, s) => a + seotdaNet(r, s), 0), 0);
});

test('섯다 an old two-seat round with no folded field still loads and finishes', () => {
  const old = {
    id: 'sd_old', game: 'Seotda', engineVersion: 'SEOTDA_V1', stake: 100,
    seats: [{ kind: 'human' }, { kind: 'ai', name: '하우스 AI' }],
    deck: SEOTDA_DECK.map(c => c.id).filter(c => !['01-1', '02-1', '05-1', '06-1'].includes(c)).concat(['02-1', '06-1']),
    hands: [['01-1'], ['05-1']], contrib: [100, 200], pot: 300, first: 1, turn: 0, street: 1, toCall: 100, raises: 1, acted: [false, true],
    status: 'PLAYING', phase: 'BET', history: [{ street: 1, seat: 1, action: 'BBING', cost: 100 }], result: null
  };
  const v = seotdaPublic(old, 0);
  assert.deepEqual(v.options.map(o => o.action), ['DIE', 'CALL', 'DDADANG', 'HALF']);
  assert.equal(v.players[1].cards[0], 'HIDDEN');
  seotdaAct(old, 0, 'CALL');
  assert.equal(old.street, 2);
  assert.deepEqual(old.hands, [['01-1', '02-1'], ['05-1', '06-1']]);
  assert.equal(old.turn, 1);
  seotdaAct(old, 1, 'CHECK');
  seotdaAct(old, 0, 'CHECK');
  assert.deepEqual(old.result.winners, [0]);
  assert.equal(seotdaNet(old, 0), 200);
});

test('섯다 AI games always finish', () => {
  for (let g = 0; g < 500; g++) {
    const n = 2 + (g % 4);
    const r = startSeotda({ stake: 100, seats: seotdaSeats(n).map(s => ({ ...s, kind: 'ai' })) });
    runSeotdaAi(r);
    assert.equal(r.status, 'READY_TO_SETTLE');
    assert.equal(r.result.payouts.reduce((a, b) => a + b, 0), r.pot);
    assert.equal(r.contrib.reduce((a, _, i) => a + seotdaNet(r, i), 0), 0);
  }
});

test('맞고 API locks a 10-point deposit and settles back to a clean ledger', async () => {
  const store = memoryStore();
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  let res = await call(store, 'POST', '/api/matgo/start', { stake: 10_000_000, floor: 'high-limit' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal((await call(store, 'POST', '/api/matgo/start', { stake: 10_000_000, floor: 'high-limit' })).status, 409);
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
  // A loss that empties the wallet pays the day's 구제금융 straight back in, so a bust lands on that.
  const after = start + res.data.netPnl;
  const bailout = res.data.state.user.bankruptcies?.[0]?.roundId === res.data.round.id ? res.data.state.user.bankruptcies[0].bailout || 0 : 0;
  assert.equal(account.available, after + bailout);
});

test('맞고 API: the winner of the last hand leads the next one', async () => {
  const store = memoryStore();
  let prev = null;
  const wallet = (await call(store, 'GET', '/api/state')).data.user.account.available;
  for (let hand = 0; hand < 4; hand++) {
    // Put the wallet back each hand, so a big win never outgrows High Limit mid-test.
    await store.mutate(s => { for (const u of Object.values(s.users)) u.account.available = wallet; });
    let res = await call(store, 'POST', '/api/matgo/start', { stake: 10_000_000, floor: 'high-limit' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    if (prev) assert.equal(res.data.round.first, prev.result.winner ?? prev.first, prev.result.winner === null ? '나가리 keeps 선' : 'winner leads');
    for (let i = 0; i < 40 && res.data.round.status === 'PLAYING'; i++) {
      const v = res.data.round;
      let body;
      if (v.phase === 'GO_STOP') body = { type: 'STOP' };
      else if (v.phase === 'CHOOSE_FLIP') body = { type: 'CHOOSE', target: v.pending.options[0] };
      else if (v.legal.cards.length) {
        const c = v.legal.cards[0];
        body = { type: 'PLAY', card: c, target: v.floor.filter(x => x.slice(0, 2) === c.slice(0, 2))[0] };
      } else body = { type: 'FLIP_ONLY' };
      res = await call(store, 'POST', '/api/matgo/action', { roundId: v.id, ...body });
    }
    assert.equal(res.data.round.status, 'SETTLED');
    prev = res.data.round;
  }
});

test('섯다 API charges each raise and pays the pot', async () => {
  const store = memoryStore();
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  assert.equal((await call(store, 'POST', '/api/seotda/start', { stake: 10_000_000, floor: 'high-limit', players: 6 })).status, 400);
  let res = await call(store, 'POST', '/api/seotda/start', { stake: 10_000_000, floor: 'high-limit' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.round.players.length, 4, 'four seats by default');
  for (const e of res.data.events) if (e.type === 'deal' && e.seat !== 0) assert.equal(e.card, 'HIDDEN');
  for (let i = 0; i < 40 && res.data.round.status === 'PLAYING'; i++) {
    const opts = res.data.round.options.map(o => o.action);
    const action = opts.includes('CALL') ? 'CALL' : 'CHECK';
    res = await call(store, 'POST', '/api/seotda/action', { roundId: res.data.round.id, action });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    for (const e of res.data.events) if (e.type === 'deal' && e.seat !== 0) assert.equal(e.card, 'HIDDEN', 'AI card must not leak before showdown');
  }
  const v = res.data.round;
  assert.equal(v.status, 'SETTLED');
  assert.equal(res.data.netPnl, v.result.payouts[0] - v.contrib[0]);
  assert.equal(res.data.state.user.account.locked, 0);
  assert.equal(res.data.state.user.account.available, start + res.data.netPnl);
});

test('섯다 API seats the chosen number of players and settles a fold at the lost contribution', async () => {
  const store = memoryStore();
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  let res = await call(store, 'POST', '/api/seotda/start', { stake: 10_000_000, floor: 'high-limit', players: 5 });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.round.players.length, 5);
  assert.ok(res.data.round.players.slice(1).every(p => p.kind === 'ai' && p.name));
  if (res.data.round.status === 'PLAYING') res = await call(store, 'POST', '/api/seotda/action', { roundId: res.data.round.id, action: 'DIE' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const v = res.data.round;
  assert.equal(v.status, 'SETTLED', 'the AI seats play the hand out after the human folds');
  assert.equal(res.data.netPnl, -v.contrib[0]);
  assert.equal(res.data.state.user.account.available, start - v.contrib[0]);
});

test('섯다 API finishes a two-seat round saved by the old engine', async () => {
  const store = memoryStore();
  await call(store, 'GET', '/api/state');
  const start = (await call(store, 'GET', '/api/state')).data.user.account.available;
  let res = await call(store, 'POST', '/api/seotda/start', { stake: 10_000_000, floor: 'high-limit', players: 2 });
  // Rewrite the saved round into the old shape: no folded/players fields, house AI in seat 1.
  await store.mutate(state => {
    const r = state.rounds.find(x => x.id === res.data.round.id);
    if (r.status !== 'PLAYING') return;
    delete r.folded; delete r.players; delete r.redeals;
    r.engineVersion = 'SEOTDA_V1';
    r.seats[1] = { kind: 'ai', name: '하우스 AI' };
  });
  const open = await call(store, 'GET', '/api/seotda/open');
  if (open.data.round) {
    assert.equal(open.data.round.players.length, 2);
    res = { data: open.data };
    for (let i = 0; i < 40 && res.data.round.status === 'PLAYING'; i++) {
      const opts = res.data.round.options.map(o => o.action);
      res = await call(store, 'POST', '/api/seotda/action', { roundId: res.data.round.id, action: opts.includes('CALL') ? 'CALL' : 'CHECK' });
      assert.equal(res.status, 200, JSON.stringify(res.data));
    }
  }
  assert.equal(res.data.round.status, 'SETTLED');
  assert.equal(res.data.state.user.account.locked, 0);
  assert.equal(res.data.state.user.account.available, start + res.data.round.netPnl);
});
