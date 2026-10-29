// 친구: who counts as my friend, who of them is here right now, and where they are sitting.
// Friends are worked out, not kept in one list: anyone I have played a friends' room with
// (lib/friend-record.mjs), whoever brought me in or came in through my invite link
// (lib/referral.mjs), and anyone I added by name. A friend I took off stays off.
//
// "Here right now" lives in memory only (the Durable Object, or the Node server), so the app's
// 20-second news poll can say "I'm here" without writing the whole state every time. When a
// player turns up after a long gap, their friends who aren't looking get one push.
import { tableRoomOf } from './table-room.mjs';
import { roomOfUser as holdemRoomOf, roomGame } from './holdem-room.mjs';
import { lastActive, markSeen } from './notifications.mjs';
import { DEMO_PLAYERS } from './state.mjs';
import { watchRefusal } from './watch.mjs';

export const ONLINE_MS = 90_000; // the app polls every 20 s while it is open
export const SESSION_GAP_MS = 10 * 60_000; // a ping after this long starts a new visit
export const ARRIVAL_IDLE_MS = 3 * 3_600_000; // away at least this long before friends hear about it
export const FRIEND_PUSH_GAP_MS = 3 * 3_600_000; // one "friend is here" push per person per 3 hours
export const MAX_ADDED = 50;
const KST = 9 * 3_600_000;

// ---------- presence (memory) ----------
const pings = new Map();
export function resetPresence() { pings.clear(); }

// Notes that `userId` is here. Returns true when this starts a new visit.
export function notePresence(userId, now = Date.now()) {
  if (!userId) return false;
  const last = pings.get(userId);
  pings.set(userId, now);
  return last === undefined || now - last >= SESSION_GAP_MS;
}
export const isOnline = (userId, now = Date.now()) => now - (pings.get(userId) ?? -Infinity) < ONLINE_MS;
const lastPing = userId => pings.get(userId) ?? 0;

// ---------- who my friends are ----------
function friendBox(user) {
  if (!user.friends || typeof user.friends !== 'object') user.friends = { added: [], hidden: [] };
  if (!Array.isArray(user.friends.added)) user.friends.added = [];
  if (!Array.isArray(user.friends.hidden)) user.friends.hidden = [];
  return user.friends;
}

// id → how we know each other ('added' | 'played' | 'invite'), first reason wins.
export function friendMap(state, user) {
  const out = new Map();
  if (!user) return out;
  const hidden = new Set(user.friends?.hidden || []);
  const add = (id, why) => {
    if (!id || id === user.id || hidden.has(id) || out.has(id)) return;
    const f = state.users?.[id];
    if (!f || DEMO_PLAYERS.includes(id) || (f.guest && !f.nickname)) return;
    out.set(id, why);
  };
  for (const id of user.friends?.added || []) add(id, 'added');
  for (const id of Object.keys(user.friendRecord?.vs || {})) add(id, 'played');
  add(user.referredBy?.userId, 'invite');
  for (const u of Object.values(state.users || {})) if (u.referredBy?.userId === user.id) add(u.id, 'invite');
  return out;
}

// Everyone who has `user` among their friends (who hears when they turn up).
export function friendsOf(state, user) {
  return Object.values(state.users || {}).filter(u => u.id !== user.id && friendMap(state, u).has(user.id));
}

const ROOM_GAME_NAMES = { seotda: '섯다', gostop: '고스톱', matgo: '맞고', blackjack: '블랙잭', baccarat: '바카라', holdem: '홀덤' };
const SOLO_NAMES = { Blackjack: '블랙잭', Baccarat: '바카라', Roulette: '룰렛', 'Sic Bo': '식보', Matgo: '맞고', Gostop: '고스톱', Seotda: '섯다', "Hold'em": '홀덤', 'Seven Poker': '7포커', Slots: '슬롯', 'Horse Racing': '경마' };

// Where a player is sitting: a friends' room (one I can join or watch), or a solo table.
export function whereIs(state, userId) {
  const room = tableRoomOf(state, userId);
  if (room) {
    const n = Object.keys(room.players).length;
    return { kind: 'room', game: room.game, name: ROOM_GAME_NAMES[room.game], code: room.code, tier: room.tier, floor: room.floor ?? null, stake: room.stake, people: n, size: room.size, open: n < room.size && !room.challenge, started: room.started, ...(room.challenge && { challenge: true }) };
  }
  const hr = holdemRoomOf(state, userId);
  if (hr) {
    const n = Object.keys(hr.players).length;
    const size = hr.size || n;
    const seven = roomGame(hr) === 'sevenpoker';
    return { kind: 'room', game: roomGame(hr), name: seven ? '7포커' : hr.nightly ? '밤 토너먼트' : hr.tourney ? '홀덤 토너먼트' : '홀덤', code: hr.code, tier: hr.tier ?? null, floor: hr.floor ?? null, stake: hr.buyIn ?? null, people: n, size, open: !hr.nightly && !hr.challenge && !(hr.tourney && hr.started) && n < size, started: Boolean(hr.started), ...(hr.challenge && { challenge: true }) };
  }
  const solo = (state.rounds || []).find(r => r.userId === userId && r.status !== 'SETTLED');
  if (solo) return { kind: 'solo', game: solo.game, name: SOLO_NAMES[solo.game] || solo.game };
  return null;
}

