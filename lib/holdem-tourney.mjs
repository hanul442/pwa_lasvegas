// 친구 홀덤 토너먼트 (sit & go) for friends' Hold'em rooms (lib/holdem-room.mjs). Everyone pays the
// same buy-in from real chips, which stays locked in the ledger until the tournament is decided,
// and sits with the same stack of tournament chips: 100 big blinds of the table's opening level.
// Blinds climb on a clock (applied at the next deal, since the Worker has no timers), nobody new
// sits once the cards are in the air, there are no rebuys, and getting up with chips is a forfeit.
// The prize pool is the people's buy-ins only: AI seats are sparring partners that pay nothing and
// win nothing, and places are counted among people. The pool pays 1st 70% / 2nd 30% with four or
// more people, winner-take-all with two or three, in 100만 units with the remainder to 1st, so
// what is paid out can never exceed what was locked.
// This module is plain data in, plain data out, so it runs on the Node server and the Durable Object alike.
import { MONEY_UNIT } from './constants.mjs';
import { settleLockedHouseGame } from './economy.mjs';
import { HOLDEM_ENGINE } from './holdem-session.mjs';

export const TOURNEY = {
  depth: 100,                 // starting stack in big blinds of level 1
  levelMs: 3 * 60_000,        // the blinds go up every three minutes
  ladder: [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128],
  minSeats: 2,
  minPeople: 2,               // a tournament needs at least two people paying in; AI only fill chairs
  splitFrom: 4,               // four or more people: 1st 70% / 2nd 30%; fewer: winner takes all
  second: 0.3,
  doneTtlMs: 30 * 60_000      // a finished tournament's results stay readable this long
};
const GAME = "Hold'em";
const BLIND_PAIR = 2 * MONEY_UNIT;
const evenBlind = x => Math.max(BLIND_PAIR, Math.round(x / BLIND_PAIR) * BLIND_PAIR);

export function tourneyBlinds(base, level) {
  const big = evenBlind(base * TOURNEY.ladder[Math.min(Math.max(level, 0), TOURNEY.ladder.length - 1)]);
  return { small: big / 2, big };
}

// The prize split, by how many people paid in. Shares are whole 100만s; 1st takes the remainder.
export function tourneyPayouts(prize, people) {
  if (people < TOURNEY.splitFrom) return [prize];
  const second = Math.floor((prize * TOURNEY.second) / MONEY_UNIT) * MONEY_UNIT;
  return [prize - second, second];
}

export function newTourney({ base, fillBots }) {
  return {
    base, stack: base * TOURNEY.depth, fillBots: Boolean(fillBots), level: 0,
    startedAt: null, endedAt: null, done: false, prize: 0, payouts: [],
    entries: {},   // userId -> { nickname, ticket, buyIn, seat, out, forfeit, place, payout, settled }
    out: [],       // every seat that busted, in order: { seat, name, kind, id, hand, start }
    handStart: []  // stacks when the current hand was dealt, to rank players busted in the same hand
  };
}

export function enterTourney(tn, p) {
  tn.entries[p.userId] = { userId: p.userId, nickname: p.nickname, ticket: p.ticket, buyIn: p.buyIn, seat: p.seat, out: null, forfeit: false, place: null, payout: 0, settled: false };
}

const entryList = tn => Object.values(tn.entries);
const eligible = tn => entryList(tn).filter(e => !e.forfeit);
const aliveEligible = tn => eligible(tn).filter(e => !e.out);
export const tourneyDecided = tn => Boolean(tn.startedAt) && !tn.done && aliveEligible(tn).length <= 1;

// People who didn't forfeit, best first: still holding chips (bigger stack first), then by how
// late they busted; in the same hand the one who started it deeper places higher.
export function rankEntries(tn, table) {
  const stackOf = e => table.seats[e.seat]?.stack ?? 0;
  return eligible(tn).sort((a, b) => {
    if (!a.out !== !b.out) return a.out ? 1 : -1;
    if (!a.out) return stackOf(b) - stackOf(a) || a.seat - b.seat;
    return b.out.hand - a.out.hand || b.out.start - a.out.start || a.seat - b.seat;
  });
}

const tied = (a, b) => Boolean(a.out && b.out && a.out.hand === b.out.hand && a.out.start === b.out.start);

// The tournament starts: what the people paid in is the pool.
export function beginTourney(tn, table, now) {
  tn.startedAt = now;
  tn.prize = entryList(tn).reduce((a, e) => a + e.buyIn, 0);
  tn.payouts = tourneyPayouts(tn.prize, entryList(tn).length);
  const b = tourneyBlinds(tn.base, 0);
  table.smallBlind = b.small; table.bigBlind = b.big;
}

export const levelDue = (tn, now) => Math.min(Math.floor(Math.max(0, now - tn.startedAt) / TOURNEY.levelMs), TOURNEY.ladder.length - 1);

