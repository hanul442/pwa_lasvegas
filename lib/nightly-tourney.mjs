// 매일 밤 9시 홀덤 토너먼트: one scheduled Hold'em tournament a night for everyone on the floor.
// Registration is open all day (KST) until 21:00, with a fixed buy-in locked in the ledger. At
// 21:00 the people are dealt into six-seat tables and AI fill every empty chair, all with the
// same tournament stack. The tables are friends'-room tables (lib/holdem-room.mjs) marked
// `nightly`, so they play, poll and clock exactly like one; this module adds what spans tables:
// places counted across the whole field, tables broken up and their players moved as the field
// shrinks, and the money.
// The pool is the people's buy-ins plus a house bonus, paid by overall place among everyone at
// the start, AI included: an AI that finishes in the money keeps that share in the house, so the
// house bonus only goes to people who outlast the AI. A person is paid the moment their place is
// known (when they bust, or when they win), so nobody waits for the end to play elsewhere.
// Plain data in, plain data out, like the rooms: it runs on the Node server and the Durable Object.
import { id } from './state.mjs';
import { MONEY_UNIT, levelForFloor } from './constants.mjs';
import { lockBet, settleLockedHouseGame } from './economy.mjs';
import { createTable } from './holdem.mjs';
import { HOLDEM_BLINDS, HOLDEM_ENGINE, newBot } from './holdem-session.mjs';
import { newTourney, tourneyPublic, TOURNEY } from './holdem-tourney.mjs';
import { dayKey, pushFeed } from './engagement.mjs';
import { newCode } from './holdem-room.mjs';

const KST = 9 * 60 * 60 * 1000;
const MINUTE = 60_000;
export const NIGHTLY = {
  hour: 21,                        // KST
  buyIn: 1_000_000_000,            // 10억
  bonus: 5_000_000_000,            // 50억 the house adds to the pool
  tier: 'salon-prive',             // blinds 500만/1천만 at level 1, so the 100BB stack is 10억
  seats: 6,
  maxPeople: 60,                   // ten tables
  firstDealMs: MINUTE,             // a minute after 21:00 to get to the table
  remindMs: 10 * MINUTE,           // the push goes out ten minutes before
  // Shares of the pool by overall place: the top three in a field of six, the top six beyond that.
  small: [0.5, 0.3, 0.2],
  big: [0.36, 0.22, 0.15, 0.11, 0.09, 0.07]
};
const GAME = "Hold'em";

export const nightlyStart = key => Date.parse(`${key}T${String(NIGHTLY.hour).padStart(2, '0')}:00:00+09:00`);
const fresh = key => ({ id: key, startsAt: nightlyStart(key), status: 'REG', buyIn: NIGHTLY.buyIn, bonus: NIGHTLY.bonus, entries: {}, tables: [], out: [], field: 0, prize: 0, payouts: [], startedAt: null, endedAt: null, winner: null, reminded: false, startPushed: false });

// The pool split by place, in whole 100만s; 1st takes the remainder.
export function nightlyPayouts(prize, field) {
  const shares = field > NIGHTLY.seats ? NIGHTLY.big : NIGHTLY.small;
  const pay = shares.map(s => Math.floor((prize * s) / MONEY_UNIT) * MONEY_UNIT);
  pay[0] += prize - pay.reduce((a, x) => a + x, 0);
  return pay;
}
const poolFor = people => people * NIGHTLY.buyIn + NIGHTLY.bonus;
const fieldFor = people => Math.ceil(Math.max(1, people) / NIGHTLY.seats) * NIGHTLY.seats;

const holdemRooms = state => (Array.isArray(state.holdemRooms) ? state.holdemRooms : (state.holdemRooms = []));
export const nightlyRooms = (state, n = state.nightly) => (n ? holdemRooms(state).filter(r => r.nightly === n.id) : []);
const openTables = (state, n) => nightlyRooms(state, n).filter(r => r.status === 'OPEN');
const alive = room => room.table.seats.filter(s => s.kind !== 'empty' && s.stack > 0).length;
export const nightlyLeft = (state, n = state.nightly) => openTables(state, n).reduce((a, r) => a + alive(r), 0);
const handLive = t => Boolean(t.hand && !t.hand.over);

