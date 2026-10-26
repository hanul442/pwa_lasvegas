// One money format everywhere: push notifications, the top banner, the lounge feed and the
// screens all write 7억 2천만원, never a raw 720000000 or 720,000,000원 (한서: "통일성이 생명").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { formatMoney, formatCH } from '../public/js/money.js';
import { formatWon } from '../lib/notifications.mjs';
import { newsFor, bigLossText } from '../lib/news.mjs';
import { defaultState, newUser } from '../lib/state.mjs';
import { settleHouseGame } from '../lib/economy.mjs';
import { pushFeed } from '../lib/engagement.mjs';

const RAW = /\d{5,}|\d{1,3}(,\d{3}){2,}/; // 1000000000 or 1,000,000,000

test('the server words money with the same formatter as the screens', () => {
  for (const n of [1_000_000, 5_000_000, 50_000_000, 120_000_000, 1_000_000_000, 3_500_000_000, 25_000_000_000, 123_400_000_000, 2_500_000_000_000]) {
    assert.equal(formatWon(n), formatMoney(n));
    assert.doesNotMatch(formatWon(n), RAW);
  }
  assert.equal(formatWon(5_000_000), '500만원');
  assert.equal(formatWon(1_000_000_000), '10억원');
  assert.equal(formatWon(-3), '0원');
  // Chips never use thousands separators either: 1234억, like formatMoney.
  assert.equal(formatCH(123_400_000_000), '1234억');
  assert.equal(formatMoney(123_400_000_000), '1234억원');
});

test('a big loss is stored as a number and reads 35억원 in the banner and the feed', () => {
  const state = defaultState();
  const u = newUser(state, 'min', 'MIN');
  state.users.min = u;
  u.account.available = 10_000_000_000;
  const since = Date.now() - 1000;
  settleHouseGame(state, u, { game: 'Blackjack', stake: 3_500_000_000, netPnl: -3_500_000_000, roundId: 'r1' });
  const row = state.feed.find(f => f.type === 'BIG_LOSS');
  assert.equal(row.amount, 3_500_000_000);
  assert.equal(row.game, 'Blackjack');
  assert.doesNotMatch(row.text, RAW);
  const banner = newsFor(state, 'someone', since).find(n => n.type === 'BIG_LOSS');
  assert.equal(banner.body, 'MIN님이 블랙잭에서 35억원을 잃었어요.');
});

test('old big-loss rows written as 3,000,000,000원 are reworded too', () => {
  assert.equal(bigLossText('MIN', { text: 'MIN님이 Roulette에서 3,000,000,000원을 잃었어요.' }), 'MIN님이 룰렛에서 30억원을 잃었어요.');
  assert.equal(bigLossText('MIN', {}), 'MIN님이 큰 판에서 졌어요.');
});

test('no banner or push the server writes carries a raw number', () => {
  const state = defaultState();
  const since = Date.now() - 1000;
  for (const [type, extra] of [['JACKPOT', { game: 'Slots' }], ['HOT_WIN', { game: 'Roulette', multiple: 2 }], ['BANKRUPTCY', { game: 'Baccarat' }], ['LUXURY', { name: '요트' }], ['BIG_LOSS', { game: 'Seotda' }]]) {
    pushFeed(state, { type, actorId: 'zero', amount: 12_345_000_000, ...extra });
  }
  const items = newsFor(state, 'hanseo', since);
  assert.equal(items.length, 5);
  for (const n of items) assert.doesNotMatch(`${n.title} ${n.body}`, RAW, n.type);
});

// Source sweep: nobody hand-rolls money again with toLocaleString + 원, or spaces 만 원.
test('money is never spelled out by hand in the app or server text', () => {
  const files = [
    ...readdirSync(new URL('../lib/', import.meta.url)).filter(f => f.endsWith('.mjs')).map(f => `lib/${f}`),
    ...readdirSync(new URL('../public/js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `public/js/${f}`),
    ...readdirSync(new URL('../public/js/games/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `public/js/games/${f}`),
    'public/app.js'
  ];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /toLocaleString\([^)]*\)\}\s?원/, `${f}: use formatMoney`);
    assert.doesNotMatch(src, /formatFull|formatWon\(.*\)\}원/, `${f}: use formatMoney`);
    const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /[0-9만억조천] 원(?![가-힣])/, `${f}: write 100만원, not 100만 원`);
  }
});
