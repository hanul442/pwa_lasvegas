// 경마: six AI horses from a stable of twelve run 1200m. Each horse has a hidden strength for the
// race; the win and place odds are quoted from it with a house margin, and the finishing order is
// drawn from the same strengths (Harville / Plackett-Luce), so the quoted odds are honest odds
// with the house edge built in. The server also draws every horse's split times, which the
// client animates: who leads at each pole, who closes late, and how close the photo is.
import crypto from 'node:crypto';
import { id } from './state.mjs';
import { fairMoney, isMoney } from './constants.mjs';

export const HORSE_GAME = 'Horse Racing';
export const RUNNERS = 6;
export const DISTANCE = 1200;
export const SEGMENTS = 8; // a split every 150m
// The house keeps 5% of a fair price before the odds are rounded down to the board's step.
export const HOUSE_MARGIN = 0.05;
export const BET_TYPES = ['WIN', 'PLACE']; // 단승: wins · 연승: finishes first or second
const FORM_LENGTH = 5;
// Strengths are re-drawn until every runner's win chance sits in this band, so no horse is a
// sure thing and no price runs past the board.
const P_MIN = 0.035, P_MAX = 0.42;

// style: FRONT 선행 (goes to the lead), STALK 선입 (sits just behind), CLOSE 추입 (comes late).
// base: the horse's class (hidden); condition on the day moves it a few points either way.
export const STABLE = [
  { id: 'bolt', name: '번개돌이', style: 'FRONT', base: 83, silk: '#c8102e', tag: '게이트가 열리면 이미 앞에 있다' },
  { id: 'galaxy', name: '은하수', style: 'CLOSE', base: 86, silk: '#1d3f8f', tag: '마지막 200m의 지배자' },
  { id: 'pearl', name: '흑진주', style: 'STALK', base: 85, silk: '#141414', tag: '조용히 따라붙다 한 번에' },
  { id: 'gale', name: '질풍노도', style: 'FRONT', base: 80, silk: '#e07a1f', tag: '초반 300m는 누구보다 빠르다' },
  { id: 'windson', name: '바람의아들', style: 'CLOSE', base: 82, silk: '#5a8f3d', tag: '바깥쪽으로 돌아 들어오는 추입마' },
  { id: 'dragon', name: '청룡열차', style: 'STALK', base: 79, silk: '#1f8a8a', tag: '한번 붙으면 놓지 않는다' },
  { id: 'dawn', name: '새벽별', style: 'STALK', base: 77, silk: '#d9c7a3', tag: '새벽 조교 기록 1위' },
  { id: 'iron', name: '무쇠다리', style: 'FRONT', base: 76, silk: '#6b6f76', tag: '지치지 않는 선행마' },
  { id: 'moon', name: '달빛질주', style: 'CLOSE', base: 78, silk: '#7a4fa3', tag: '밤 경주에 강한 추입형' },
  { id: 'halla', name: '한라산', style: 'STALK', base: 81, silk: '#2f6b4f', tag: '제주 출신, 직선주로에서 힘을 쓴다' },
  { id: 'baekdu', name: '백두대간', style: 'FRONT', base: 84, silk: '#a32a3a', tag: '체중 520kg, 밀어붙이는 힘' },
  { id: 'hero', name: '꼬마영웅', style: 'CLOSE', base: 74, silk: '#e3b505', tag: '몸집은 작아도 승부욕은 최고' }
];
const byId = Object.fromEntries(STABLE.map(h => [h.id, h]));

const defaultRng = () => crypto.randomInt(0, 2 ** 47) / 2 ** 47;
const gauss = rng => { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); };
const uniform = (rng, a, b) => a + (b - a) * rng();
function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- probabilities ----------
export const winProbabilities = strengths => { const s = strengths.reduce((a, b) => a + b, 0); return strengths.map(x => x / s); };
// Harville: the chance of finishing first or second.
export function placeProbabilities(strengths) {
  const S = strengths.reduce((a, b) => a + b, 0);
  return strengths.map((si, i) => si / S + strengths.reduce((t, sj, j) => (j === i ? t : t + (sj / S) * (si / (S - sj))), 0));
}