// Tonight's record, made fresh each KST day. One still being played runs to its end first, and
// one nobody touched by 21:00 starts late rather than being skipped.
export function currentNightly(state, now, rand = Math.random) {
  let n = state.nightly;
  if (n?.status === 'REG' && now >= n.startsAt) startNightly(state, n, now, rand);
  const key = dayKey(now);
  if (n && (n.id === key || n.status === 'RUNNING')) return n;
  if (n) state.nightlyLast = summary(state, n);
  n = state.nightly = fresh(key);
  if (now >= n.startsAt) n.status = 'CANCELLED'; // a day first seen after 21:00 has no tournament
  return n;
}

function summary(state, n) {
  return {
    id: n.id, status: n.status, people: Object.keys(n.entries).length, field: n.field, prize: n.prize,
    winner: n.winner, top: placesOf(n).slice(0, 6)
  };
}

// Everyone with a place so far, best first: the winner, then busts from the last to the first.
const placesOf = n => [...(n.winner ? [{ ...n.winner, place: 1, payout: n.payouts[0] ?? 0 }] : []), ...[...n.out].sort((a, b) => a.place - b.place)]
  .map(o => ({ place: o.place, name: o.name, kind: o.kind, userId: o.userId ?? null, payout: o.payout ?? 0 }));

// ---------- registration ----------
export function registerNightly(state, user, now) {
  const n = currentNightly(state, now);
  if (n.status !== 'REG' || now >= n.startsAt) throw new Error('NIGHTLY_CLOSED');
  if (n.entries[user.id]) return n;
  if (Object.keys(n.entries).length >= NIGHTLY.maxPeople) throw new Error('NIGHTLY_FULL');
  if (user.account.available < n.buyIn) throw new Error('INSUFFICIENT_BANKROLL');
  const ticket = id('night');
  lockBet(state, user, { stake: n.buyIn, game: GAME, roundId: ticket, metadata: { engineVersion: HOLDEM_ENGINE, nightly: n.id } });
  n.entries[user.id] = { userId: user.id, nickname: user.nickname, ticket, buyIn: n.buyIn, at: new Date(now).toISOString(), place: null, payout: 0, settled: false };
  return n;
}

// Before 21:00 the buy-in comes straight back.
export function unregisterNightly(state, user, now) {
  const n = currentNightly(state, now);
  const e = n.entries[user.id];
  if (!e) throw new Error('NOT_REGISTERED');
  if (n.status !== 'REG') throw new Error('NIGHTLY_CLOSED');
  settleLockedHouseGame(state, user, { game: GAME, stake: e.buyIn, netPnl: 0, wagered: 0, roundId: e.ticket, details: { engineVersion: HOLDEM_ENGINE, nightly: n.id, unregistered: true } });
  delete n.entries[user.id];
  return n;
}

// ---------- the start ----------
function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

export function startNightly(state, n, now, rand = Math.random) {
  const people = shuffle(Object.values(n.entries), rand);
  if (!people.length) { n.status = 'CANCELLED'; n.endedAt = now; return; }
  const tables = Math.ceil(people.length / NIGHTLY.seats);
  n.status = 'RUNNING';
  n.startedAt = now;
  n.field = tables * NIGHTLY.seats;
  n.prize = poolFor(people.length);
  n.payouts = nightlyPayouts(n.prize, n.field);
  // People spread evenly over the tables, AI in every chair left over.
  const groups = Array.from({ length: tables }, () => []);
  people.forEach((e, k) => groups[k % tables].push(e));
  for (const group of groups) openTable(state, n, group, now, rand);
}

function openTable(state, n, group, now, rand) {
  const blinds = HOLDEM_BLINDS[NIGHTLY.tier];
  const stack = blinds.big * TOURNEY.depth;
  const level = levelForFloor(NIGHTLY.tier);
  const seats = group.map(e => ({ id: e.userId, name: e.nickname, kind: 'human', stack }));
  while (seats.length < NIGHTLY.seats) seats.push({ ...newBot({ seats, buyIn: stack, big: blinds.big, level }, rand), stack });
  shuffle(seats, rand);
  const firstDeal = now + NIGHTLY.firstDealMs;
  const tourney = newTourney({ base: blinds.big, fillBots: true });
  tourney.startedAt = firstDeal; // the blind clock starts with the first deal
  tourney.prize = n.prize;
  tourney.payouts = n.payouts;
  const room = {
    id: id('hrm'), code: newCode(state, rand), floor: NIGHTLY.tier, tier: NIGHTLY.tier, buyIn: n.buyIn, size: NIGHTLY.seats, hostId: null,
    status: 'OPEN', started: true, createdAt: new Date(now).toISOString(),
    table: createTable({ seats, smallBlind: blinds.small, bigBlind: blinds.big, button: Math.floor(rand() * seats.length), unit: MONEY_UNIT, level }),
    players: {}, turn: null, nextAt: firstDeal, prev: null, botIn: 0, botOut: 0, tourney, nightly: n.id, moved: {}
  };
  // Everyone starts away: their turns check or fold at once until they open the table.
  room.table.seats.forEach((s, i) => {
    if (s.kind !== 'human') return;
    const e = n.entries[s.id];
    room.players[s.id] = { userId: s.id, nickname: s.name, ticket: e.ticket, buyIn: e.buyIn, seat: i, missed: 0, away: true, joinedAt: new Date(now).toISOString() };
  });
  holdemRooms(state).push(room);
  n.tables.push(room.code);
  return room;
}

