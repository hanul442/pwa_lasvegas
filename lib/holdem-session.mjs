// A solo Hold'em session: one person bought in at a table of AI bots. The person's buy-in is
// locked in the ledger while they sit; standing up settles stack minus buy-in. Bots are
// bankrolled by the house and replaced when they bust. A friends' table can reuse the same
// engine with several human seats; only this driver is single-player.
import { id } from './state.mjs';
import { createTable, startHand, applyAction, publicTable } from './holdem.mjs';
import { decide, BOT_STYLES, BOT_NAMES } from './holdem-bot.mjs';

export const HOLDEM_ENGINE = 'HOLDEM_V1';
export const HERO = 0;

// Blinds per table tier; the buy-in itself must fit the tier's stake range.
export const HOLDEM_BLINDS = {
  low: { small: 2_500, big: 5_000 },
  mid: { small: 25_000, big: 50_000 },
  high: { small: 250_000, big: 500_000 },
  vip: { small: 1_250_000, big: 2_500_000 }
};

function pick(list, taken, rand) {
  const free = list.filter(x => !taken.includes(x));
  return free[Math.floor(rand() * free.length)] || list[Math.floor(rand() * list.length)];
}

function newBot({ seats, buyIn, big }, rand) {
  const styles = Object.keys(BOT_STYLES);
  // Bots sit with roughly what the person brought, so pots stay meaningful.
  const stack = Math.max(big * 20, Math.round((buyIn * (0.7 + rand() * 0.8)) / big) * big);
  return { id: id('bot'), name: pick(BOT_NAMES, seats.map(s => s.name), rand), kind: 'bot', style: styles[Math.floor(rand() * styles.length)], stack };
}

export function createHoldemSession({ userId, nickname, buyIn, tier, opponents = 5, floor }, rand = Math.random) {
  const blinds = HOLDEM_BLINDS[tier];
  if (!blinds) throw new Error('INVALID_TIER');
  const count = Number(opponents);
  if (![1, 2, 3, 4, 5].includes(count)) throw new Error('INVALID_OPPONENTS');
  if (!Number.isSafeInteger(buyIn) || buyIn < blinds.big * 10) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const seats = [{ id: userId, name: nickname, kind: 'human', stack: buyIn }];
  for (let k = 0; k < count; k++) seats.push(newBot({ seats, buyIn, big: blinds.big }, rand));
  return {
    id: id('hold'), game: "Hold'em", engineVersion: HOLDEM_ENGINE, userId, floor, tier, stake: buyIn, buyIn,
    status: 'SEATED', createdAt: new Date().toISOString(), lastCommand: null,
    table: createTable({ seats, smallBlind: blinds.small, bigBlind: blinds.big, button: Math.floor(rand() * seats.length) })
  };
}

// Let bots act until it is the person's turn or the hand is over. Returns the new events.
function runBots(session, rand) {
  const t = session.table;
  let guard = 0;
  while (t.hand && !t.hand.over && t.seats[t.hand.toAct].kind === 'bot') {
    if (++guard > 200) throw new Error('BOT_LOOP');
    applyAction(t, t.hand.toAct, decide(t, t.hand.toAct, rand));
  }
}

function eventsSince(session, from) { return session.table.hand ? session.table.hand.events.slice(from) : []; }

export function dealNextHand(session, rand = Math.random) {
  if (session.status !== 'SEATED') throw new Error('SESSION_CLOSED');
  const t = session.table;
  if (t.hand && !t.hand.over) throw new Error('HAND_IN_PROGRESS');
  if (t.seats[HERO].stack <= 0) throw new Error('NO_CHIPS');
  const events = [];
  // Busted bots get up; a fresh one takes the seat.
  t.seats.forEach((s, i) => {
    if (s.kind === 'bot' && s.stack <= 0) {
      const bot = newBot({ seats: t.seats, buyIn: session.buyIn, big: t.bigBlind }, rand);
      t.seats[i] = bot;
      events.push({ t: 'seat', seat: i, name: bot.name, style: bot.style, stack: bot.stack });
    }
  });
  startHand(t);
  runBots(session, rand);
  return [...events, ...eventsSince(session, 0)];
}

export function heroAction(session, action, rand = Math.random) {
  if (session.status !== 'SEATED') throw new Error('SESSION_CLOSED');
  const t = session.table;
  if (!t.hand || t.hand.over) throw new Error('HAND_NOT_ACTIVE');
  const from = t.hand.events.length;
  applyAction(t, HERO, action);
  runBots(session, rand);
  return eventsSince(session, from);
}

// Standing up mid-hand folds the hand first; chips already in the pot stay there.
export function standUp(session) {
  const t = session.table;
  const events = [];
  if (t.hand && !t.hand.over) {
    const from = t.hand.events.length;
    if (t.hand.players[HERO] && !t.hand.players[HERO].folded) {
      t.hand.players[HERO].folded = true;
      t.hand.events.push({ t: 'act', seat: HERO, action: 'FOLD' });
    }
    // Finish the hand among the bots so their stacks stay honest.
    if (t.hand.toAct === HERO) t.hand.toAct = -1;
    events.push(...eventsSince(session, from));
  }
  session.status = 'SETTLED';
  session.cashOut = t.seats[HERO].stack;
  session.netPnl = session.cashOut - session.buyIn;
  session.settledAt = new Date().toISOString();
  return events;
}

export function holdemPublic(session) {
  return {
    id: session.id, game: session.game, status: session.status, tier: session.tier, floor: session.floor,
    buyIn: session.buyIn, hero: HERO, cashOut: session.cashOut ?? null, netPnl: session.netPnl ?? null,
    table: publicTable(session.table, HERO)
  };
}

export function activeHoldemSession(state, userId) {
  return state.rounds.find(r => r && r.userId === userId && r.engineVersion === HOLDEM_ENGINE && r.status !== 'SETTLED') || null;
}

// Settled sessions don't need the table any more; keep the stored round small.
export function compactSettled(session) {
  if (session.status === 'SETTLED') {
    const t = session.table;
    session.table = { ...t, hand: null, seats: t.seats.map(s => ({ ...s })) };
  }
  return session;
}
