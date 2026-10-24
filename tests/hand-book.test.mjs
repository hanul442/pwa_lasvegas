import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState } from '../lib/state.mjs';
import { addLedger } from '../lib/economy.mjs';
import { settleFinishedRankSeason } from '../lib/rank-season.mjs';
import { achievementsView, claimAchievement } from '../lib/achievements.mjs';
import { ownsCosmetic, shopView } from '../lib/shop.mjs';
import { COSMETICS } from '../lib/cosmetics.mjs';
import {
  HAND_BOOK, HAND_BOOK_PAGES, pokerEntry, seotdaEntry, hwatuEntries, blackjackEntries, baccaratEntries,
  rouletteEntries, sicboEntries, slotsEntries, noteHands, noteRound, notePokerHand, handBookView
} from '../lib/hand-book.mjs';

const c = t => ({ r: t.slice(0, -1), s: t.slice(-1) });
const cards = s => s.split(' ').map(c);

test('every entry has a page, a unique id and a tier, and every page has entries', () => {
  const ids = new Set(HAND_BOOK.map(h => h.id));
  assert.equal(ids.size, HAND_BOOK.length);
  for (const h of HAND_BOOK) {
    assert.ok(HAND_BOOK_PAGES.some(p => p.id === h.page), h.id);
    assert.ok([1, 2, 3].includes(h.tier), h.id);
  }
  for (const p of HAND_BOOK_PAGES) assert.ok(HAND_BOOK.some(h => h.page === p.id), p.id);
});

test('poker hands read as the best five of seven, royal and the named straights apart', () => {
  assert.equal(pokerEntry(cards('A♠ K♠ Q♠ J♠ 10♠ 2♥ 3♦')), 'pk-royal');
  assert.equal(pokerEntry(cards('9♠ K♠ Q♠ J♠ 10♠ 2♥ 3♦')), 'pk-sf');
  assert.equal(pokerEntry(cards('9♠ 9♥ 9♦ 9♣ 10♠ 2♥ 3♦')), 'pk-quads');
  assert.equal(pokerEntry(cards('9♠ 9♥ 9♦ 3♣ 10♠ 2♥ 3♦')), 'pk-full');
  assert.equal(pokerEntry(cards('2♠ 7♠ 9♠ J♠ K♠ 2♥ 3♦')), 'pk-flush');
  assert.equal(pokerEntry(cards('A♥ K♠ Q♠ J♦ 10♠ 2♥ 3♦')), 'pk-mountain');
  assert.equal(pokerEntry(cards('A♥ 2♠ 3♠ 4♦ 5♠ 9♥ K♦')), 'pk-back');
  assert.equal(pokerEntry(cards('6♥ 2♠ 3♠ 4♦ 5♠ 9♥ K♦')), 'pk-straight');
  assert.equal(pokerEntry(cards('6♥ 6♠ 6♦ 4♦ 5♠ 9♥ K♦')), 'pk-trips');
  assert.equal(pokerEntry(cards('6♥ 6♠ 2♦ 4♦ J♠ 9♥ K♦')), null);
});

test('섯다 hands map to their 족보, every 1~9땡 to one entry', () => {
  assert.equal(seotdaEntry(['03-1', '08-1']), 'sd-38');
  assert.equal(seotdaEntry(['01-1', '08-1']), 'sd-18');
  assert.equal(seotdaEntry(['01-1', '03-1']), 'sd-13');
  assert.equal(seotdaEntry(['10-1', '10-3']), 'sd-jang');
  assert.equal(seotdaEntry(['05-1', '05-3']), 'sd-ttaeng');
  assert.equal(seotdaEntry(['01-3', '02-3']), 'sd-ali');
  assert.equal(seotdaEntry(['04-1', '07-1']), 'sd-amhaeng');
  assert.equal(seotdaEntry(['04-1', '09-1']), 'sd-mgusa');
  assert.equal(seotdaEntry(['02-3', '07-3']), 'sd-gabo');
  assert.equal(seotdaEntry(['03-3', '07-3']), 'sd-mangtong');
  assert.equal(seotdaEntry(['02-3', '06-3']), null, '8끗 is not in the book');
  assert.equal(seotdaEntry(['02-3']), null, 'one card is not a hand yet');
});

