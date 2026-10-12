// A solo Hold'em session: one person bought in at a table of AI bots. The person's buy-in is
// locked in the ledger while they sit; standing up settles stack minus buy-in. Bots are
// bankrolled by the house and replaced when they bust. A friends' table can reuse the same
// engine with several human seats; only this driver is single-player.
import { id } from './state.mjs';
import { STAKE_TIERS } from './constants.mjs';
import { createTable, startHand, applyAction, publicTable } from './holdem.mjs';
import { decide, BOT_STYLES, BOT_NAMES } from './holdem-bot.mjs';
import { eventById, eventOpen } from './events.mjs';

export const HOLDEM_ENGINE = 'HOLDEM_V1';
export const HERO = 0;

// Blinds per table tier; the buy-in itself must fit the tier's stake range. The big blind is a
// tenth of the tier's smallest buy-in (at least 2, so the small blind always splits), so the
// cheapest seat is ten big blinds deep.
export const HOLDEM_BLINDS = Object.fromEntries(STAKE_TIERS.map(t => {
  const big = Math.max(2, t.minBet / 10);
  return [t.slug, { small: big / 2, big }];
}));

// ---------- Casino Royale (007 체험 이벤트) ----------
// A six-seat sit-and-go against named high rollers, the way the film plays it: everyone buys in
// for the table maximum, blinds climb every few hands, nobody new sits down, and the last player
// with chips takes the whole table. One rebuy is allowed while at least two rivals are still in.
// The event's window and lobby copy live in lib/events.mjs.
export const royaleOpen = (now = Date.now()) => eventOpen(eventById('royale'), now);
export const ROYALE = {
  depth: 50,          // starting stack in big blinds
  levelHands: 6,      // hands per blind level
  ladder: [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32],
  rebuys: 1,
  rivals: [
    { name: '르 시프르', style: 'SHARK' },
    { name: '몬테네그로 백작', style: 'ROCK' },
    { name: '스위스 은행가', style: 'STATION' },
    { name: '모스크바 브로커', style: 'MANIAC' },
    { name: '텍사스 석유왕', style: 'STATION' }
  ]
};
// 라운더스 헤즈업: one boss at a time, heads-up, on the same tournament rules (no rebuy). Bust
// the boss to climb to the next one; the ladder is kept on the account.
export const ROUNDERS = {
  depth: 40, levelHands: 8, ladder: [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32], rebuys: 0,
  bosses: [
    { name: '피시 미키', style: 'STATION' },
    { name: '체스터 루즈', style: 'MANIAC' },
    { name: '조이 크닉', style: 'ROCK' },
    { name: 'KGB 테디', style: 'SHARK' }
  ]
};
// The Whale Room: Casino Royale's rules one floor up, against the world's richest.
export const WHALE = {
  ...ROYALE,
  rivals: [
    { name: '두바이 왕자', style: 'MANIAC' },
    { name: '홍콩 해운왕', style: 'ROCK' },
    { name: '실리콘밸리 창업자', style: 'SHARK' },
    { name: '모나코 상속녀', style: 'STATION' },
    { name: '오일 머니 셰이크', style: 'MANIAC' }
  ]
};
// Tournament events Hold'em knows how to run, by event id (lib/events.mjs).
export const TOURNEYS = { royale: ROYALE, rounders: ROUNDERS, whale: WHALE };
export const tourneyOpen = (event, now = Date.now()) => Boolean(TOURNEYS[event]) && eventOpen(eventById(event), now);
const cfgOf = r => TOURNEYS[r?.event] || ROYALE;
const evenBlind = x => Math.max(2, Math.round(x / 2) * 2);
export function royaleBlinds(entry, level, cfg = ROYALE) {
  const big = evenBlind((entry / cfg.depth) * cfg.ladder[Math.min(level, cfg.ladder.length - 1)]);
  return { small: big / 2, big };
}

function pick(list, taken, rand) {
  const free = list.filter(x => !taken.includes(x));
  return free[Math.floor(rand() * free.length)] || list[Math.floor(rand() * list.length)];
}

export function newBot({ seats, buyIn, big }, rand) {
  const styles = Object.keys(BOT_STYLES);
  // Bots sit with roughly what the person brought, so pots stay meaningful.
  const stack = Math.max(big * 20, Math.round((buyIn * (0.7 + rand() * 0.8)) / big) * big);
  return { id: id('bot'), name: pick(BOT_NAMES, seats.map(s => s.name), rand), kind: 'bot', style: styles[Math.floor(rand() * styles.length)], stack };
}

// `royale: true` (Casino Royale) or `event: 'rounders'` with `boss` (its ladder step) seats a tournament.
export function createHoldemSession({ userId, nickname, buyIn, tier, opponents = 5, floor, royale = false, event = null, boss = 0 }, rand = Math.random) {
  if (royale || TOURNEYS[event]) return createRoyaleSession({ userId, nickname, buyIn, tier, floor, event: royale ? 'royale' : event, boss }, rand);
  const blinds = HOLDEM_BLINDS[tier];
  if (!blinds) throw new Error('INVALID_TIER');
  const count = Number(opponents);
  if (![1, 2, 3, 4, 5].includes(count)) throw new Error('INVALID_OPPONENTS');
  if (!Number.isSafeInteger(buyIn) || buyIn < blinds.big * 5) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const seats = [{ id: userId, name: nickname, kind: 'human', stack: buyIn }];
  for (let k = 0; k < count; k++) seats.push(newBot({ seats, buyIn, big: blinds.big }, rand));
  return {
    id: id('hold'), game: "Hold'em", engineVersion: HOLDEM_ENGINE, userId, floor, tier, stake: buyIn, buyIn,
    status: 'SEATED', createdAt: new Date().toISOString(), lastCommand: null,
    table: createTable({ seats, smallBlind: blinds.small, bigBlind: blinds.big, button: Math.floor(rand() * seats.length) })
  };
}

