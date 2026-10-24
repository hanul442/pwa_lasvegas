// 고스톱 for three: the human and two AI seats. The turn engine, 피 stealing, scoring and AI
// heuristics are 맞고's (lib/matgo.mjs); this file deals 7/7/7 with 6 on the floor, sets the
// goal to 3 points and pays each loser's share separately, with 고박 (독박) for a failed 고.
import { HWATU, shuffle, defaultRng } from './hwatu.mjs';
import { id } from './state.mjs';
import { validDouble, defineGoStopRules, hasFourOfMonth, matgoScore, winnerReadings, matgoTally, matgoAct, matgoActor, matgoLegal, matgoAiDecision, runMatgoAi } from './matgo.mjs';

export const GOSTOP_ENGINE = 'GOSTOP_V1';
export const GOSTOP_GOAL = 3;
export const GOSTOP_SEATS = 3;
export const GOSTOP_DEPOSIT_POINTS = 10; // points reserved up front, as in 맞고
export const GOSTOP_MAX_POINTS = 100;     // per loser's share
export const GOSTOP_AI_NAMES = ['은하', '태오'];
const PIBAK_MAX = 5; // 3인 피박: the loser holds 1–5 피

// ---------- settlement ----------
// Every loser owes (base + 고) × the winner's multipliers × their own 피박/광박. If a loser had
// called 고 and someone else stopped, the last such caller pays every share alone (고박).
function finalPoints(round, winner) {
  // The winner's 국진 reads whichever way pays more in total (multipliers included).
  const readings = winnerReadings(round.captured[winner]);
  const top = Math.max(...readings.map(s => s.base));
  // Only readings that still reach the goal (or the best there is) can be the one that stopped.
  const all = readings.filter(s => s.base >= Math.min(top, GOSTOP_GOAL)).map(s => pointsFor(round, winner, s));
  return all.reduce((best, x) => (x.points > best.points ? x : best));
}
function pointsFor(round, winner, s) {
  const go = round.goCount[winner];
  const multipliers = [];
  if (go >= 3) multipliers.push({ label: `${go}고`, times: 2 ** (go - 2) });
  for (let i = 0; i < round.shakes[winner]; i++) multipliers.push({ label: '흔들기', times: 2 });
  if (s.yeolCount >= 7) multipliers.push({ label: '멍따', times: 2 });
  const losers = round.hands.map((_, seat) => seat).filter(seat => seat !== winner);
  const goers = losers.filter(l => round.goCount[l] > 0).sort((a, b) => (round.goAt?.[b] ?? 0) - (round.goAt?.[a] ?? 0));
  const gobak = goers.length ? goers[0] : null;
  const shares = losers.map(seat => {
    const pile = round.captured[seat];
    // The loser reads 국진 as 피 whenever that saves them from 피박.
    const pi = Math.max(matgoTally(pile, false).piCount, matgoTally(pile, true).piCount);
    const own = [...multipliers];
    if (s.piPoints > 0 && pi >= 1 && pi <= PIBAK_MAX) own.push({ label: '피박', times: 2 });
    if (s.gwangPoints > 0 && matgoTally(pile, false).gwangCount === 0) own.push({ label: '광박', times: 2 });
    const points = Math.min(own.reduce((p, m) => p * m.times, s.base + go), GOSTOP_MAX_POINTS);
    return { seat, payer: gobak ?? seat, points, multipliers: own };
  });
  return { base: s.base, go, lines: s.lines, multipliers, shares, gobak, points: shares.reduce((n, x) => n + x.points, 0) };
}
defineGoStopRules('Gostop', { goal: GOSTOP_GOAL, aiRivalMax: 1, finalPoints });

// ---------- setup ----------
function dealOnce(rng) {
  const deck = shuffle(HWATU.map(c => c.id), rng);
  return { hands: [deck.slice(0, 7), deck.slice(7, 14), deck.slice(14, 21)], floor: deck.slice(21, 27), pile: deck.slice(27) };
}

export function startGostop({ stake, seats, rng = defaultRng, first = null, double = 1 }) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (!validDouble(double)) throw new Error('INVALID_DOUBLE');
  // A floor or hand holding all four of a month (총통) is simply redealt.
  let deal = dealOnce(rng);
  for (let i = 0; i < 50 && (hasFourOfMonth(deal.floor) || deal.hands.some(hasFourOfMonth)); i++) deal = dealOnce(rng);
  const lead = first ?? rng(GOSTOP_SEATS);
  return {
    id: id('gs'), game: 'Gostop', engineVersion: GOSTOP_ENGINE, stake,
    seats: seats || [{ kind: 'human' }, ...GOSTOP_AI_NAMES.map(name => ({ kind: 'ai', name }))],
    hands: deal.hands, floor: deal.floor, pile: deal.pile, captured: [[], [], []],
    opening: { hands: deal.hands.map(h => [...h]), floor: [...deal.floor] },
    first: lead, turn: lead, phase: 'PLAY', status: 'PLAYING',
    goCount: [0, 0, 0], goScore: [0, 0, 0], shakes: [0, 0, 0], goAt: {}, ppeok: {}, pending: null, result: null,
    double, turns: 0, createdAt: new Date().toISOString()
  };
}

// The 맞고 engine already plays any number of seats under the rules registered above.
export const gostopActor = matgoActor;
export const gostopLegal = matgoLegal;
export const gostopAct = matgoAct;
export const gostopAiDecision = matgoAiDecision;
export const runGostopAi = runMatgoAi;

// ---------- views ----------
export function gostopPublic(round, seat = 0) {
  const actor = matgoActor(round);
  const scores = round.captured.map((pile, s) => { const t = matgoScore(pile); return { base: t.base, lines: t.lines, piCount: t.piCount, gukjinAsPi: Boolean(t.gukjinAsPi), go: round.goCount[s], shakes: round.shakes[s] }; });
  return {
    id: round.id, game: round.game, engineVersion: round.engineVersion, stake: round.stake, goal: GOSTOP_GOAL,
    status: round.status, phase: round.phase, you: seat, turn: round.turn, actor, first: round.first,
    seats: round.seats.map((s, i) => ({ kind: s.kind, name: s.name || null, hand: round.hands[i].length })),
    hand: [...round.hands[seat]],
    opening: round.opening ? { hand: [...round.opening.hands[seat]], floor: [...round.opening.floor] } : null,
    floor: [...round.floor], pileCount: round.pile.length,
    captured: round.captured.map(c => c.slice()),
    scores, ppeok: Object.keys(round.ppeok).map(Number),
    pending: actor === seat && round.phase === 'CHOOSE_FLIP' ? { card: round.pending.flip, options: [...round.pending.options] } : actor === seat && round.phase === 'GO_STOP' ? { score: round.pending.score } : null,
    legal: matgoLegal(round, seat),
    double: round.double || 1, event: round.event || null, bonus: round.bonus ?? null,
    result: round.result ? structuredClone(round.result) : null,
    netPnl: round.status === 'SETTLED' ? round.netPnl : null
  };
}

// Points to CH for `seat`: the winner collects every share, a loser pays the shares it owes.
export function gostopNet(round, seat = 0) {
  const r = round.result;
  if (!r || r.winner === null) return 0;
  if (r.winner === seat) return r.points * round.stake;
  const owed = r.shares.filter(x => x.payer === seat).reduce((n, x) => n + x.points, 0);
  return owed ? -owed * round.stake : 0;
}
