// 오늘의 한 판: a Wordle-style daily blackjack. Every player gets the same ten deals each day (Seoul
// time), plays them once, and is ranked on one board. No chips change hands: it is points only.
//
// Each hand has its own shuffled six-deck shoe, drawn from a secret kept in the server state, so a
// choice in hand 3 never changes the cards of hand 4 and everyone starts every hand the same.
// A player's game is stored as the list of moves they made; the hands are rebuilt from the shoe
// and those moves on every request, so the server never has to trust the page.
import crypto from 'node:crypto';
import { basicStrategy } from '../public/js/bj-strategy.js';

export const DAILY_HANDS = 10;
export const DAILY_START = 1000; // points before the first hand
export const DAILY_BET = 100; // points riding on every hand
const DAY_ONE = Date.UTC(2026, 9, 24); // 오늘의 한 판 #1, a Seoul date
const KEEP_DAYS = 8;
const BOARD_SIZE = 20;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const MOVES = new Set(['hit', 'stand', 'double', 'split']);

// ---------- days ----------
export function seoulDay(now = Date.now()) {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function dayNumber(day) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - DAY_ONE) / 86_400_000) + 1;
}
function previousDay(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
// The moment this Seoul day ends, for the page's countdown.
export function dayEndsAt(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000 - 9 * 3_600_000).toISOString();
}

// ---------- the shoe ----------
// A stream of 32-bit numbers from sha256(secret, day, hand, block): the same for every player.
function stream(secret, day, hand) {
  let block = 0, buf = null, at = 8;
  return () => {
    if (at >= 8) { buf = crypto.createHash('sha256').update(`${secret}|${day}|${hand}|${block++}`).digest(); at = 0; }
    return buf.readUInt32BE(4 * at++);
  };
}
export function dailyShoe(secret, day, hand) {
  const next = stream(secret, day, hand);
  const cards = [];
  for (let d = 0; d < 6; d++) for (const s of SUITS) for (const r of RANKS) cards.push(`${r}${s}`);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// ---------- one hand ----------
const rankOf = c => c.slice(0, -1);
const pip = r => (r === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(r) ? 10 : Number(r));
export function total(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { const r = rankOf(c); if (r === 'A') aces++; t += pip(r); }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0 && t <= 21 };
}
const isNatural = cards => cards.length === 2 && total(cards).total === 21;

function canDouble(hand) { return hand.cards.length === 2 && !hand.splitAces && !hand.done; }
function canSplit(play, hand) {
  return play.hands.length === 1 && hand.cards.length === 2 && pip(rankOf(hand.cards[0])) === pip(rankOf(hand.cards[1]));
}
export function allowedMoves(play) {
  if (play.over) return [];
  const hand = play.hands[play.active];
  const out = ['hit', 'stand'];
  if (canDouble(hand)) out.push('double');
  if (canSplit(play, hand)) out.push('split');
  return out;
}