// Can I watch this friend's room (lib/watch.mjs)? Only shown when I may.
function withWatch(state, viewer, friendId, where) {
  if (where?.kind !== 'room') return where;
  const list = where.game === 'holdem' || where.game === 'sevenpoker' ? state.holdemRooms : state.tableRooms;
  const room = (Array.isArray(list) ? list : []).find(r => r.code === where.code && r.status === 'OPEN');
  return { ...where, watchable: Boolean(room && !watchRefusal(state, viewer, room, friendId)) };
}

// The friends list the 랭킹 → 친구 screen draws: who is here first, then whoever was here last.
export function friendsView(state, user, now = Date.now()) {
  const map = friendMap(state, user);
  const vs = user.friendRecord?.vs || {};
  const rows = [...map].map(([id, why]) => {
    const f = state.users[id];
    const online = isOnline(id, now);
    const seen = Math.max(lastPing(id), lastActive(state, f));
    const v = vs[id];
    return {
      id, nickname: f.nickname, why, online,
      lastSeenAt: seen ? new Date(seen).toISOString() : null,
      where: online ? withWatch(state, user, id, whereIs(state, id)) : null,
      hands: v?.hands || 0, won: v?.won || 0, lost: v?.lost || 0
    };
  });
  rows.sort((a, b) => (b.online - a.online) || (Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0)));
  return { list: rows.slice(0, 40), online: rows.filter(r => r.online).length, added: (user.friends?.added || []).length };
}

// ---------- adding and taking off ----------
const norm = s => String(s ?? '').trim().toLowerCase();
export function addFriend(state, user, nickname) {
  const want = norm(nickname);
  if (!want) throw new Error('FRIEND_NAME_REQUIRED');
  const f = Object.values(state.users).find(u => !u.guest && !DEMO_PLAYERS.includes(u.id) && norm(u.nickname) === want);
  if (!f) throw new Error('FRIEND_NOT_FOUND');
  if (f.id === user.id) throw new Error('FRIEND_IS_ME');
  const box = friendBox(user);
  box.hidden = box.hidden.filter(id => id !== f.id);
  if (!box.added.includes(f.id)) {
    if (box.added.length >= MAX_ADDED) throw new Error('FRIEND_LIST_FULL');
    box.added.push(f.id);
  }
  return f;
}
export function removeFriend(state, user, id) {
  const box = friendBox(user);
  box.added = box.added.filter(x => x !== id);
  if (state.users[id] && !box.hidden.includes(id)) box.hidden.push(id);
}

// ---------- "OO님이 들어왔어요" ----------
const kstHour = now => new Date(now + KST).getUTCHours();

// A new visit after a long gap: the friends who aren't here hear about it, once per 3 hours each,
// never at night. Call inside a state mutation; returns the plan for deliverPlan.
export function planFriendArrival(state, user, { idleSince, now = Date.now() } = {}) {
  if (!user || user.guest) return [];
  if (now - idleSince < ARRIVAL_IDLE_MS) return [];
  const hour = kstHour(now);
  if (hour < 9 || hour >= 22) return [];
  const out = [];
  for (const f of friendsOf(state, user)) {
    if (!f.push?.subs?.length || isOnline(f.id, now)) continue;
    const sent = f.push.sent || (f.push.sent = {});
    if (sent.friendAt && now - Date.parse(sent.friendAt) < FRIEND_PUSH_GAP_MS) continue;
    sent.friendAt = new Date(now).toISOString();
    out.push({
      userId: f.id,
      subs: f.push.subs.map(s => ({ endpoint: s.endpoint, keys: s.keys })),
      message: { title: `${user.nickname}님이 들어왔어요`, body: '지금 같이 한 판 어때요? 친구 탭에서 바로 도전하거나 옆자리에 앉을 수 있어요.', tag: `friend-${user.id}`, url: './?rank=friends' }
    });
  }
  return out;
}

// The app's poll says "I'm here". On a new visit, works out whether friends should hear about it.
// Returns { idleSince } when a write is needed, or null.
export function arrivalDue(state, user, now = Date.now()) {
  if (!user || user.guest) return null;
  if (!notePresence(user.id, now)) return null;
  const idleSince = lastActive(state, user);
  if (now - idleSince < ARRIVAL_IDLE_MS) return null;
  return { idleSince };
}

// The write for a new visit after a long gap: remember the visit (so a restarted server doesn't
// announce it twice) and plan the friends' pushes.
export function noteArrival(state, user, { idleSince, now = Date.now() }) {
  markSeen(user, now);
  return planFriendArrival(state, user, { idleSince, now });
}
