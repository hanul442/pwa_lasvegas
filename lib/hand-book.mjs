// 족보 도감: the rare hands a player has made, one page per game. A hand is filled in the first
// time it comes up and counted every time after. The book lives on the player (user.handBook)
// and the monthly season reset (lib/rank-season.mjs) never touches it, so it fills over months.
// Finishing pages and the whole book are achievements (lib/achievements.mjs); half the book and
// the whole book each unlock a nameplate (lib/cosmetics.mjs).
import { evaluate } from './holdem.mjs';
import { seotdaHand } from './seotda.mjs';
import { matgoScore } from './matgo.mjs';
import { blackjackValue } from './blackjack-v2.mjs';
import { pushFeed } from './engagement.mjs';

export const HAND_BOOK_PAGES = [
  { id: 'seotda', name: '섯다' },
  { id: 'hwatu', name: '고스톱·맞고' },
  { id: 'poker', name: '포커' },
  { id: 'blackjack', name: '블랙잭' },
  { id: 'baccarat', name: '바카라' },
  { id: 'roulette', name: '룰렛' },
  { id: 'dice', name: '식보' },
  { id: 'slots', name: '슬롯' }
];

// tier: 1 흔함, 2 귀함, 3 전설. Legend-tier first hits go to the lounge feed.
const E = (page, id, name, desc, tier) => ({ page, id, name, desc, tier });
export const HAND_BOOK = [
  E('seotda', 'sd-38', '38광땡', '3월 광과 8월 광', 3),
  E('seotda', 'sd-18', '18광땡', '1월 광과 8월 광', 3),
  E('seotda', 'sd-13', '13광땡', '1월 광과 3월 광', 3),
  E('seotda', 'sd-jang', '장땡', '10월 두 장', 2),
  E('seotda', 'sd-ttaeng', '땡', '같은 달 두 장 (1~9땡)', 2),
  E('seotda', 'sd-ali', '알리', '1월과 2월', 1),
  E('seotda', 'sd-doksa', '독사', '1월과 4월', 1),
  E('seotda', 'sd-gubbing', '구삥', '1월과 9월', 1),
  E('seotda', 'sd-jangbbing', '장삥', '1월과 10월', 1),
  E('seotda', 'sd-jangsa', '장사', '4월과 10월', 1),
  E('seotda', 'sd-seryuk', '세륙', '4월과 6월', 1),
  E('seotda', 'sd-gabo', '갑오', '끗수 아홉', 1),
  E('seotda', 'sd-mangtong', '망통', '끗수 영, 가장 낮은 패', 1),
  E('seotda', 'sd-amhaeng', '암행어사', '4월 열끗과 7월 열끗', 2),
  E('seotda', 'sd-ttaengjabi', '땡잡이', '3월 광과 7월 열끗', 2),
  E('seotda', 'sd-gusa', '구사', '4월과 9월, 판을 다시', 2),
  E('seotda', 'sd-mgusa', '멍텅구리구사', '4월 열끗과 9월 열끗', 3),

  E('hwatu', 'hw-ogwang', '오광', '광 다섯 장을 모두', 3),
  E('hwatu', 'hw-sagwang', '사광', '광 네 장', 2),
  E('hwatu', 'hw-samgwang', '삼광', '비광 없이 광 세 장', 1),
  E('hwatu', 'hw-bisamgwang', '비삼광', '비광 끼고 광 세 장', 1),
  E('hwatu', 'hw-godori', '고도리', '새 세 마리', 2),
  E('hwatu', 'hw-hongdan', '홍단', '1·2·3월 붉은 띠', 1),
  E('hwatu', 'hw-cheongdan', '청단', '6·9·10월 푸른 띠', 1),
  E('hwatu', 'hw-chodan', '초단', '4·5·7월 풀 띠', 1),
  E('hwatu', 'hw-threego', '쓰리고', '고를 세 번 외치고 이기기', 3),
  E('hwatu', 'hw-shake', '흔들기 승', '흔들고 이기기', 2),
  E('hwatu', 'hw-meongtta', '멍따', '열끗 일곱 장으로 이기기', 2),
  E('hwatu', 'hw-pibak', '피박', '상대를 피박 씌우고 이기기', 1),
  E('hwatu', 'hw-gwangbak', '광박', '상대를 광박 씌우고 이기기', 2),

  E('poker', 'pk-royal', '로열 스트레이트 플러시', '같은 무늬 10·J·Q·K·A', 3),
  E('poker', 'pk-sf', '스트레이트 플러시', '같은 무늬로 이어진 다섯 장', 3),
  E('poker', 'pk-quads', '포카드', '같은 숫자 네 장', 2),
  E('poker', 'pk-full', '풀하우스', '트리플과 원페어', 2),
  E('poker', 'pk-flush', '플러시', '같은 무늬 다섯 장', 1),
  E('poker', 'pk-mountain', '마운틴', '10·J·Q·K·A 스트레이트', 2),
  E('poker', 'pk-back', '백스트레이트', 'A·2·3·4·5 스트레이트', 2),
  E('poker', 'pk-straight', '스트레이트', '이어진 숫자 다섯 장', 1),
  E('poker', 'pk-trips', '트리플', '같은 숫자 세 장', 1),

  E('blackjack', 'bj-natural', '블랙잭', '처음 두 장으로 21', 1),
  E('blackjack', 'bj-suited', '수트 블랙잭', '같은 무늬 A와 10·그림', 2),
  E('blackjack', 'bj-777', '세븐 세븐 세븐', '7 세 장으로 21', 3),
  E('blackjack', 'bj-five', '파이브 카드', '다섯 장 이상, 버스트 없이', 2),
  E('blackjack', 'bj-perfect', '퍼펙트 페어', '처음 두 장이 같은 숫자 같은 무늬', 2),
  E('blackjack', 'bj-suitedtrips', '수트 트립스', '21+3, 같은 카드 세 장', 3),

  E('baccarat', 'bac-natural', '내추럴 9', '두 장으로 9, 건 쪽이 이기기', 1),
  E('baccarat', 'bac-tie', '타이 적중', '타이에 걸어 맞히기', 2),
  E('baccarat', 'bac-pair', '페어 적중', '페어 사이드 베팅 맞히기', 1),

  E('roulette', 'rl-straight', '스트레이트 업', '숫자 하나에 걸어 맞히기', 1),
  E('roulette', 'rl-zero', '제로', '0에 걸어 맞히기', 2),
  E('roulette', 'rl-lightning', '라이트닝 적중', '번개 맞은 숫자로 이기기', 3),

  E('dice', 'sb-triple', '트리플 적중', '애니 트리플에 걸어 맞히기', 2),
  E('dice', 'sb-edge', '끝수 적중', '합계 4나 17에 걸어 맞히기', 3),

  E('slots', 'sl-seven', '세븐 세븐 세븐', '라인에 7 세 개', 2),
  E('slots', 'sl-free', '프리 스핀', 'FREE 코인 세 개', 1),
  E('slots', 'sl-jackpot', '잭팟', '별 세 개', 3)
];
const BY_ID = new Map(HAND_BOOK.map(h => [h.id, h]));
export const handBookEntry = id => BY_ID.get(id) ?? null;