// ---------- after each hand (called by the room's tick) ----------
function settleEntry(state, n, e, room) {
  if (e.settled) return;
  e.settled = true;
  const user = state.users[e.userId];
  if (!user) return;
  settleLockedHouseGame(state, user, {
    game: GAME, stake: e.buyIn, netPnl: e.payout - e.buyIn, roundId: e.ticket,
    details: { engineVersion: HOLDEM_ENGINE, room: room.code, tourney: true, nightly: n.id, place: e.place, payout: e.payout, field: n.field }
  });
}

// Returns true when the tournament is over (the room stops ticking).
export function nightlyAfterHand(state, room, now) {
  const n = state.nightly;
  if (!n || n.id !== room.nightly || n.status !== 'RUNNING') { room.status = 'DONE'; return true; }
  const t = room.table, tn = room.tourney, handNo = t.hand?.no ?? t.handNo;
  const busted = t.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.kind !== 'empty' && s.stack <= 0 && !tn.out.some(o => o.id === s.id));
  // Several out in one hand: whoever started it deeper places higher.
  busted.sort((a, b) => (tn.handStart[b.i] ?? 0) - (tn.handStart[a.i] ?? 0) || a.i - b.i);
  const left = nightlyLeft(state, n);
  busted.forEach(({ s, i }, k) => {
    const place = left + 1 + k;
    const payout = n.payouts[place - 1] ?? 0;
    tn.out.push({ seat: i, name: s.name, kind: s.kind, id: s.id, hand: handNo });
    n.out.push({ id: s.id, name: s.name, kind: s.kind, userId: s.kind === 'human' ? s.id : null, place, payout, at: now });
    const e = s.kind === 'human' ? n.entries[s.id] : null;
    if (e) { e.place = place; e.payout = payout; settleEntry(state, n, e, room); }
  });
  if (left <= 1) { finishNightly(state, n, now); return true; }
  breakTables(state, n, now);
  return room.status !== 'OPEN';
}

function finishNightly(state, n, now) {
  const tables = openTables(state, n);
  const room = tables.find(r => alive(r) > 0);
  const seat = room?.table.seats.find(s => s.kind !== 'empty' && s.stack > 0);
  if (seat) {
    n.winner = { id: seat.id, name: seat.name, kind: seat.kind, userId: seat.kind === 'human' ? seat.id : null };
    const e = seat.kind === 'human' ? n.entries[seat.id] : null;
    if (e) { e.place = 1; e.payout = n.payouts[0]; settleEntry(state, n, e, room); }
    const text = seat.kind === 'human'
      ? `${seat.name}님이 밤 9시 홀덤 토너먼트에서 ${n.field}명을 꺾고 우승했어요`
      : `밤 9시 홀덤 토너먼트는 AI ${seat.name}의 우승으로 끝났어요`;
    pushFeed(state, { type: 'NIGHTLY_WIN', actorId: n.winner.userId, text, amount: seat.kind === 'human' ? n.payouts[0] : 0 });
  }
  // Anyone still unpaid (it should be nobody) gets their buy-in back rather than stay locked.
  for (const e of Object.values(n.entries)) if (!e.settled) { e.payout = e.buyIn; settleEntry(state, n, e, room || tables[0] || { code: null }); }
  n.status = 'DONE';
  n.endedAt = now;
  for (const r of nightlyRooms(state, n)) {
    if (r.status === 'OPEN') { r.status = 'DONE'; r.turn = null; r.nextAt = null; }
    r.tourney.done = true;
    r.tourney.endedAt ??= now;
  }
  state.holdemRooms = holdemRooms(state).filter(r => r.nightly !== n.id || Object.keys(r.players).length);
}

