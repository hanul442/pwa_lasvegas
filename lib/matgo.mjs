// 맞고 (two-player Go-Stop). Pure state machine: every seat acts through matgoAct(), and
// the AI seat is driven by runMatgoAi() using only what that seat could see at a real table.
// Seats are plain objects, so a second human can take seat 1 when friends play arrives.
// The turn engine works for any number of seats: 고스톱 (lib/gostop.mjs) registers its own
// goal and settlement with defineGoStopRules() and plays through the same matgoAct().
import { HWATU, cardById, shuffle, defaultRng } from './hwatu.mjs';
import { id } from './state.mjs';
import { aiSkillFor } from './constants.mjs';

export const MATGO_ENGINE = 'MATGO_V1';
export const MATGO_GOAL = 7;
export const MATGO_DEPOSIT_POINTS = 10; // points reserved up front; bigger losses draw on the rest of the bankroll
export const MATGO_MAX_POINTS = 100;
// 묻고 더블로 가: a 나가리 carries the hand into the next one at twice the points, and again on
// every further 나가리, up to ×8.
export const NAGARI_MAX_DOUBLE = 8;
export const nextDouble = (round) => Math.min(NAGARI_MAX_DOUBLE, (round.double || 1) * 2);
export const validDouble = d => [1, 2, 4, 8].includes(d);
const DUMMY = 'BOMB'; // flip-only turns granted by 폭탄

const isDummy = cardId => cardId.startsWith(DUMMY);
const card = cardId => cardById(cardId);
const monthOf = cardId => card(cardId)?.month ?? 0;
const other = seat => 1 - seat;
const opponents = (round, seat) => round.hands.map((_, s) => s).filter(s => s !== seat);

// Per-game rules keyed by round.game: the score that lets a seat call 고, how bold the AI is
// about calling it, and how a stop is paid.
const RULES = new Map();
export function defineGoStopRules(game, rules) { RULES.set(game, rules); }
const rulesOf = round => RULES.get(round.game) || RULES.get('Matgo');

// ---------- scoring ----------
function tally(ids, gukjinAsPi) {
  const cards = ids.map(card);
  const gwang = cards.filter(c => c.kind === 'gwang');
  const yeol = cards.filter(c => c.kind === 'yeol' && !(c.gukjin && gukjinAsPi));
  const tti = cards.filter(c => c.kind === 'tti');
  const piCount = cards.reduce((n, c) => n + (c.kind === 'pi' ? (c.double ? 2 : 1) : c.gukjin && gukjinAsPi ? 2 : 0), 0);
  const lines = [];
  let gwangPts = 0;
  if (gwang.length === 5) gwangPts = 15;
  else if (gwang.length === 4) gwangPts = 4;
  else if (gwang.length === 3) gwangPts = gwang.some(c => c.rain) ? 2 : 3;
  if (gwangPts) lines.push({ label: gwang.length === 3 && gwangPts === 2 ? '비삼광' : `${gwang.length}광`, points: gwangPts });
  const birds = yeol.filter(c => c.bird).length;
  if (birds === 3) lines.push({ label: '고도리', points: 5 });
  if (yeol.length >= 5) lines.push({ label: `열끗 ${yeol.length}장`, points: yeol.length - 4 });
  for (const [ribbon, label] of [['hong', '홍단'], ['cheong', '청단'], ['cho', '초단']]) {
    if (tti.filter(c => c.ribbon === ribbon).length === 3) lines.push({ label, points: 3 });
  }
  if (tti.length >= 5) lines.push({ label: `띠 ${tti.length}장`, points: tti.length - 4 });
  if (piCount >= 10) lines.push({ label: `피 ${piCount}장`, points: piCount - 9 });
  const base = lines.reduce((s, l) => s + l.points, 0);
  return { base, lines, gwangCount: gwang.length, gwangPoints: gwangPts, yeolCount: yeol.length, ttiCount: tti.length, piCount, piPoints: piCount >= 10 ? piCount - 9 : 0, gukjinAsPi };
}

