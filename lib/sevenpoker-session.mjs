// A solo 7포커 session: one person bought in at a table of two to four AI bots, run the way the
// solo Hold'em table is (lib/holdem-session.mjs): the buy-in is locked in the ledger while they
// sit, standing up settles stack minus buy-in, and busted bots are replaced by fresh ones.
import { id } from './state.mjs';
import { MONEY_UNIT, levelForFloor } from './constants.mjs';
import { createTable, startHand, applyAction, publicTable, waitingToChoose } from './sevenpoker.mjs';
import { decide } from './sevenpoker-bot.mjs';
import { HOLDEM_BLINDS, newBot } from './holdem-session.mjs';

export const SEVEN_ENGINE = 'SEVENPOKER_V1';
export const SEVEN_GAME = 'Seven Poker';
export const HERO = 0;
export const SEVEN_OPPONENTS = [2, 3, 4];
// The ante per table tier is the Hold'em small blind (never under 100만), and a buy-in must cover
// at least ten antes, the same depth the Hold'em table asks for.
export const SEVEN_ANTES = Object.fromEntries(Object.entries(HOLDEM_BLINDS).map(([slug, b]) => [slug, b.small]));
export const MIN_ANTES = 10;

export function createSevenSession({ userId, nickname, buyIn, tier, opponents = 3, floor }, rand = Math.random) {
  const ante = SEVEN_ANTES[tier];
  if (!ante) throw new Error('INVALID_TIER');
  const count = Number(opponents);
  if (!SEVEN_OPPONENTS.includes(count)) throw new Error('INVALID_OPPONENTS');
  if (!Number.isSafeInteger(buyIn) || buyIn < ante * MIN_ANTES) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const level = levelForFloor(floor, buyIn);
  const seats = [{ id: userId, name: nickname, kind: 'human', stack: buyIn }];
  for (let k = 0; k < count; k++) seats.push(newBot({ seats, buyIn, big: ante * 2, level }, rand));
  return {
    id: id('7pk'), game: SEVEN_GAME, engineVersion: SEVEN_ENGINE, userId, floor, tier, stake: buyIn, buyIn,
    status: 'SEATED', createdAt: new Date().toISOString(), lastCommand: null,
    table: createTable({ seats, ante, unit: MONEY_UNIT, level })
  };
}

// Let bots move until the person has something to do or the hand is over: bots turn their card
// up as soon as the cards are dealt, and bet whenever the turn is theirs.
function runBots(session, rand) {
  const t = session.table;
  let guard = 0;
  while (t.hand && !t.hand.over) {
    if (++guard > 300) throw new Error('BOT_LOOP');
    const h = t.hand;
    if (h.phase === 'CHOOSE') {
      const bot = t.seats.findIndex((s, i) => s.kind === 'bot' && waitingToChoose(t, i));
      if (bot < 0) return; // only the person is left to choose
      applyAction(t, bot, decide(t, bot, rand));
      continue;
    }
    if (t.seats[h.toAct]?.kind !== 'bot') return;
    applyAction(t, h.toAct, decide(t, h.toAct, rand));
  }
}

const eventsSince = (session, from) => (session.table.hand ? session.table.hand.events.slice(from) : []);

export function dealNextHand(session, rand = Math.random) {
  if (session.status !== 'SEATED') throw new Error('SESSION_CLOSED');
  const t = session.table;
  if (t.hand && !t.hand.over) throw new Error('HAND_IN_PROGRESS');
  if (t.seats[HERO].stack <= 0) throw new Error('NO_CHIPS');
  const events = [];
  t.seats.forEach((s, i) => {
    if (s.kind === 'bot' && s.stack <= 0) {
      const bot = newBot({ seats: t.seats, buyIn: session.buyIn, big: t.ante * 2, level: t.level ?? undefined }, rand);
      t.seats[i] = bot;
      events.push({ t: 'seat', seat: i, name: bot.name, style: bot.style, stack: bot.stack });
    }
  });
  startHand(t);
  runBots(session, rand);
  return [...events, ...eventsSince(session, 0)];
}

// The person's move: { type: 'OPEN', index } while choosing the open card, else a bet.
export function heroAction(session, action, rand = Math.random) {
  if (session.status !== 'SEATED') throw new Error('SESSION_CLOSED');
  const t = session.table;
  if (!t.hand || t.hand.over) throw new Error('HAND_NOT_ACTIVE');
  const from = t.hand.events.length;
  applyAction(t, HERO, action);
  runBots(session, rand);
  return eventsSince(session, from);
}

// Standing up mid-hand gives the hand up; chips already in the pot stay there.
export function standUp(session) {
  const t = session.table;
  const events = [];
  if (t.hand && !t.hand.over) {
    const from = t.hand.events.length;
    if (t.hand.players[HERO] && !t.hand.players[HERO].folded) {
      t.hand.players[HERO].folded = true;
      t.hand.events.push({ t: 'act', seat: HERO, action: 'FOLD' });
    }
    if (t.hand.toAct === HERO) t.hand.toAct = -1;
    events.push(...eventsSince(session, from));
  }
  session.status = 'SETTLED';
  session.cashOut = t.seats[HERO].stack;
  session.netPnl = session.cashOut - session.buyIn;
  session.settledAt = new Date().toISOString();
  return events;
}

export function sevenPublic(session) {
  return {
    id: session.id, game: session.game, status: session.status, tier: session.tier, floor: session.floor,
    buyIn: session.buyIn, hero: HERO, cashOut: session.cashOut ?? null, netPnl: session.netPnl ?? null,
    table: publicTable(session.table, HERO)
  };
}

// Only open sessions are looked for, and the newest first: a settled one is never read again.
export function activeSevenSession(state, userId) {
  for (let k = state.rounds.length - 1; k >= 0; k--) {
    const r = state.rounds[k];
    if (r && r.userId === userId && r.engineVersion === SEVEN_ENGINE && r.status !== 'SETTLED') return r;
  }
  return null;
}

export function compactSettled(session) {
  if (session.status === 'SETTLED') {
    const t = session.table;
    session.table = { ...t, hand: null, seats: t.seats.map(s => ({ ...s })) };
  }
  return session;
}