// As the field shrinks, the smallest table between hands breaks up when the others have chairs
// for everyone still at it. Players keep their stacks; a person's screen follows them (`moved`).
export function breakTables(state, n, now) {
  const tables = openTables(state, n);
  if (tables.length < 2) return false;
  const free = r => r.table.seats.map((s, i) => i).filter(i => r.table.seats[i].stack <= 0 && !(handLive(r.table) && r.table.hand.players[i]));
  for (const from of tables.filter(r => !handLive(r.table)).sort((a, b) => alive(a) - alive(b))) {
    const others = tables.filter(r => r !== from);
    if (alive(from) > others.reduce((a, r) => a + free(r).length, 0)) continue;
    from.table.seats.forEach((s, i) => {
      if (s.kind === 'empty' || s.stack <= 0) return;
      const to = [...others].sort((a, b) => free(b).length - free(a).length)[0];
      moveSeat(from, i, to, free(to)[0]);
    });
    from.status = 'DONE';
    from.turn = null;
    from.nextAt = null;
    from.tourney.endedAt = now;
    if (!Object.keys(from.players).length) state.holdemRooms = holdemRooms(state).filter(r => r !== from);
    return true;
  }
  return false;
}

function moveSeat(from, i, to, j) {
  const s = from.table.seats[i], old = to.table.seats[j];
  // Someone out of the tournament watching from that chair keeps watching, without a seat.
  if (old.kind === 'human' && to.players[old.id]) to.players[old.id].seat = -1;
  to.table.seats[j] = { id: s.id, name: s.name, kind: s.kind, style: s.style || null, stack: s.stack };
  if (s.kind === 'human' && from.players[s.id]) {
    to.players[s.id] = { ...from.players[s.id], seat: j };
    delete from.players[s.id];
    from.moved[s.id] = to.code;
  }
  from.table.seats[i] = { id: null, name: '', kind: 'empty', stack: 0 };
}

// Getting up: with chips it only sits the seat out (it plays itself, and the money is still
// mine when my place comes); out of the tournament it frees me to go.
export function leaveNightly(state, room, userId) {
  const n = state.nightly, p = room.players[userId];
  const e = n?.id === room.nightly ? n.entries[userId] : null;
  const seat = p.seat >= 0 ? room.table.seats[p.seat] : null;
  if (room.status === 'OPEN' && seat?.id === userId && seat.stack > 0) {
    p.away = true;
    return { cashOut: 0, netPnl: 0, tourney: { pending: true, away: true } };
  }
  delete room.players[userId];
  if (!Object.keys(room.players).length && room.status !== 'OPEN') state.holdemRooms = holdemRooms(state).filter(r => r !== room);
  return { cashOut: e?.payout ?? 0, netPnl: e ? e.payout - e.buyIn : 0, tourney: { pending: Boolean(e && !e.settled), forfeit: false, place: e?.place ?? null } };
}

// ---------- the clock (every request, and the minute cron in the evening) ----------
export function sweepNightly(state, now, rand = Math.random) {
  const n = currentNightly(state, now, rand);
  if (n.status === 'RUNNING') breakTables(state, n, now);
  return n;
}

// The reminder ten minutes before, and the call to the tables at the start. Recorded as sent.
export function planNightlyPushes(state, now) {
  const n = state.nightly;
  if (!n || !state.push?.vapid) return [];
  const out = [];
  const people = Object.keys(n.entries).length;
  const to = (user, message) => out.push({ userId: user.id, subs: user.push.subs.map(s => ({ endpoint: s.endpoint, keys: s.keys })), message: { tag: 'nightly', url: './?nightly=1', ...message } });
  const won = v => formatMoney(v);
  if (n.status === 'REG' && !n.reminded && now >= n.startsAt - NIGHTLY.remindMs && now < n.startsAt) {
    n.reminded = true;
    for (const user of Object.values(state.users)) {
      if (!user.push?.subs?.length) continue;
      if (n.entries[user.id]) to(user, { title: '10분 뒤 밤 9시 홀덤 토너먼트', body: `등록 완료! ${people}명이 기다려요. 9시 정각에 자리로 오세요. 상금 ${won(poolFor(people))}.` });
      else if (user.account.available >= n.buyIn) to(user, { title: '밤 9시 홀덤 토너먼트, 등록 마감 10분 전', body: `바이인 ${won(n.buyIn)}, 상금 ${won(poolFor(people + 1))}. 지금 ${people}명 등록했어요.` });
    }
  }
  if (n.status === 'RUNNING' && !n.startPushed) {
    n.startPushed = true;
    for (const user of Object.values(state.users)) {
      if (user.push?.subs?.length && n.entries[user.id]) to(user, { title: '토너먼트가 시작됐어요', body: `${n.field}명이 앉았어요. 자리를 비우면 자동으로 체크/폴드돼요. 지금 테이블로!` });
    }
  }
  return out;
}