// The 9월 열끗 may count as a 열끗 or as a 쌍피; the holder always gets the better reading.
export function matgoScore(ids) {
  const asYeol = tally(ids, false);
  const hasGukjin = ids.some(x => card(x)?.gukjin);
  if (!hasGukjin) return asYeol;
  const asPi = tally(ids, true);
  return asPi.base > asYeol.base ? asPi : asYeol;
}

// Both readings of the winner's 국진, whichever pays more once 피박/멍따 are counted (2026-10-24
// review: picking by base points alone could cost the winner a 피박).
export function winnerReadings(ids) {
  const asYeol = tally(ids, false);
  return ids.some(x => card(x)?.gukjin) ? [asYeol, tally(ids, true)] : [asYeol];
}
function finalPoints(round, winner) {
  const readings = winnerReadings(round.captured[winner]);
  const top = Math.max(...readings.map(s => s.base));
  // Only readings that still reach the goal (or the best there is) can be the one that stopped.
  const all = readings.filter(s => s.base >= Math.min(top, MATGO_GOAL)).map(s => pointsFor(round, winner, s));
  return all.reduce((best, x) => (x.points > best.points ? x : best));
}
function pointsFor(round, winner, s) {
  const loser = other(winner);
  // The loser reads 국진 as 피 whenever that saves them from 피박.
  const loserPi = Math.max(tally(round.captured[loser], false).piCount, tally(round.captured[loser], true).piCount);
  const loserGwang = tally(round.captured[loser], false).gwangCount;
  const go = round.goCount[winner];
  let points = s.base + go;
  const multipliers = [];
  if (go >= 3) multipliers.push({ label: `${go}고`, times: 2 ** (go - 2) });
  for (let i = 0; i < round.shakes[winner]; i++) multipliers.push({ label: '흔들기', times: 2 });
  if (s.yeolCount >= 7) multipliers.push({ label: '멍따', times: 2 });
  if (s.piPoints > 0 && loserPi >= 1 && loserPi <= 7) multipliers.push({ label: '피박', times: 2 });
  if (s.gwangPoints > 0 && loserGwang === 0) multipliers.push({ label: '광박', times: 2 });
  if (round.goCount[loser] > 0) multipliers.push({ label: '고박', times: 2 });
  for (const m of multipliers) points *= m.times;
  return { base: s.base, go, lines: s.lines, multipliers, points: Math.min(points, MATGO_MAX_POINTS) };
}

defineGoStopRules('Matgo', { goal: MATGO_GOAL, aiRivalMax: 3, finalPoints });
export { tally as matgoTally };

// ---------- setup ----------
function dealOnce(rng) {
  const deck = shuffle(HWATU.map(c => c.id), rng);
  return { hands: [deck.slice(0, 10), deck.slice(10, 20)], floor: deck.slice(20, 28), pile: deck.slice(28) };
}
export const hasFourOfMonth = ids => Object.values(ids.reduce((m, x) => ((m[monthOf(x)] = (m[monthOf(x)] || 0) + 1), m), {})).some(n => n === 4);

// 선: the first hand is drawn at random; after that the winner of the last hand leads, and after a
// 나가리 the same seat leads again (2026-10-27, 한서 asked for the real table rule).
export const matgoNextLead = round => (round?.result ? (round.result.winner ?? round.first) : null);

export function startMatgo({ stake, seats, rng = defaultRng, first = null, double = 1 }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (!validDouble(double)) throw new Error('INVALID_DOUBLE');
  // A floor or hand holding all four of a month (총통) is simply redealt.
  let deal = dealOnce(rng);
  for (let i = 0; i < 50 && (hasFourOfMonth(deal.floor) || deal.hands.some(hasFourOfMonth)); i++) deal = dealOnce(rng);
  const lead = first === 0 || first === 1 ? first : rng(2);
  return {
    id: id('mg'), game: 'Matgo', engineVersion: MATGO_ENGINE, stake,
    seats: seats || [{ kind: 'human' }, { kind: 'ai', name: '하우스 AI' }],
    hands: deal.hands, floor: deal.floor, pile: deal.pile, captured: [[], []],
    opening: { hands: deal.hands.map(h => [...h]), floor: [...deal.floor] },
    first: lead, turn: lead, phase: 'PLAY', status: 'PLAYING',
    goCount: [0, 0], goScore: [0, 0], shakes: [0, 0], ppeok: {}, pending: null, result: null,
    double, turns: 0, createdAt: new Date().toISOString()
  };
}