// Plays one hand from its shoe and the moves made so far. Rules: dealer stands on all 17s and
// peeks for blackjack, blackjack pays 3:2, double on any first two cards (also after a split),
// split once, split aces get one card each, no insurance or surrender.
export function playHand(shoe, moves = []) {
  let at = 0;
  const draw = () => shoe[at++];
  const p1 = draw(), d1 = draw(), p2 = draw(), d2 = draw();
  const play = { dealer: [d1, d2], hands: [{ cards: [p1, p2], bet: 1, done: false }], active: 0, over: false, moves: [] };
  const dealerNatural = isNatural(play.dealer);
  if (dealerNatural || isNatural(play.hands[0].cards)) { play.hands[0].done = true; play.over = true; }
  // After a hand closes, move to the next one; a split hand gets its second card when its turn comes.
  const advance = () => {
    while (play.active < play.hands.length && play.hands[play.active].done) {
      play.active++;
      const next = play.hands[play.active];
      if (next && next.cards.length === 1) {
        next.cards.push(draw());
        if (next.splitAces || total(next.cards).total === 21) next.done = true;
      }
    }
    if (play.active >= play.hands.length) { play.active = play.hands.length - 1; play.over = true; }
  };
  for (const move of moves) {
    if (!allowedMoves(play).includes(move)) throw new Error('DAILY_BAD_MOVE');
    const hand = play.hands[play.active];
    if (move === 'hit') {
      hand.cards.push(draw());
      if (total(hand.cards).total >= 21) hand.done = true;
    } else if (move === 'stand') hand.done = true;
    else if (move === 'double') { hand.bet = 2; hand.doubled = true; hand.cards.push(draw()); hand.done = true; }
    else if (move === 'split') {
      const aces = rankOf(hand.cards[0]) === 'A';
      const second = { cards: [hand.cards[1]], bet: 1, done: false, split: true, splitAces: aces };
      hand.cards = [hand.cards[0], draw()];
      hand.split = true; hand.splitAces = aces;
      play.hands.push(second);
      if (aces || total(hand.cards).total === 21) hand.done = true;
    }
    play.moves.push(move);
    advance();
  }
  if (play.over) {
    // The dealer plays only if a hand is still standing; S17.
    const live = play.hands.some(h => total(h.cards).total <= 21) && !dealerNatural && !(play.hands.length === 1 && isNatural(play.hands[0].cards));
    if (live) while (total(play.dealer).total < 17) play.dealer.push(draw());
    const dv = total(play.dealer).total;
    let net = 0;
    for (const h of play.hands) {
      const v = total(h.cards).total;
      const natural = !h.split && isNatural(h.cards);
      if (natural && !dealerNatural) h.result = 'blackjack', h.net = 1.5;
      else if (natural && dealerNatural) h.result = 'push', h.net = 0;
      else if (dealerNatural) h.result = 'lose', h.net = -h.bet;
      else if (v > 21) h.result = 'bust', h.net = -h.bet;
      else if (dv > 21 || v > dv) h.result = 'win', h.net = h.bet;
      else if (v === dv) h.result = 'push', h.net = 0;
      else h.result = 'lose', h.net = -h.bet;
      net += h.net;
    }
    play.net = net;
    play.points = Math.round(net * DAILY_BET);
    play.mark = markOf(play);
  }
  return play;
}

// One emoji per hand for the share text.
export function markOf(play) {
  if (play.hands.some(h => h.result === 'blackjack')) return '⭐';
  if (play.net >= 2) return '💰';
  if (play.net > 0) return '🟩';
  if (play.net === 0) return '🟨';
  if (play.hands.every(h => h.result === 'bust')) return '💥';
  return '🟥';
}

// What the house's textbook (basic strategy) would have scored on today's deals.
export function bookScore(secret, day) {
  let points = DAILY_START;
  for (let i = 0; i < DAILY_HANDS; i++) {
    const shoe = dailyShoe(secret, day, i);
    const moves = [];
    let play = playHand(shoe, moves);
    while (!play.over) {
      const hand = play.hands[play.active];
      const allowed = allowedMoves(play);
      const pick = basicStrategy(hand.cards, play.dealer[0], { canDouble: allowed.includes('double'), canSplit: allowed.includes('split') });
      moves.push({ HIT: 'hit', STAND: 'stand', DOUBLE: 'double', SPLIT: 'split' }[pick] || 'stand');
      play = playHand(shoe, moves);
    }
    points += play.points;
  }
  return points;
}