// Odds are quoted as the total return per 1 staked, in hundredths (420 = 4.2배): the fair price
// less the margin, rounded down to 0.05 under 3배 and to 0.1 above.
export function quoteOdds(p, margin = HOUSE_MARGIN) {
  const raw = (1 - margin) / p * 100;
  const step = raw < 300 ? 5 : 10;
  return Math.max(105, Math.min(9990, Math.floor(raw / step + 1e-9) * step));
}

// A bet's net: the winnings above the stake, in whole 100만s on real stakes (a remainder rounds
// up or down at random so the average is the quoted price) and whole won on bare engine tests.
export function horsePayout(stake, odds, rand) {
  const exact = stake * (odds - 100) / 100;
  return isMoney(stake) ? fairMoney(exact, rand) : Math.floor(exact);
}

// Plackett-Luce draw: the winner in proportion to strength, then second among the rest, and so on.
export function drawOrder(strengths, rng = defaultRng) {
  const left = strengths.map((s, i) => i);
  const order = [];
  while (left.length) {
    const total = left.reduce((t, i) => t + strengths[i], 0);
    let r = rng() * total, k = 0;
    for (; k < left.length - 1; k++) { r -= strengths[left[k]]; if (r < 0) break; }
    order.push(left.splice(k, 1)[0]);
  }
  return order;
}

// ---------- stable form ----------
// Last five finishes per horse, newest first. A new player's stable gets a history by running a
// few races among the whole stable at base class.
function seedForm(rng) {
  const form = Object.fromEntries(STABLE.map(h => [h.id, []]));
  while (STABLE.some(h => form[h.id].length < FORM_LENGTH)) {
    const field = shuffle(STABLE, rng).slice(0, RUNNERS);
    const order = drawOrder(field.map(h => strengthOf(h.base + gauss(rng) * 4)), rng);
    order.forEach((runner, place) => { const f = form[field[runner].id]; if (f.length < FORM_LENGTH) f.unshift(place + 1); });
  }
  return form;
}
const strengthOf = rating => Math.exp((rating - 80) / 6);

// ---------- race card ----------
export function createCard(form, raceNo = 1, rng = defaultRng) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const field = shuffle(STABLE, rng).slice(0, RUNNERS);
    const strengths = field.map(h => strengthOf(h.base + gauss(rng) * 4));
    const p = winProbabilities(strengths);
    if (p.some(x => x < P_MIN || x > P_MAX)) continue;
    const pp = placeProbabilities(strengths);
    return {
      id: id('race'), raceNo, distance: DISTANCE,
      runners: field.map((h, i) => ({ gate: i + 1, id: h.id, strength: strengths[i], win: quoteOdds(p[i]), place: quoteOdds(pp[i]), form: [...(form?.[h.id] || [])] }))
    };
  }
  throw new Error('RACE_CARD_FAILED');
}

// What the player sees: no strengths.
export function publicCard(card) {
  if (!card) return null;
  return {
    id: card.id, raceNo: card.raceNo, distance: card.distance,
    runners: card.runners.map(r => { const h = byId[r.id]; return { gate: r.gate, id: r.id, name: h.name, style: h.style, silk: h.silk, tag: h.tag, form: r.form, win: r.win, place: r.place }; })
  };
}

// The player's racing book: the stable's form and the card for the next race.
export function racingBook(user, rng = defaultRng) {
  if (!user.racing?.card) {
    const form = user.racing?.form || seedForm(rng);
    const raceNo = (user.racing?.raceNo || 0) + 1;
    user.racing = { form, raceNo, card: createCard(form, raceNo, rng) };
  }
  return user.racing;
}