export function matgoActor(round) {
  if (round.status !== 'PLAYING') return -1;
  if (round.phase === 'CHOOSE_FLIP' || round.phase === 'GO_STOP') return round.pending.seat;
  return round.turn;
}

// ---------- legal moves ----------
function monthCount(ids, month) { return ids.filter(x => !isDummy(x) && monthOf(x) === month).length; }
const sameValue = (a, b) => { const x = card(a), y = card(b); return x.kind === y.kind && Boolean(x.double) === Boolean(y.double) && x.ribbon === y.ribbon && Boolean(x.bird) === Boolean(y.bird); };

export function matgoLegal(round, seat) {
  if (matgoActor(round) !== seat || round.phase !== 'PLAY') return null;
  const hand = round.hands[seat];
  const months = [...new Set(hand.filter(x => !isDummy(x)).map(monthOf))];
  return {
    cards: hand.filter(x => !isDummy(x)),
    dummy: hand.some(isDummy),
    shake: months.filter(m => monthCount(hand, m) === 3 && monthCount(round.floor, m) === 0),
    bomb: months.filter(m => monthCount(hand, m) === 3 && monthCount(round.floor, m) === 1),
    // Hand cards whose month sits on the floor with two different cards: the player picks one.
    pick: hand.filter(x => !isDummy(x)).filter(x => { const f = round.floor.filter(y => monthOf(y) === monthOf(x)); return f.length === 2 && !sameValue(f[0], f[1]); })
  };
}

// ---------- turn resolution ----------
function take(list, ids) { for (const x of ids) { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); } }

// One 피 from every opponent, the plainest one each has.
function stealPi(round, seat, events) {
  for (const from of opponents(round, seat)) {
    const pile = round.captured[from];
    const single = pile.find(x => card(x).kind === 'pi' && !card(x).double);
    const pick = single || pile.find(x => card(x).kind === 'pi');
    if (!pick) continue;
    take(pile, [pick]);
    round.captured[seat].push(pick);
    events.push({ type: 'steal', seat, from, card: pick });
  }
}

export function matgoAct(round, seat, action, events = []) {
  if (round.status !== 'PLAYING') throw new Error('ROUND_NOT_ACTIONABLE');
  if (matgoActor(round) !== seat) throw new Error('NOT_YOUR_TURN');
  const type = action?.type;
  if (round.phase === 'GO_STOP') {
    if (type === 'GO') return go(round, seat, events);
    if (type === 'STOP') return endRound(round, seat, events, 'STOP');
    throw new Error('INVALID_ACTION');
  }
  if (round.phase === 'CHOOSE_FLIP') {
    if (type !== 'CHOOSE') throw new Error('INVALID_ACTION');
    const ctx = round.pending;
    if (!ctx.options.includes(action.target)) throw new Error('INVALID_TARGET');
    round.pending = null;
    round.phase = 'PLAY';
    return finishTurn(round, seat, ctx.context, [ctx.flip, action.target], ctx.steals, events);
  }
  if (!['PLAY', 'BOMB', 'FLIP_ONLY'].includes(type)) throw new Error('INVALID_ACTION');
  return playTurn(round, seat, action, events);
}