test('고스톱·맞고: what a seat gathered counts win or lose, how it won only on a win', () => {
  const round = {
    captured: [['01-1', '03-1', '08-1', '11-1', '12-1', '02-1', '04-1', '08-2'], ['01-2', '02-2', '03-2']],
    goCount: [3, 0], result: { winner: 0, multipliers: [{ label: '3고' }, { label: '흔들기' }, { label: '광박' }] }
  };
  const mine = hwatuEntries(round, 0);
  for (const id of ['hw-ogwang', 'hw-godori', 'hw-threego', 'hw-shake', 'hw-gwangbak']) assert.ok(mine.includes(id), id);
  assert.deepEqual(hwatuEntries(round, 1), ['hw-hongdan'], 'the loser keeps the 홍단 they made');
  // 고스톱 keeps 피박/광박 per loser's share.
  const gs = { captured: [[], []], goCount: [0, 0], result: { winner: 0, multipliers: [], shares: [{ multipliers: [{ label: '피박' }] }] } };
  assert.deepEqual(hwatuEntries(gs, 0), ['hw-pibak']);
});

test('casino tables: blackjack boxes and side bets, and only winning bets elsewhere', () => {
  const bj = blackjackEntries({
    hands: [{ cards: cards('A♠ K♠') }, { cards: cards('7♥ 7♠ 7♦') }, { cards: cards('2♥ 3♠ 2♦ 4♣ 5♦') }, { fromSplit: true, cards: cards('A♥ Q♥') }],
    sideBets: [{ kind: 'PP', result: 'PERFECT' }, { kind: 'T3', result: 'TRIPS' }]
  });
  assert.deepEqual(bj.sort(), ['bj-777', 'bj-five', 'bj-natural', 'bj-perfect', 'bj-suited']);
  assert.deepEqual(baccaratEntries({ betType: 'PLAYER', winner: 'PLAYER', playerScore: 9, bankerScore: 3, trace: { natural: true }, sideBets: [{ won: true }] }), ['bac-natural', 'bac-pair']);
  assert.deepEqual(baccaratEntries({ betType: 'BANKER', winner: 'PLAYER', playerScore: 9, bankerScore: 3, trace: { natural: true } }), []);
  assert.deepEqual(baccaratEntries({ betType: 'TIE', winner: 'TIE', playerScore: 5, bankerScore: 5, trace: {} }), ['bac-tie']);
  assert.deepEqual(rouletteEntries({ bets: [{ betType: 'NUMBER', target: 0, won: true, multiplier: 50 }, { betType: 'RED', won: false }], lightning: [{ number: 0, multiplier: 50 }] }), ['rl-straight', 'rl-zero', 'rl-lightning']);
  assert.deepEqual(rouletteEntries({ bets: [{ betType: 'NUMBER', target: 5, won: false }] }), []);
  assert.deepEqual(sicboEntries({ betType: 'ANY_TRIPLE', netPnl: 24 }), ['sb-triple']);
  assert.deepEqual(sicboEntries({ betType: 'TOTAL', target: 17, netPnl: 50 }), ['sb-edge']);
  assert.deepEqual(sicboEntries({ betType: 'TOTAL', target: 17, netPnl: -1 }), []);
  assert.deepEqual(slotsEntries({ line: 'BAR1', jackpot: 0, freeSpins: { spins: [{ line: 'SEVEN' }] } }), ['sl-seven', 'sl-free']);
});