// Before each deal: the clock's level takes effect, and the stacks are noted for this hand.
export function beforeDeal(tn, table, now) {
  const level = levelDue(tn, now);
  if (level > tn.level) {
    const b = tourneyBlinds(tn.base, level);
    tn.level = level;
    table.smallBlind = b.small; table.bigBlind = b.big;
  }
  tn.handStart = table.seats.map(s => s.stack);
}

// After a hand: everyone out of chips is eliminated, people and AI alike.
export function recordBusts(tn, table) {
  const handNo = table.hand?.no ?? table.handNo;
  table.seats.forEach((s, i) => {
    if (s.kind === 'empty' || s.stack > 0 || tn.out.some(o => o.seat === i)) return;
    const start = tn.handStart[i] ?? 0;
    tn.out.push({ seat: i, name: s.name, kind: s.kind, id: s.id, hand: handNo, start });
    const e = s.kind === 'human' ? tn.entries[s.id] : null;
    if (e && !e.out && !e.forfeit) e.out = { hand: handNo, start };
  });
}

function settle(state, e, roomCode, details = {}) {
  if (e.settled) return;
  const user = state.users[e.userId];
  e.settled = true;
  if (!user) return;
  settleLockedHouseGame(state, user, {
    game: GAME, stake: e.buyIn, netPnl: e.payout - e.buyIn, roundId: e.ticket,
    details: { engineVersion: HOLDEM_ENGINE, room: roomCode, tourney: true, place: e.place, payout: e.payout, ...details }
  });
}

// Getting up with chips mid-tournament: the buy-in is gone for good, the chips stay on the felt
// and blind away.
export function forfeitEntry(state, tn, userId, roomCode) {
  const e = tn.entries[userId];
  if (!e || e.forfeit || e.out || e.settled) return null;
  e.forfeit = true;
  e.payout = 0;
  settle(state, e, roomCode, { forfeit: true });
  return e;
}

// Places and prizes, settled through the ledger: each person's locked buy-in is released with
// their share. Shares nobody is left to claim (everyone else forfeited) go to 1st.
export function finishTourney(state, tn, table, roomCode, now) {
  if (tn.done) return;
  const ranked = rankEntries(tn, table);
  const pay = [...tn.payouts];
  if (ranked.length && ranked.length < pay.length) pay[0] += pay.splice(ranked.length).reduce((a, x) => a + x, 0);
  // People busted in the same hand from the same stack tie: they share the place and its prizes.
  for (let k = 0; k < ranked.length;) {
    const group = ranked.slice(k).filter((e, j) => j === 0 || tied(ranked[k], e));
    const pot = group.reduce((a, _, j) => a + (pay[k + j] ?? 0), 0);
    const each = Math.floor(pot / group.length / MONEY_UNIT) * MONEY_UNIT;
    group.forEach((e, j) => { e.place = k + 1; e.payout = each + (j === 0 ? pot - each * group.length : 0); });
    k += group.length;
  }
  for (const e of ranked) settle(state, e, roomCode, { hands: table.handNo });
  tn.done = true;
  tn.endedAt = now;
}

// The tournament as the room view shows it.
export function tourneyPublic(tn, table, userId, now) {
  const ranked = tn.startedAt ? rankEntries(tn, table) : [];
  const placeOf = e => e.place ?? (ranked.findIndex(x => x === e || tied(x, e)) + 1);
  const level = tn.level;
  const blinds = tn.startedAt ? { small: table.smallBlind, big: table.bigBlind } : tourneyBlinds(tn.base, 0);
  const nextLevel = level + 1 < TOURNEY.ladder.length ? level + 1 : null;
  const me = tn.entries[userId];
  const row = e => ({
    userId: e.userId, nickname: e.nickname, out: Boolean(e.out), forfeit: e.forfeit,
    place: e.forfeit ? null : tn.startedAt ? placeOf(e) : null, payout: tn.done ? e.payout : null, me: e.userId === userId
  });
  return {
    level: level + 1, small: blinds.small, big: blinds.big, stack: tn.stack, levelMs: TOURNEY.levelMs,
    next: nextLevel === null ? null : tourneyBlinds(tn.base, nextLevel),
    levelEndsAt: tn.startedAt && nextLevel !== null ? tn.startedAt + nextLevel * TOURNEY.levelMs : null,
    startedAt: tn.startedAt, done: tn.done, fillBots: tn.fillBots,
    prize: tn.startedAt ? tn.prize : entryList(tn).reduce((a, e) => a + e.buyIn, 0),
    payouts: tn.startedAt ? tn.payouts : tourneyPayouts(entryList(tn).reduce((a, e) => a + e.buyIn, 0), entryList(tn).length),
    people: entryList(tn).length,
    left: table.seats.filter(s => s.kind !== 'empty' && s.stack > 0).length,
    entrants: tn.startedAt ? table.seats.filter(s => s.kind !== 'empty').length : null,
    out: tn.out.map(o => ({ seat: o.seat, name: o.name, kind: o.kind, hand: o.hand })),
    standings: [...ranked, ...entryList(tn).filter(e => !ranked.includes(e))].map(row),
    me: me ? row(me) : null
  };
}