function playTurn(round, seat, action, events) {
  const hand = round.hands[seat];
  let context;
  let steals = 0;
  if (action.type === 'FLIP_ONLY') {
    const i = hand.findIndex(isDummy);
    if (i < 0) throw new Error('INVALID_ACTION');
    hand.splice(i, 1);
    events.push({ type: 'play', seat, cards: [], dummy: true });
    context = { month: 0, mode: 'none', take: [] };
  } else if (action.type === 'BOMB') {
    const month = Number(action.month);
    const mine = hand.filter(x => !isDummy(x) && monthOf(x) === month);
    const floorM = round.floor.filter(x => monthOf(x) === month);
    if (mine.length !== 3 || floorM.length !== 1) throw new Error('BOMB_NOT_ALLOWED');
    take(hand, mine);
    round.floor.push(...mine);
    hand.push(`${DUMMY}-${round.turns}-a`, `${DUMMY}-${round.turns}-b`);
    round.shakes[seat]++;
    steals++;
    events.push({ type: 'play', seat, cards: mine, bomb: true });
    events.push({ type: 'call', seat, text: '폭탄' });
    context = { month, mode: 'bomb', take: [...mine, ...floorM] };
  } else {
    const played = action.card;
    if (!hand.includes(played) || isDummy(played)) throw new Error('CARD_NOT_IN_HAND');
    const month = monthOf(played);
    const floorM = round.floor.filter(x => monthOf(x) === month);
    if (action.shake) {
      if (monthCount(hand, month) !== 3 || floorM.length !== 0) throw new Error('SHAKE_NOT_ALLOWED');
      round.shakes[seat]++;
      events.push({ type: 'call', seat, text: '흔들기', reveal: hand.filter(x => !isDummy(x) && monthOf(x) === month) });
    }
    take(hand, [played]);
    round.floor.push(played);
    events.push({ type: 'play', seat, cards: [played] });
    if (floorM.length === 0) context = { month, mode: 'alone', card: played, take: [] };
    else if (floorM.length === 1) context = { month, mode: 'pair', card: played, take: [played, floorM[0]] };
    else if (floorM.length === 2) {
      let target = action.target;
      if (!floorM.includes(target)) {
        if (!sameValue(floorM[0], floorM[1])) throw new Error('TARGET_REQUIRED');
        target = floorM[0];
      }
      context = { month, mode: 'pick', card: played, take: [played, target], other: floorM.find(x => x !== target) };
    } else {
      // Taking a 뻑 back costs the opponent a 피; three cards dealt to the floor do not.
      context = { month, mode: 'four', take: [played, ...floorM] };
      if (round.ppeok[month] !== undefined) { steals++; events.push({ type: 'call', seat, text: '뻑 먹기' }); }
    }
  }

  // Turn over the top of the pile.
  const flip = round.pile.shift();
  if (!flip) return finishTurn(round, seat, context, [], steals, events);
  round.floor.push(flip);
  events.push({ type: 'flip', seat, card: flip });
  const fm = monthOf(flip);
  if (fm === context.month && ['alone', 'pair', 'pick'].includes(context.mode)) {
    if (context.mode === 'alone') { context.take = [context.card, flip]; steals++; events.push({ type: 'call', seat, text: '쪽' }); }
    else if (context.mode === 'pair') { context.take = []; round.ppeok[fm] = seat; events.push({ type: 'call', seat, text: '뻑' }); }
    else { context.take = [...context.take, context.other, flip]; steals++; events.push({ type: 'call', seat, text: '따닥' }); }
    return finishTurn(round, seat, context, [], steals, events);
  }
  const floorF = round.floor.filter(x => x !== flip && monthOf(x) === fm && !context.take.includes(x));
  if (floorF.length === 0) return finishTurn(round, seat, context, [], steals, events);
  if (floorF.length === 1) return finishTurn(round, seat, context, [flip, floorF[0]], steals, events);
  if (floorF.length === 2) {
    if (sameValue(floorF[0], floorF[1])) return finishTurn(round, seat, context, [flip, floorF[0]], steals, events);
    round.phase = 'CHOOSE_FLIP';
    round.pending = { seat, context, flip, options: floorF, steals };
    events.push({ type: 'choose', seat, card: flip, options: floorF });
    return events;
  }
  const ateppeok = round.ppeok[fm] !== undefined;
  if (ateppeok) events.push({ type: 'call', seat, text: '뻑 먹기' });
  return finishTurn(round, seat, context, [flip, ...floorF], steals + (ateppeok ? 1 : 0), events);
}

