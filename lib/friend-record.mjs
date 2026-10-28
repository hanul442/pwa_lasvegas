// 친구 전적: what happened when I played with friends in a room (lib/table-room.mjs, Hold'em rooms
// and tournaments). Each person keeps their own record on their user, so it survives the monthly
// reset like the 족보 도감 does.
//   recent: the last sittings, newest first. Hands at the same room in a row are one sitting.
//   vs:     per friend, the hands we played together and who came out ahead in each.
// Only people count: AI seats are the house and never show up here.

export const RECENT_MAX = 20;
export const VS_MAX = 30;
// A gap longer than this at the same room starts a new sitting in the recent list.
const SITTING_GAP_MS = 30 * 60_000;

function recordOf(user) {
  if (!user.friendRecord || typeof user.friendRecord !== 'object') user.friendRecord = { recent: [], vs: {} };
  const r = user.friendRecord;
  if (!Array.isArray(r.recent)) r.recent = [];
  if (!r.vs || typeof r.vs !== 'object') r.vs = {};
  return r;
}

const iso = now => new Date(now).toISOString();

// One finished hand (or a Hold'em stay, or a tournament) for one player.
//   game: ledger game name ('Seotda', 'Holdem' …); room: room code
//   net: my result in chips; others: [{ id, nickname, net?, place? }] (people only)
//   place: my tournament place, when this was a tournament
//   compare: false when results can't be set side by side (a Hold'em cash stay ends one at a time)
export function noteFriendHand(user, { game, room, net, others, place = null, tourney = false, compare = true }, now = Date.now()) {
  if (!user || user.guest || !Array.isArray(others)) return;
  const friends = others.filter(o => o && o.id && o.id !== user.id);
  if (!friends.length) return;
  const rec = recordOf(user);
  const at = iso(now);
  const won = tourney ? place === 1 : net > 0;
  const last = rec.recent[0];
  const same = last && !tourney && !last.tourney && last.room === room && last.game === game && now - Date.parse(last.at) <= SITTING_GAP_MS;
  if (same) {
    last.at = at;
    last.hands += 1;
    last.net += net;
    if (net > 0) last.wins += 1; else if (net < 0) last.losses += 1;
    for (const f of friends) if (!last.with.some(w => w.id === f.id)) last.with.push({ id: f.id, nickname: f.nickname });
  } else {
    rec.recent.unshift({
      at, startedAt: at, game, room, hands: 1, net,
      wins: net > 0 ? 1 : 0, losses: net < 0 ? 1 : 0,
      tourney, place: tourney ? place : null, of: tourney ? friends.length + 1 : null,
      with: friends.map(f => ({ id: f.id, nickname: f.nickname }))
    });
    if (rec.recent.length > RECENT_MAX) rec.recent.length = RECENT_MAX;
  }
  for (const f of friends) {
    const v = rec.vs[f.id] || (rec.vs[f.id] = { nickname: f.nickname, hands: 0, won: 0, lost: 0, tied: 0, net: 0, last: at, lastGame: game });
    v.nickname = f.nickname;
    v.hands += 1;
    v.net += net;
    v.last = at;
    v.lastGame = game;
    if (!compare) continue;
    // Who came out ahead between the two of us: the better place, or the better result.
    const mine = tourney ? -(place ?? Infinity) : net;
    const theirs = tourney ? -(f.place ?? Infinity) : f.net;
    if (!Number.isFinite(mine) || !Number.isFinite(theirs)) continue;
    if (mine > theirs) v.won += 1; else if (mine < theirs) v.lost += 1; else v.tied += 1;
  }
  // Keep the friends played with most recently.
  const ids = Object.keys(rec.vs);
  if (ids.length > VS_MAX) ids.sort((a, b) => rec.vs[b].last.localeCompare(rec.vs[a].last)).slice(VS_MAX).forEach(id => delete rec.vs[id]);
}

// Everyone at a finished room hand: `people` are [{ id, nickname, net }].
export function noteFriendTable(state, { game, room, people }, now = Date.now()) {
  if (people.length < 2) return;
  for (const p of people) {
    const others = people.filter(o => o.id !== p.id);
    noteFriendHand(state.users[p.id], { game, room, net: p.net, others }, now);
  }
}

// What the ranking tab shows: friends by hands together, and the sittings newest first.
export function friendRecordView(state, user) {
  const rec = user?.friendRecord;
  if (!rec || typeof rec !== 'object') return { recent: [], vs: [] };
  const name = (id, fallback) => state.users?.[id]?.nickname || fallback;
  const vs = Object.entries(rec.vs || {})
    .map(([id, v]) => ({ id, nickname: name(id, v.nickname), hands: v.hands, won: v.won, lost: v.lost, tied: v.tied || 0, net: v.net, last: v.last, lastGame: v.lastGame }))
    .sort((a, b) => b.last.localeCompare(a.last))
    .slice(0, 12);
  const recent = (rec.recent || []).slice(0, 10).map(r => ({ ...r, with: r.with.map(w => ({ id: w.id, nickname: name(w.id, w.nickname) })) }));
  return { recent, vs };
}