// ---------- the race ----------
// Pace shape per style across the eight 150m segments: >0 is slower than even, <0 faster.
const STYLE_SHAPE = {
  FRONT: [-0.07, -0.05, -0.03, -0.01, 0.01, 0.03, 0.05, 0.07],
  STALK: [-0.025, -0.02, -0.015, -0.005, 0.0, 0.01, 0.02, 0.03],
  CLOSE: [0.07, 0.055, 0.035, 0.015, -0.01, -0.035, -0.06, -0.075]
};
// Everyone breaks slower than they cruise; the first 150m takes longer than the rest.
const ACCEL = [1.22, 1.0, 0.98, 0.98, 0.99, 1.0, 1.01, 1.03];

// Finishing times (ms) in finishing order: a winner near 1:10, a photo finish about one race in
// three, and the field spread out behind.
function finishTimes(rng) {
  const first = Math.round(uniform(rng, 69.2, 71.4) * 1000);
  const photo = rng() < 0.33;
  const times = [first, first + Math.round(photo ? uniform(rng, 10, 70) : uniform(rng, 110, 800))];
  for (let k = 2; k < RUNNERS; k++) times.push(times[k - 1] + Math.round(uniform(rng, 40, 900)));
  return { times, photo };
}

// Cumulative split times (ms) at each 150m pole, from 0 at the gates to the finish time.
function splitsFor(style, finish, rng) {
  const shape = STYLE_SHAPE[style];
  const surgeAt = rng() < 0.35 ? Math.floor(uniform(rng, 2, SEGMENTS)) : -1;
  const w = ACCEL.map((a, k) => a * (1 + shape[k] + gauss(rng) * 0.012 + (k === surgeAt ? -0.03 : 0)));
  const scale = finish / w.reduce((a, b) => a + b, 0);
  const splits = [0];
  w.forEach(x => splits.push(splits[splits.length - 1] + x * scale));
  splits[SEGMENTS] = finish;
  return splits.map(Math.round);
}

export function runRace(card, rng = defaultRng) {
  const order = drawOrder(card.runners.map(r => r.strength), rng).map(i => card.runners[i].gate);
  const { times, photo } = finishTimes(rng);
  const finish = {};
  order.forEach((gate, k) => { finish[gate] = times[k]; });
  const splits = card.runners.map(r => splitsFor(byId[r.id].style, finish[r.gate], rng));
  return { order, times: card.runners.map(r => finish[r.gate]), splits, photo, margin: times[1] - times[0] };
}

export function betWins(betType, pick, order) {
  if (betType === 'WIN') return order[0] === pick;
  if (betType === 'PLACE') return order[0] === pick || order[1] === pick;
  throw new Error('INVALID_BET_TYPE');
}

export function validateHorseBet(card, { betType, pick, cardId }) {
  if (!card || card.id !== cardId) throw new Error('RACE_CARD_STALE');
  if (!BET_TYPES.includes(betType)) throw new Error('INVALID_BET_TYPE');
  const runner = card.runners.find(r => r.gate === pick);
  if (!Number.isInteger(pick) || !runner) throw new Error('INVALID_TARGET');
  return runner;
}

// Run the card's race for one bet and settle it. The stable's form moves on and the next card is
// drawn, so the odds the player sees next are for a new race.
export function playHorseRace(user, { stake, betType, pick, cardId }, rng = defaultRng) {
  const book = racingBook(user, rng);
  const card = book.card;
  const runner = validateHorseBet(card, { betType, pick, cardId });
  const odds = betType === 'WIN' ? runner.win : runner.place;
  const race = runRace(card, rng);
  const won = betWins(betType, pick, race.order);
  const netPnl = won ? horsePayout(stake, odds) : -stake;
  race.order.forEach((gate, place) => {
    const hid = card.runners.find(r => r.gate === gate).id;
    book.form[hid] = [place + 1, ...(book.form[hid] || [])].slice(0, FORM_LENGTH);
  });
  book.raceNo = card.raceNo + 1;
  book.card = createCard(book.form, book.raceNo, rng);
  return {
    id: id('hrs'), game: HORSE_GAME, stake, betType, pick, odds, won, netPnl,
    card: publicCard(card), ...race
  };
}