function finishTurn(round, seat, context, flipTake, steals, events) {
  const captured = [...context.take, ...flipTake];
  if (captured.length) {
    take(round.floor, captured);
    round.captured[seat].push(...captured);
    events.push({ type: 'capture', seat, cards: captured });
    for (const m of new Set(captured.map(monthOf))) delete round.ppeok[m];
  }
  if (captured.length && round.floor.length === 0 && round.pile.length > 0) { steals++; events.push({ type: 'call', seat, text: '쓸' }); }
  for (let i = 0; i < steals; i++) stealPi(round, seat, events);
  round.turns++;

  const score = matgoScore(round.captured[seat]);
  events.push({ type: 'score', seat, score: score.base });
  const handLeft = round.hands[seat].length;
  if (score.base >= rulesOf(round).goal && score.base > round.goScore[seat]) {
    // With no cards left there is nothing to 고 for.
    if (handLeft === 0) return endRound(round, seat, events, 'STOP');
    round.phase = 'GO_STOP';
    round.pending = { seat, score: score.base };
    events.push({ type: 'go-stop', seat, score: score.base });
    return events;
  }
  return nextTurn(round, seat, events);
}

function nextTurn(round, seat, events) {
  round.phase = 'PLAY';
  round.pending = null;
  if (round.hands.every(h => h.length === 0)) return endRound(round, null, events, 'NAGARI');
  const n = round.hands.length;
  let next = (seat + 1) % n;
  while (!round.hands[next].length) next = (next + 1) % n;
  round.turn = next;
  events.push({ type: 'turn', seat: next });
  return events;
}

function go(round, seat, events) {
  round.goCount[seat]++;
  round.goScore[seat] = round.pending.score;
  (round.goAt ||= {})[seat] = round.turns; // who called 고 last decides 3인 고박
  events.push({ type: 'call', seat, text: `${round.goCount[seat]}고` });
  return nextTurn(round, seat, events);
}

function endRound(round, winner, events, reason) {
  round.phase = 'ENDED';
  round.pending = null;
  round.status = 'READY_TO_SETTLE';
  const double = round.double || 1;
  if (winner === null) {
    round.result = { winner: null, reason, points: 0, double, nextDouble: nextDouble(round) };
  } else {
    if (reason === 'STOP') events.push({ type: 'call', seat: winner, text: '스톱' });
    const r = rulesOf(round).finalPoints(round, winner);
    // A hand played on 묻고 더블 pays every share that many times over.
    if (double > 1) {
      r.multipliers = [...r.multipliers, { label: '묻고 더블', times: double }];
      if (r.shares) r.shares = r.shares.map(x => ({ ...x, points: x.points * double, multipliers: [...x.multipliers, { label: '묻고 더블', times: double }] }));
      r.points = r.shares ? r.shares.reduce((n, x) => n + x.points, 0) : r.points * double;
    }
    round.result = { winner, reason, double, ...r };
  }
  events.push({ type: 'end', result: round.result });
  return events;
}

// ---------- AI ----------
function worth(cardId) {
  const c = card(cardId);
  if (c.kind === 'gwang') return c.rain ? 12 : 20;
  if (c.kind === 'yeol') return c.bird ? 12 : c.gukjin ? 9 : 7;
  if (c.kind === 'tti') return c.ribbon ? 8 : 5;
  return c.double ? 7 : 4;
}