// 5000000000 → "50억", the way the app writes money.
function formatMoney(v) {
  const n = Math.max(0, Math.round(v)), jo = Math.floor(n / 1e12), eok = Math.floor(n / 1e8) % 1e4, man = Math.floor(n / 1e4) % 1e4;
  return [jo && `${jo}조`, eok && `${eok}억`, man && `${man}만`].filter(Boolean).join(' ') || '0';
}

// ---------- views ----------
// The home card: when, how much, who's in, and live while it runs.
export function nightlyView(state, user, now) {
  const n = state.nightly && (state.nightly.id === dayKey(now) || state.nightly.status === 'RUNNING') ? state.nightly : fresh(dayKey(now));
  const entries = Object.values(n.entries);
  const e = n.entries[user.id];
  const reg = n.status === 'REG';
  const prize = reg ? poolFor(entries.length) : n.prize;
  const field = reg ? fieldFor(entries.length) : n.field;
  const mine = nightlyRooms(state, n).find(r => r.players[user.id]);
  const tomorrow = nightlyStart(dayKey(now + 24 * 60 * MINUTE));
  return {
    id: n.id, status: reg && now >= n.startsAt ? 'RUNNING' : n.status, startsAt: n.startsAt, next: reg ? n.startsAt : tomorrow,
    buyIn: n.buyIn, bonus: n.bonus, prize, field, payouts: reg ? nightlyPayouts(prize, field) : n.payouts,
    people: entries.length, names: entries.slice(0, 12).map(x => x.nickname), maxPeople: NIGHTLY.maxPeople,
    registered: Boolean(e), canAfford: user.account.available >= n.buyIn,
    left: n.status === 'RUNNING' ? nightlyLeft(state, n) : null, tables: n.status === 'RUNNING' ? openTables(state, n).length : 0,
    me: e ? { place: e.place, payout: e.place ? e.payout : null, table: mine?.code ?? null, seated: Boolean(mine && mine.status === 'OPEN') } : null,
    winner: n.winner ? { name: n.winner.name, kind: n.winner.kind, me: n.winner.userId === user.id } : null,
    top: placesOf(n).slice(0, 6).map(r => ({ ...r, me: r.userId === user.id, userId: undefined })),
    last: state.nightlyLast && state.nightlyLast.id !== n.id ? { ...state.nightlyLast, top: state.nightlyLast.top.map(r => ({ ...r, me: r.userId === user.id, userId: undefined })) } : null,
    level: n.status === 'RUNNING' ? (openTables(state, n)[0]?.tourney.level ?? 0) + 1 : null,
    serverNow: now
  };
}

// A nightly table's tournament panel: the table's clock, with the whole field's count, pool and places.
export function nightlyTourneyView(state, room, userId, now) {
  const base = tourneyPublic(room.tourney, room.table, userId, now);
  const n = state?.nightly?.id === room.nightly ? state.nightly : null;
  if (!n) return { ...base, nightly: true };
  const row = e => ({ userId: e.userId, nickname: e.nickname, out: Boolean(e.place) && e.place !== 1, forfeit: false, place: e.place, payout: e.place ? e.payout : null, me: e.userId === userId });
  const standings = Object.values(n.entries).map(row).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const me = n.entries[userId];
  return {
    ...base, nightly: true, done: n.status === 'DONE', prize: n.prize, payouts: n.payouts,
    people: Object.keys(n.entries).length, entrants: n.field, left: n.status === 'DONE' ? 1 : nightlyLeft(state, n), tables: openTables(state, n).length,
    out: room.tourney.out.filter(o => room.table.seats[o.seat]?.id === o.id).map(o => ({ seat: o.seat, name: o.name, kind: o.kind, hand: o.hand })), // a chair someone moved into is theirs now
    standings, me: me ? row(me) : null,
    winner: n.winner ? { name: n.winner.name, kind: n.winner.kind, me: n.winner.userId === userId } : null
  };
}
