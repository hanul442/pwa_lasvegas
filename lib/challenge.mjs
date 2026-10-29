// 1:1 도전: a short private match with one friend, made from the friends list. 맞고 is one hand
// (one 판); Hold'em is ten hands heads-up. The challenger's room is reserved for that friend, who
// gets a push and a banner; the hand deals as soon as they sit. When the match is over the table
// stops dealing and shows the result; nobody else can take the seat. Unanswered challenges lapse.
// The rooms are ordinary friends' rooms (lib/table-room.mjs, lib/holdem-room.mjs) carrying
// `room.challenge`, so the money, the clock and 친구 전적 work exactly as there.
import { STAKE_TIERS } from './constants.mjs';
import { HOLDEM_BLINDS } from './holdem-session.mjs';
import { MATGO_DEPOSIT_POINTS } from './matgo.mjs';
import { friendMap } from './friends.mjs';
import { createRoom as createTableRoom, tableRoomOf } from './table-room.mjs';
import { createRoom as createHoldemRoom, roomOfUser as holdemRoomOf } from './holdem-room.mjs';

export const CHALLENGE_GAMES = {
  matgo: { hands: 1, label: '맞고 한 판' },
  holdem: { hands: 10, label: '홀덤 10핸드' }
};
export const CHALLENGE_WAIT_MS = 30 * 60_000; // an unanswered challenge lapses
export const CHALLENGE_LINGER_MS = 10 * 60_000; // a finished match keeps its table this long

// What a challenge at a floor's stakes costs to sit: 맞고 at the floor's smallest 점당 (with its
// 10-point deposit), Hold'em with 40 big blinds (inside the floor's buy-in range).
export function challengeStake(game, tierSlug) {
  const tier = STAKE_TIERS.find(t => t.slug === tierSlug);
  if (!tier) return null;
  if (game === 'matgo') return { stake: tier.minBet, need: tier.minBet * MATGO_DEPOSIT_POINTS };
  if (game === 'holdem') {
    const big = HOLDEM_BLINDS[tier.slug]?.big;
    if (!big) return null;
    const buyIn = Math.min(tier.maxBet, Math.max(tier.minBet, big * 40));
    if (buyIn < big * 5) return null;
    return { stake: buyIn, need: buyIn };
  }
  return null;
}

// The floors I can offer a friend: the ones whose seat I can pay for now.
export function challengeOptions(user) {
  const out = {};
  for (const game of Object.keys(CHALLENGE_GAMES)) {
    out[game] = STAKE_TIERS.map(t => ({ tier: t.slug, ...challengeStake(game, t.slug) }))
      .filter(o => o.stake && o.need <= user.account.available);
  }
  return out;
}

export function createChallenge(state, user, { friendId, game, tier }, ctx) {
  const spec = CHALLENGE_GAMES[game];
  if (!spec) throw new Error('UNKNOWN_GAME');
  const friend = state.users[friendId];
  if (!friend || friend.id === user.id || !friendMap(state, user).has(friend.id)) throw new Error('FRIEND_NOT_FOUND');
  if (tableRoomOf(state, friend.id) || holdemRoomOf(state, friend.id)) throw new Error('FRIEND_BUSY');
  const s = challengeStake(game, tier);
  if (!s) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const room = game === 'matgo'
    ? createTableRoom(state, user, { game: 'matgo', stake: s.stake, floor: tier, size: 2 }, ctx)
    : createHoldemRoom(state, user, { buyIn: s.stake, floor: tier, size: 2, challenge: true }, ctx);
  room.challenge = {
    from: user.id, fromName: user.nickname, to: friend.id, toName: friend.nickname, game,
    hands: spec.hands, played: 0, done: false, result: null,
    createdAt: new Date(ctx.now).toISOString(), expiresAt: ctx.now + CHALLENGE_WAIT_MS
  };
  return room;
}

// ---------- the room hooks ----------
// Only the challenged friend may take the empty chair.
export function assertChallengeSeat(room, user) {
  if (room.challenge && !room.players[user.id] && room.challenge.to !== user.id) throw new Error('CHALLENGE_ONLY');
  if (room.challenge?.done) throw new Error('CHALLENGE_DONE');
}
// The friend sat: deal at once.
export function challengeAccepted(room, now) {
  if (!room.challenge || room.started) return;
  room.started = true;
  room.nextAt = now;
  room.challenge.acceptedAt = new Date(now).toISOString();
}
// A hand of the match is over. `nets` maps a person's id to that hand's result, or with
// `total` to where they stand in the whole match (Hold'em: stack against buy-in).
export function challengeAfterHand(room, nets, now, { total = false } = {}) {
  const c = room.challenge;
  if (!c || c.done) return false;
  c.played += 1;
  if (total) c.nets = { ...(c.nets || {}), ...nets };
  else for (const [id, n] of Object.entries(nets)) c.nets = { ...(c.nets || {}), [id]: (c.nets?.[id] || 0) + n };
  if (c.played < c.hands) return false;
  endChallenge(room, now);
  return true;
}
export function endChallenge(room, now, forfeit = null) {
  const c = room.challenge;
  if (!c || c.done) return;
  c.done = true;
  c.endedAt = now;
  if (forfeit) c.forfeit = forfeit;
  const a = c.nets?.[c.from] || 0, b = c.nets?.[c.to] || 0;
  c.winner = forfeit ? (forfeit === c.from ? c.to : c.from) : a > b ? c.from : b > a ? c.to : null;
  room.started = false;
  room.nextAt = null;
}

// What the screen shows: who against whom, how far along, and the result.
export function challengeView(room) {
  const c = room.challenge;
  if (!c) return null;
  return {
    game: c.game, from: { id: c.from, nickname: c.fromName }, to: { id: c.to, nickname: c.toName },
    hands: c.hands, played: c.played, done: c.done, winner: c.winner ?? null, forfeit: c.forfeit ?? null,
    nets: c.nets || {}, expiresAt: c.expiresAt, accepted: Boolean(c.acceptedAt)
  };
}

// True when the room should be wound up: never answered, or finished a while ago.
export function challengeStale(room, now) {
  const c = room.challenge;
  if (!c) return false;
  if (!c.acceptedAt && !c.done) return now >= c.expiresAt;
  return c.done && now - c.endedAt >= CHALLENGE_LINGER_MS;
}

// The challenges waiting on `userId` (the friends list and the news banner).
export function challengesFor(state, userId) {
  const rooms = [...(Array.isArray(state.tableRooms) ? state.tableRooms : []), ...(Array.isArray(state.holdemRooms) ? state.holdemRooms : [])];
  return rooms.filter(r => r.status === 'OPEN' && r.challenge && !r.challenge.done && !r.challenge.acceptedAt && (r.challenge.to === userId || r.challenge.from === userId))
    .map(r => ({
      code: r.code, game: r.challenge.game, tier: r.tier, stake: r.challenge.game === 'holdem' ? r.buyIn : r.stake,
      incoming: r.challenge.to === userId, from: r.challenge.fromName, to: r.challenge.toName, fromId: r.challenge.from, toId: r.challenge.to,
      createdAt: r.challenge.createdAt, expiresAt: r.challenge.expiresAt, label: CHALLENGE_GAMES[r.challenge.game].label
    }));
}