// Decides for `seat` from that seat's own view: its hand, the floor and both capture piles.
export function matgoAiDecision(round, seat, rng = defaultRng) {
  const jitter = () => rng(100) / 100;
  // Low floors play loose: a wide jitter means the AI often takes a worse card than its best.
  const sloppy = 1 - aiSkillFor(round);
  if (round.phase === 'GO_STOP') {
    const mine = round.hands[seat].length;
    const rival = Math.max(...opponents(round, seat).map(s => matgoScore(round.captured[s]).base));
    const goOn = mine >= 3 && rival <= rulesOf(round).aiRivalMax && round.goCount[seat] < 2 && jitter() < 0.7;
    return { type: goOn ? 'GO' : 'STOP' };
  }
  if (round.phase === 'CHOOSE_FLIP') {
    const opts = [...round.pending.options].sort((a, b) => worth(b) - worth(a));
    return { type: 'CHOOSE', target: opts[0] };
  }
  const legal = matgoLegal(round, seat);
  const seen = new Set([...round.floor, ...round.captured.flat(), ...round.hands[seat]]);
  const options = [];
  for (const m of legal.bomb) {
    const ids = [...round.hands[seat].filter(x => !isDummy(x) && monthOf(x) === m), ...round.floor.filter(x => monthOf(x) === m)];
    options.push({ action: { type: 'BOMB', month: m }, value: ids.reduce((s, x) => s + worth(x), 0) + 15 });
  }
  for (const x of legal.cards) {
    const m = monthOf(x);
    const floorM = round.floor.filter(y => monthOf(y) === m);
    if (floorM.length === 0) {
      // Throwing away: prefer cheap cards whose remaining partners are already out of play.
      const unseen = HWATU.filter(c => c.month === m && !seen.has(c.id)).length;
      const shake = legal.shake.includes(m);
      options.push({ action: { type: 'PLAY', card: x, shake }, value: -worth(x) * (unseen ? 0.6 : 0.2) + (shake ? 3 : 0) });
    } else if (floorM.length === 1) options.push({ action: { type: 'PLAY', card: x }, value: worth(x) + worth(floorM[0]) });
    else if (floorM.length === 2) {
      const best = [...floorM].sort((a, b) => worth(b) - worth(a))[0];
      options.push({ action: { type: 'PLAY', card: x, target: best }, value: worth(x) + worth(best) });
    } else options.push({ action: { type: 'PLAY', card: x }, value: worth(x) + floorM.reduce((s, y) => s + worth(y), 0) + 10 });
  }
  if (legal.dummy) options.push({ action: { type: 'FLIP_ONLY' }, value: 1 });
  options.forEach(o => { o.value += jitter() * (2 + 14 * sloppy); });
  options.sort((a, b) => b.value - a.value);
  return options[0].action;
}

export function runMatgoAi(round, events = [], rng = defaultRng) {
  for (let guard = 0; guard < 120; guard++) {
    const seat = matgoActor(round);
    if (seat < 0 || round.seats[seat].kind !== 'ai') break;
    matgoAct(round, seat, matgoAiDecision(round, seat, rng), events);
  }
  return events;
}

// ---------- views ----------
export function matgoPublic(round, seat = 0) {
  const opp = other(seat);
  const actor = matgoActor(round);
  const scores = [0, 1].map(s => { const t = matgoScore(round.captured[s]); return { base: t.base, lines: t.lines, piCount: t.piCount, gukjinAsPi: Boolean(t.gukjinAsPi), go: round.goCount[s], shakes: round.shakes[s] }; });
  return {
    id: round.id, game: round.game, engineVersion: round.engineVersion, stake: round.stake,
    status: round.status, phase: round.phase, you: seat, turn: round.turn, actor, first: round.first,
    seats: round.seats.map(s => ({ kind: s.kind, name: s.name || null })),
    hand: [...round.hands[seat]], opponentHand: round.hands[opp].length,
    opening: round.opening ? { hand: [...round.opening.hands[seat]], floor: [...round.opening.floor] } : null,
    floor: [...round.floor], pileCount: round.pile.length,
    captured: [round.captured[0].slice(), round.captured[1].slice()],
    scores, ppeok: Object.keys(round.ppeok).map(Number),
    pending: actor === seat && round.phase === 'CHOOSE_FLIP' ? { card: round.pending.flip, options: [...round.pending.options] } : actor === seat && round.phase === 'GO_STOP' ? { score: round.pending.score } : null,
    legal: matgoLegal(round, seat),
    double: round.double || 1,
    result: round.result ? { ...round.result } : null,
    netPnl: round.status === 'SETTLED' ? round.netPnl : null
  };
}

// Points to CH for the human in `seat`; losses are capped by what the player can cover.
export function matgoNet(round, seat = 0) {
  const r = round.result;
  if (!r || r.winner === null) return 0;
  const amount = r.points * round.stake;
  return r.winner === seat ? amount : -amount;
}
