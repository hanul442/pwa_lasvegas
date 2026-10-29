// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyShoe, playHand, dailyCommand, dailyView, seoulDay, dayNumber, bookScore, total, DAILY_HANDS, DAILY_START } from '../lib/daily-blackjack.mjs';

const NOW = Date.parse('2026-10-24T03:00:00Z'); // 12:00 in Seoul
const stateWith = (...ids) => ({ users: Object.fromEntries(ids.map(id => [id, { id, nickname: id.toUpperCase() }])) });

test('Seoul day and day numbers', () => {
  assert.equal(seoulDay(Date.parse('2026-10-24T14:59:00Z')), '2026-10-24');
  assert.equal(seoulDay(Date.parse('2026-10-24T15:00:00Z')), '2026-10-25');
  assert.equal(dayNumber('2026-10-24'), 1);
  assert.equal(dayNumber('2026-11-01'), 9);
});

test('the shoe is the same for the same secret, day and hand, and differs otherwise', () => {
  const a = dailyShoe('s', '2026-10-24', 0);
  assert.deepEqual(a, dailyShoe('s', '2026-10-24', 0));
  assert.equal(a.length, 312);
  assert.notDeepEqual(a, dailyShoe('s', '2026-10-24', 1));
  assert.notDeepEqual(a, dailyShoe('t', '2026-10-24', 0));
  assert.notDeepEqual(a, dailyShoe('s', '2026-10-25', 0));
});

test('hand rules: bust, dealer S17, double, split, natural', () => {
  // shoe order: p1 d1 p2 d2 then draws
  const bust = playHand(['10♠', '9♥', '6♣', '8♦', 'K♠'], ['hit']);
  assert.equal(bust.over, true);
  assert.equal(bust.hands[0].result, 'bust');
  assert.equal(bust.points, -100);
  assert.deepEqual(bust.dealer, ['9♥', '8♦']); // dealer doesn't draw against a bust
  const dbl = playHand(['5♠', '10♥', '6♣', '6♦', '2♠', '5♥'], ['double']);
  assert.equal(dbl.hands[0].bet, 2);
  assert.equal(total(dbl.dealer).total, 21);
  assert.equal(dbl.points, -200);
  const s17 = playHand(['10♠', 'A♥', '9♣', '6♦'], ['stand']);
  assert.deepEqual(s17.dealer, ['A♥', '6♦']); // soft 17 stands
  assert.equal(s17.hands[0].result, 'win');
  const bj = playHand(['A♠', '9♥', 'K♣', '7♦']);
  assert.equal(bj.over, true);
  assert.equal(bj.points, 150);
  assert.equal(bj.mark, '⭐');
  const dealerBj = playHand(['9♠', 'A♥', '9♣', 'K♦'], []);
  assert.equal(dealerBj.over, true);
  assert.equal(dealerBj.points, -100);
  const split = playHand(['8♠', '10♥', '8♣', '7♦', '3♠', '10♣', 'K♥'], ['split', 'double', 'stand']);
  assert.equal(split.hands.length, 2);
  assert.deepEqual(split.hands[0].cards, ['8♠', '3♠', '10♣']);
  assert.deepEqual(split.hands[1].cards, ['8♣', 'K♥']);
  assert.equal(split.points, 300); // 21 doubled beats 17, 18 beats 17
  assert.equal(split.mark, '💰');
  assert.throws(() => playHand(['8♠', '10♥', '8♣', '7♦', '8♥', '2♣', '2♦'], ['split', 'split']), /DAILY_BAD_MOVE/);
  const aces = playHand(['A♠', '10♥', 'A♣', '7♦', '10♠', '9♣'], ['split']);
  assert.equal(aces.over, true);
  assert.equal(aces.hands[0].result, 'win'); // split-ace 21 is not a blackjack
  assert.equal(aces.hands[0].net, 1);
});

test('a full day: ten hands, one score on the board, then no second go', () => {
  // A fixed shoe: with a random one the dealer's first hand is sometimes a natural, and that hole card shows.
  const state = { ...stateWith('a', 'b'), dailyBj: { secret: 'full-day-test' } };
  let v = dailyCommand(state, 'a', { move: 'start' }, NOW);
  assert.equal(v.status, 'PLAYING');
  assert.equal(v.hands[0].dealer[1], 'HIDDEN');
  while (v.status !== 'DONE') {
    const h = v.hands.at(-1);
    v = dailyCommand(state, 'a', { move: h.over ? 'next' : 'stand', step: v.step }, NOW);
  }
  assert.equal(v.hands.length, DAILY_HANDS);
  assert.equal([...v.marks].length > 0, true);
  assert.equal(v.board.players, 1);
  assert.equal(v.board.me.rank, 1);
  assert.match(v.share, /^오늘의 한 판 #1 🃏/);
  assert.equal(v.streak, 1);
  // a stale or repeated command changes nothing
  const again = dailyCommand(state, 'a', { move: 'hit', step: 3 }, NOW);
  assert.equal(again.score, v.score);
  assert.throws(() => { delete state.dailyBj.games.a; dailyCommand(state, 'a', { move: 'start' }, NOW); }, /DAILY_ALREADY_PLAYED/);
  // b gets the same first deal
  const b = dailyCommand(state, 'b', { move: 'start' }, NOW);
  assert.deepEqual(b.hands[0].hands[0].cards.slice(0, 2), v.hands[0].hands[0].cards.slice(0, 2));
  assert.equal(b.hands[0].dealer[0], v.hands[0].dealer[0]);
  // b hasn't finished: a's marks stay hidden, the score shows
  assert.equal(b.board.top[0].marks, null);
  assert.equal(b.board.top[0].score, v.score);
});

test('a retried command is not applied twice', () => {
  const state = stateWith('a');
  let v = dailyCommand(state, 'a', { move: 'start' }, NOW);
  while (v.hands.at(-1).over) v = dailyCommand(state, 'a', { move: 'next', step: v.step }, NOW);
  const step = v.step;
  const once = dailyCommand(state, 'a', { move: 'hit', step }, NOW);
  const twice = dailyCommand(state, 'a', { move: 'hit', step }, NOW);
  assert.deepEqual(twice.hands.at(-1).hands, once.hands.at(-1).hands);
});

test('streak counts consecutive Seoul days; the textbook score is stable', () => {
  const state = stateWith('a');
  const playDay = now => {
    let v = dailyCommand(state, 'a', { move: 'start' }, now);
    while (v.status !== 'DONE') v = dailyCommand(state, 'a', { move: v.hands.at(-1).over ? 'next' : 'stand', step: v.step }, now);
    return v;
  };
  playDay(NOW);
  const day2 = playDay(NOW + 86_400_000);
  assert.equal(day2.streak, 2);
  assert.equal(day2.no, 2);
  const day4 = playDay(NOW + 3 * 86_400_000);
  assert.equal(day4.streak, 1);
  assert.equal(bookScore('x', '2026-10-24'), bookScore('x', '2026-10-24'));
  assert.equal(typeof day4.book, 'number');
  assert.ok(Math.abs(day4.book - DAILY_START) <= 3000);
});