const SEOTDA_IDS = {
  '38광땡': 'sd-38', '18광땡': 'sd-18', '13광땡': 'sd-13', '장땡': 'sd-jang', '알리': 'sd-ali', '독사': 'sd-doksa',
  '구삥': 'sd-gubbing', '장삥': 'sd-jangbbing', '장사': 'sd-jangsa', '세륙': 'sd-seryuk', '갑오': 'sd-gabo', '망통': 'sd-mangtong',
  '암행어사': 'sd-amhaeng', '땡잡이': 'sd-ttaengjabi', '구사': 'sd-gusa', '멍텅구리구사': 'sd-mgusa'
};

export function bookOf(user) {
  if (!user.handBook || typeof user.handBook !== 'object' || Array.isArray(user.handBook)) user.handBook = {};
  return user.handBook;
}
export const handBookCount = user => Object.keys(user?.handBook || {}).filter(id => BY_ID.has(id)).length;
export const pageCount = (user, page) => HAND_BOOK.filter(h => h.page === page && user?.handBook?.[h.id]).length;
export const pageSize = page => HAND_BOOK.filter(h => h.page === page).length;

// ---------- reading a finished round ----------
const POKER_HIGH = score => Math.floor(score / 15 ** 4) % 15;
// The best five of a poker player's cards ({r, s}), as a page entry.
export function pokerEntry(cards) {
  if (!Array.isArray(cards) || cards.length < 5) return null;
  const ev = evaluate(cards);
  const high = POKER_HIGH(ev.score);
  if (ev.cat === 8) return high === 14 ? 'pk-royal' : 'pk-sf';
  if (ev.cat === 7) return 'pk-quads';
  if (ev.cat === 6) return 'pk-full';
  if (ev.cat === 5) return 'pk-flush';
  if (ev.cat === 4) return high === 14 ? 'pk-mountain' : high === 5 ? 'pk-back' : 'pk-straight';
  if (ev.cat === 3) return 'pk-trips';
  return null;
}