// ---------- the store ----------
function ensureDaily(state) {
  const d = (state.dailyBj ??= {});
  d.secret ??= crypto.randomBytes(24).toString('hex');
  d.days ??= {};
  d.games ??= {};
  d.players ??= {};
  return d;
}
function dayOf(d, day) {
  const box = (d.days[day] ??= { results: {} });
  return box;
}
function prune(d, today) {
  const keep = new Set(Array.from({ length: KEEP_DAYS }, (_, k) => new Date(Date.parse(`${today}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10)));
  for (const day of Object.keys(d.days)) if (!keep.has(day)) delete d.days[day];
  for (const [uid, g] of Object.entries(d.games)) if (!keep.has(g.day)) delete d.games[uid];
}

// Rebuilds a stored game: the finished hands and the one being played.
function rebuild(secret, game) {
  const hands = [];
  for (let i = 0; i < game.moves.length; i++) hands.push(playHand(dailyShoe(secret, game.day, i), game.moves[i]));
  return hands;
}
const stepsOf = game => game.moves.reduce((n, m) => n + m.length, 0) + game.moves.length;

function handView(play, i, reveal) {
  const open = reveal || play.over;
  return {
    no: i + 1,
    dealer: open ? play.dealer : [play.dealer[0], 'HIDDEN'],
    dealerTotal: open ? total(play.dealer).total : total([play.dealer[0]]).total,
    hands: play.hands.map(h => ({ cards: h.cards, total: total(h.cards).total, soft: total(h.cards).soft, bet: h.bet, doubled: Boolean(h.doubled), result: h.result ?? null, net: h.net ?? null })),
    active: play.active,
    over: play.over,
    allowed: allowedMoves(play),
    points: play.over ? play.points : null,
    mark: play.over ? play.mark : null
  };
}

export function shareText(result, { rank = null, players = 0, streak = 0 } = {}) {
  const sign = result.score - DAILY_START;
  const lines = [`오늘의 한 판 #${result.no} 🃏 ${result.score.toLocaleString('ko-KR')}점 (${sign >= 0 ? '+' : ''}${sign})`, result.marks];
  const extra = [];
  if (rank && players > 1) extra.push(`${players}명 중 ${rank}등`);
  if (streak > 1) extra.push(`🔥 ${streak}일 연속`);
  if (extra.length) lines.push(extra.join(' · '));
  return lines.join('\n');
}

function boardOf(state, d, day, userId) {
  const results = Object.entries(dayOf(d, day).results).map(([uid, r]) => ({ userId: uid, ...r }));
  results.sort((a, b) => b.score - a.score || a.at.localeCompare(b.at));
  const nick = uid => state.users[uid]?.nickname ?? '손님';
  const rows = results.map((r, i) => ({ rank: results.findIndex(x => x.score === r.score) + 1, nickname: nick(r.userId), score: r.score, marks: r.marks, me: r.userId === userId, order: i }));
  const mine = rows.find(r => r.me) || null;
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : null;
  return {
    players: rows.length,
    average: avg,
    top: rows.slice(0, BOARD_SIZE).map(({ order, ...r }) => r),
    me: mine ? { rank: mine.rank, score: mine.score, beat: rows.length > 1 ? Math.round(100 * rows.filter(r => r.score < mine.score).length / (rows.length - 1)) : null } : null
  };
}

// Everything the page needs: today's number, my game (or that it hasn't started), and the board.
export function dailyView(state, userId, now = Date.now()) {
  const d = ensureDaily(state);
  const today = seoulDay(now);
  let game = d.games[userId];
  // A game from an earlier day that was finished is history; one left half played can be finished.
  if (game && game.day !== today && game.done) game = null;
  const day = game?.day ?? today;
  const box = dayOf(d, day);
  box.book ??= bookScore(d.secret, day);
  const hands = game ? rebuild(d.secret, game) : [];
  const score = DAILY_START + hands.filter(h => h.over).reduce((s, h) => s + h.points, 0);
  const done = Boolean(game?.done);
  const result = done ? box.results[userId] : null;
  const me = d.players[userId] || {};
  const streak = me.lastDay === today || me.lastDay === previousDay(today) ? me.streak || 0 : 0;
  const yesterday = boardOf(state, d, previousDay(today), userId);
  const board = boardOf(state, d, day, userId);
  return {
    day, no: dayNumber(day), today, endsAt: dayEndsAt(today),
    status: !game ? 'READY' : done ? 'DONE' : 'PLAYING',
    hands: hands.map((h, i) => handView(h, i, false)),
    step: game ? stepsOf(game) : 0,
    score,
    marks: hands.filter(h => h.over).map(h => h.mark).join(''),
    total: DAILY_HANDS, start: DAILY_START, bet: DAILY_BET,
    book: box.book,
    board,
    yesterdayTop: yesterday.top[0] ? { nickname: yesterday.top[0].nickname, score: yesterday.top[0].score } : null,
    streak, bestStreak: me.best || 0, played: me.played || 0,
    share: result ? shareText(result, { rank: board.me?.rank, players: board.players, streak }) : null
  };
}

// The one command: 'start' deals hand 1, 'next' deals the following hand, and hit/stand/double/
// split play the hand in front of the player. `step` is how many commands the page has seen; a
// retry of a command that already landed (or a page out of date) just gets the game back.
export function dailyCommand(state, userId, { move, step } = {}, now = Date.now()) {
  const d = ensureDaily(state);
  const today = seoulDay(now);
  prune(d, today);
  let game = d.games[userId];
  if (game && game.day !== today && game.done) game = null;
  if (move === 'start') {
    if (game) return dailyView(state, userId, now);
    if (dayOf(d, today).results[userId]) throw new Error('DAILY_ALREADY_PLAYED');
    d.games[userId] = { day: today, moves: [[]], startedAt: new Date(now).toISOString() };
    return dailyView(state, userId, now);
  }
  if (!game) throw new Error('DAILY_NOT_STARTED');
  if (Number(step) !== stepsOf(game)) return dailyView(state, userId, now);
  if (game.done) return dailyView(state, userId, now);
  const hands = rebuild(d.secret, game);
  const current = hands[hands.length - 1];
  if (move === 'next') {
    if (!current.over || game.moves.length >= DAILY_HANDS) throw new Error('DAILY_BAD_MOVE');
    game.moves.push([]);
    // The last hand can be over the moment it is dealt (a blackjack either side).
    const after = rebuild(d.secret, game);
    if (after[after.length - 1].over && game.moves.length === DAILY_HANDS) finish(d, game, userId, after, now);
    return dailyView(state, userId, now);
  }
  if (!MOVES.has(move)) throw new Error('DAILY_BAD_MOVE');
  const moves = [...game.moves[game.moves.length - 1], move];
  const play = playHand(dailyShoe(d.secret, game.day, game.moves.length - 1), moves); // throws on an illegal move
  game.moves[game.moves.length - 1] = moves;
  if (play.over && game.moves.length === DAILY_HANDS) finish(d, game, userId, rebuild(d.secret, game), now);
  return dailyView(state, userId, now);
}

function finish(d, game, userId, hands, now) {
  game.done = true;
  const score = DAILY_START + hands.reduce((s, h) => s + h.points, 0);
  const marks = hands.map(h => h.mark).join('');
  dayOf(d, game.day).results[userId] = { score, marks, no: dayNumber(game.day), at: new Date(now).toISOString() };
  const p = (d.players[userId] ??= { streak: 0, best: 0, played: 0, lastDay: null });
  p.streak = p.lastDay === previousDay(game.day) ? p.streak + 1 : p.lastDay === game.day ? p.streak : 1;
  p.best = Math.max(p.best, p.streak);
  p.played += 1;
  p.lastDay = game.day;
}

// The home chip: has this player played today, and what did they score.
export function dailySummary(state, userId, now = Date.now()) {
  const d = state.dailyBj;
  const today = seoulDay(now);
  const r = d?.days?.[today]?.results?.[userId];
  const g = d?.games?.[userId];
  return { no: dayNumber(today), played: Boolean(r), score: r?.score ?? null, playing: Boolean(g && g.day === today && !g.done), players: Object.keys(d?.days?.[today]?.results || {}).length };
}