test('a hand fills its square once, then only counts; a legend goes to the lounge feed', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  const fresh = noteRound(state, u, 'Seotda', { hands: [['03-1', '08-1'], ['01-3', '02-3']] }, 0);
  assert.deepEqual(fresh.map(x => x.id), ['sd-38']);
  assert.equal(state.feed[0].type, 'HAND_BOOK');
  assert.equal(state.feed[0].text, '38광땡');
  assert.deepEqual(noteRound(state, u, 'Seotda', { hands: [['03-1', '08-1']] }, 0), []);
  assert.equal(u.handBook['sd-38'].count, 2);
  assert.deepEqual(noteRound(state, u, 'Seotda', null), [], 'a missing round is ignored');
  assert.deepEqual(noteRound(state, u, 'Seotda', { hands: [['xx', 'yy']] }), [], 'a bad round never throws');
  const view = handBookView(u);
  assert.equal(view.count, 1);
  assert.equal(view.total, HAND_BOOK.length);
  assert.equal(view.pages.find(p => p.id === 'seotda').count, 1);
  assert.equal(state.users.min.handBook, undefined, 'nobody else gets it');
});

test('a poker hand counts only when the seat saw it through to the last card', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  const board = cards('Q♠ J♠ 10♠ 2♥ 3♦');
  assert.deepEqual(notePokerHand(state, u, { over: false, board, players: [{ cards: cards('A♠ K♠') }] }), []);
  assert.deepEqual(notePokerHand(state, u, { over: true, board, players: [{ folded: true, cards: cards('A♠ K♠') }] }), []);
  assert.deepEqual(notePokerHand(state, u, { over: true, board: board.slice(0, 3), players: [{ cards: cards('A♠ K♠') }] }), []);
  assert.deepEqual(notePokerHand(state, u, { over: true, board, players: [{ cards: cards('A♠ K♠') }] }).map(x => x.id), ['pk-royal']);
  assert.deepEqual(notePokerHand(state, u, { over: true, players: [{ cards: cards('9♠ 9♥ 9♦ 9♣ 10♠ 2♥ 3♦') }] }).map(x => x.id), ['pk-quads'], '7포커: seven cards, no board');
});

test('the book outlives the monthly reset', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  const OCT = Date.parse('2026-10-20T03:00:00Z'), NOV = Date.parse('2026-11-01T00:30:00+09:00');
  const real = Date.now;
  try {
    Date.now = () => OCT;
    settleFinishedRankSeason(state, OCT);
    noteHands(state, u, ['pk-royal', 'sd-ali']);
    Date.now = () => NOV;
    assert.ok(settleFinishedRankSeason(state, NOV));
  } finally { Date.now = real; }
  assert.equal(u.account.available, 0, 'the chips went');
  assert.deepEqual(Object.keys(u.handBook).sort(), ['pk-royal', 'sd-ali'], 'the book stayed');
});

test('half the book unlocks the 족보 명패, the whole book the master plate, and both pay once', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  const plate = COSMETICS.find(x => x.id === 'frame-jokbo'), master = COSMETICS.find(x => x.id === 'frame-jokbo-master');
  const item = x => shopView(u).cosmetics.find(y => y.id === x.id);
  assert.ok(plate && master);
  assert.equal(ownsCosmetic(u, { ...plate, kind: 'cosmetic' }), false);
  noteHands(state, u, HAND_BOOK.slice(0, Math.ceil(HAND_BOOK.length / 2)).map(h => h.id));
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: 0 });
  assert.equal(ownsCosmetic(u, { ...plate, kind: 'cosmetic' }), true);
  assert.equal(ownsCosmetic(u, { ...master, kind: 'cosmetic' }), false);
  assert.ok(item(plate)?.owned ?? true);
  const half = achievementsView(u).find(a => a.id === 'jokbo-half');
  assert.equal(half.done, true);
  const before = u.account.available;
  const claim = claimAchievement(state, u, 'jokbo-half');
  assert.equal(u.account.available, before + claim.amount);
  assert.throws(() => claimAchievement(state, u, 'jokbo-half'), /ALREADY_CLAIMED/);
  noteHands(state, u, HAND_BOOK.map(h => h.id));
  assert.equal(ownsCosmetic(u, { ...master, kind: 'cosmetic' }), true);
  for (const p of HAND_BOOK_PAGES) assert.equal(achievementsView(u).find(a => a.id === `jokbo-page-${p.id}`).done, true, p.id);
});