export function seotdaEntry(ids) {
  if (!Array.isArray(ids) || ids.length !== 2) return null;
  const { name } = seotdaHand(ids);
  if (SEOTDA_IDS[name]) return SEOTDA_IDS[name];
  return /^[1-9]땡$/.test(name) ? 'sd-ttaeng' : null;
}

// 고스톱·맞고: what this seat gathered, and on a win how it won.
export function hwatuEntries(round, seat) {
  const out = [];
  const pile = round.captured?.[seat];
  if (Array.isArray(pile)) {
    for (const line of matgoScore(pile).lines) {
      const id = { '5광': 'hw-ogwang', '4광': 'hw-sagwang', '3광': 'hw-samgwang', '비삼광': 'hw-bisamgwang', '고도리': 'hw-godori', '홍단': 'hw-hongdan', '청단': 'hw-cheongdan', '초단': 'hw-chodan' }[line.label];
      if (id) out.push(id);
    }
  }
  const r = round.result;
  if (r && r.winner === seat) {
    const labels = new Set([...(r.multipliers || []), ...(r.shares || []).flatMap(x => x.multipliers || [])].map(m => m.label));
    if ((round.goCount?.[seat] || 0) >= 3) out.push('hw-threego');
    if (labels.has('흔들기')) out.push('hw-shake');
    if (labels.has('멍따')) out.push('hw-meongtta');
    if (labels.has('피박')) out.push('hw-pibak');
    if (labels.has('광박')) out.push('hw-gwangbak');
  }
  return out;
}

const TEN = new Set(['10', 'J', 'Q', 'K']);
export function blackjackEntries(round) {
  const out = [];
  for (const hand of round.hands || []) {
    const cards = hand.cards || [];
    const total = blackjackValue(cards).total;
    if (!hand.fromSplit && cards.length === 2 && total === 21) {
      out.push('bj-natural');
      if (cards[0].s === cards[1].s && cards.some(c => c.r === 'A') && cards.some(c => TEN.has(c.r))) out.push('bj-suited');
    }
    if (cards.length === 3 && cards.every(c => c.r === '7')) out.push('bj-777');
    if (cards.length >= 5 && total <= 21) out.push('bj-five');
  }
  for (const bet of round.sideBets || []) {
    if (bet.kind === 'PP' && bet.result === 'PERFECT') out.push('bj-perfect');
    if (bet.kind === 'T3' && bet.result === 'SUITED_TRIPS') out.push('bj-suitedtrips');
  }
  return out;
}

export function baccaratEntries(round) {
  const out = [];
  const won = round.winner === round.betType && round.winner !== 'TIE';
  const score = round.winner === 'PLAYER' ? round.playerScore : round.bankerScore;
  if (won && round.trace?.natural && score === 9) out.push('bac-natural');
  if (round.betType === 'TIE' && round.winner === 'TIE') out.push('bac-tie');
  if ((round.sideBets || []).some(b => b.won)) out.push('bac-pair');
  return out;
}