function createRoyaleSession({ userId, nickname, buyIn, tier, floor, event = 'royale', boss = 0 }, rand) {
  if (!Number.isSafeInteger(buyIn) || buyIn < 100) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const cfg = TOURNEYS[event];
  const blinds = royaleBlinds(buyIn, 0, cfg);
  const rivals = cfg.rivals || [cfg.bosses[Math.min(boss, cfg.bosses.length - 1)]];
  const seats = [{ id: userId, name: nickname, kind: 'human', stack: buyIn }, ...rivals.map(r => ({ id: id('bot'), name: r.name, kind: 'bot', style: r.style, stack: buyIn }))];
  return {
    id: id('hold'), game: "Hold'em", engineVersion: HOLDEM_ENGINE, userId, floor, tier, stake: buyIn, buyIn,
    status: 'SEATED', createdAt: new Date().toISOString(), lastCommand: null,
    royale: { event, boss: cfg.bosses ? Math.min(boss, cfg.bosses.length - 1) : null, entry: buyIn, level: 0, rebuys: 0, canRebuy: false, out: [], place: null },
    table: createTable({ seats, smallBlind: blinds.small, bigBlind: blinds.big, button: Math.floor(rand() * seats.length) })
  };
}

const liveRivals = t => t.seats.filter((s, i) => i !== HERO && s.stack > 0).length;

// After a tournament hand: rivals who busted are out for good, and the tournament ends when the
// person is the last one standing or busts with no rebuy left.
export function royaleAfterHand(session) {
  const r = session.royale, t = session.table, events = [];
  if (!r || session.status !== 'SEATED' || !t.hand?.over) return events;
  const left = liveRivals(t);
  t.seats.forEach((s, i) => {
    if (i === HERO || s.stack > 0 || r.out.some(o => o.seat === i)) return;
    const place = left + (t.seats[HERO].stack > 0 ? 1 : 0) + 1; // players busted in the same hand share a place
    r.out.push({ seat: i, name: s.name, hand: t.handNo, place });
    events.push({ t: 'out', seat: i, name: s.name, place });
  });
  if (t.seats[HERO].stack <= 0) {
    r.canRebuy = r.rebuys < cfgOf(r).rebuys && left >= 2;
    if (!r.canRebuy) { r.place = left + 1; events.push({ t: 'royale-end', place: r.place }, ...standUp(session)); }
  } else if (left === 0) {
    r.place = 1;
    events.push({ t: 'royale-end', place: 1 }, ...standUp(session));
  }
  return events;
}

// The one rebuy: a fresh entry's worth of chips. The caller locks the extra money.
export function royaleRebuy(session) {
  const r = session.royale;
  if (!r || session.status !== 'SEATED' || !r.canRebuy || session.table.seats[HERO].stack > 0) throw new Error('REBUY_NOT_OFFERED');
  r.canRebuy = false;
  r.rebuys += 1;
  session.buyIn += r.entry;
  session.table.seats[HERO].stack = r.entry;
  return [{ t: 'rebuy', seat: HERO, stack: r.entry }];
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
  if (session.royale) {
    if (liveRivals(t) === 0) throw new Error('SESSION_CLOSED');
    const cfg = cfgOf(session.royale);
    const level = Math.floor(t.handNo / cfg.levelHands);
    if (level !== session.royale.level) {
      const b = royaleBlinds(session.royale.entry, level, cfg);
      session.royale.level = level;
      t.smallBlind = b.small; t.bigBlind = b.big;
      events.push({ t: 'level', level: level + 1, small: b.small, big: b.big });
    }
    startHand(t);
    runBots(session, rand);
    return [...events, ...eventsSince(session, 0)];
  }
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
  // Leaving a tournament before it is decided forfeits the seat: chips on the table are not cash.
  if (session.royale && session.royale.place === null) {
    session.royale.place = t.seats.filter(s => s.stack > 0).length || 1;
    session.royale.forfeit = true;
    t.seats[HERO].stack = 0;
  }
  session.cashOut = t.seats[HERO].stack;
  session.netPnl = session.cashOut - session.buyIn;
  session.settledAt = new Date().toISOString();
  return events;
}

export function holdemPublic(session) {
  return {
    id: session.id, game: session.game, status: session.status, tier: session.tier, floor: session.floor,
    buyIn: session.buyIn, hero: HERO, cashOut: session.cashOut ?? null, netPnl: session.netPnl ?? null,
    royale: session.royale ? royalePublic(session) : null,
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

function royalePublic(session) {
  const r = session.royale, t = session.table, cfg = cfgOf(r);
  return {
    event: r.event, boss: r.boss, bossName: cfg.bosses && r.boss !== null ? cfg.bosses[r.boss].name : null, bounty: r.bounty ?? null, bonus: r.bonus ?? null, bosses: cfg.bosses ? cfg.bosses.length : null, entry: r.entry, rebuys: r.rebuys, canRebuy: r.canRebuy, place: r.place, forfeit: Boolean(r.forfeit), out: r.out.map(o => ({ ...o })),
    level: r.level + 1, handsToNext: cfg.levelHands - (t.handNo % cfg.levelHands), next: royaleBlinds(r.entry, r.level + 1, cfg),
    left: t.seats.filter((s, i) => s.stack > 0 || (i === HERO && r.canRebuy)).length, seats: t.seats.length, prize: r.entry * (t.seats.length + r.rebuys) + r.entry * (cfg.bosses ? (r.boss ?? 0) + 1 : 4)
  };
}