export function rouletteEntries(round) {
  const bets = Array.isArray(round.bets) ? round.bets : [{ betType: round.betType, target: round.target, won: round.netPnl > 0, multiplier: round.lightning?.find(s => s.number === round.target)?.multiplier }];
  const out = [];
  for (const b of bets) {
    if (b.betType !== 'NUMBER' || !b.won) continue;
    out.push('rl-straight');
    if (b.target === 0) out.push('rl-zero');
    if (round.lightning && b.multiplier) out.push('rl-lightning');
  }
  return out;
}

export function sicboEntries(round) {
  if (!(round.netPnl > 0)) return [];
  if (round.betType === 'ANY_TRIPLE') return ['sb-triple'];
  if (round.betType === 'TOTAL' && (round.target === 4 || round.target === 17)) return ['sb-edge'];
  return [];
}

export function slotsEntries(round) {
  const out = [];
  const lines = [round.line, ...(round.freeSpins?.spins || []).map(s => s.line)];
  if (lines.includes('SEVEN')) out.push('sl-seven');
  if (round.freeSpins) out.push('sl-free');
  if (round.jackpot > 0) out.push('sl-jackpot');
  return out;
}

// ---------- filling the book ----------
// Notes each hand on the player's book. Returns the entries filled in for the first time.
export function noteHands(state, user, ids, now = Date.now()) {
  if (!user?.account || !ids?.length) return [];
  const book = bookOf(user);
  const fresh = [];
  const at = new Date(now).toISOString();
  for (const id of new Set(ids.filter(Boolean))) {
    const entry = BY_ID.get(id);
    if (!entry) continue;
    const rec = book[id];
    if (rec) { rec.count = (rec.count || 1) + 1; rec.last = at; continue; }
    book[id] = { at, last: at, count: 1 };
    fresh.push(entry);
    if (entry.tier === 3 && state) pushFeed(state, { type: 'HAND_BOOK', actorId: user.id, text: entry.name, entry: id });
  }
  return fresh;
}

// Reads a finished round of `game` for the hands `seat` made, and notes them. Never throws:
// the book is a keepsake and must not get in the way of a settlement.
export function noteRound(state, user, game, round, seat = 0) {
  try {
    if (!round) return [];
    let ids = [];
    if (game === 'Seotda') ids = [seotdaEntry(round.hands?.[seat])];
    else if (game === 'Matgo' || game === 'Gostop') ids = hwatuEntries(round, seat);
    else if (game === 'Blackjack') ids = blackjackEntries(round.players ? { hands: round.players[seat]?.hands } : round); // a friends' room keeps hands per seat
    else if (game === 'Baccarat') ids = baccaratEntries(round);
    else if (game === 'Roulette') ids = rouletteEntries(round);
    else if (game === 'Sic Bo') ids = sicboEntries(round);
    else if (game === 'Slots') ids = slotsEntries(round);
    return noteHands(state, user, ids);
  } catch { return []; }
}

// A poker hand that reached the end with this seat still in it and every card out: Hold'em
// (two hole cards and a five-card board) or 7포커 (seven cards).
export function notePokerHand(state, user, hand, seat = 0) {
  try {
    const p = hand?.players?.[seat];
    if (!hand?.over || !p || p.folded) return [];
    const cards = [...(p.cards || []), ...(hand.board || [])];
    if (cards.length < 7) return [];
    return noteHands(state, user, [pokerEntry(cards)]);
  } catch { return []; }
}

export function handBookView(user) {
  const book = user?.handBook || {};
  return {
    count: handBookCount(user),
    total: HAND_BOOK.length,
    pages: HAND_BOOK_PAGES.map(p => ({ ...p, count: pageCount(user, p.id), total: pageSize(p.id) })),
    entries: HAND_BOOK.map(h => ({ ...h, got: Boolean(book[h.id]), at: book[h.id]?.at ?? null, count: book[h.id]?.count ?? 0 }))
  };
}
