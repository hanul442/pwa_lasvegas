// Unfinished rounds holding this player's chips, for the lobby's "이어하기" notice. Each entry
// names the client screen that resumes it (public/app.js GAMES id) and the table (floor slug).
import { tableRoomOf } from './table-room.mjs';
import { roomOfUser } from './holdem-room.mjs';

// Server game name -> lobby screen id; event rounds open their event table instead.
const SCREEN = { Blackjack: 'blackjack', Matgo: 'matgo', Gostop: 'gostop', Seotda: 'seotda', "Hold'em": 'poker', 'Seven Poker': 'sevenpoker' };
const ROOM_SCREEN = { blackjack: 'blackjack', matgo: 'matgo', gostop: 'gostop', seotda: 'seotda', baccarat: 'baccarat' };

export function openRoundsView(state, user) {
  const out = [];
  for (const r of state.rounds || []) {
    if (!r || r.userId !== user.id || r.status === 'SETTLED' || !SCREEN[r.game]) continue;
    const event = r.event || r.royale?.event || null;
    out.push({
      id: r.id,
      game: event || SCREEN[r.game],
      event,
      floor: r.venue || r.floor || null,
      locked: Number(r.deposit ?? r.buyIn ?? r.stake ?? 0) || 0,
      startedAt: r.createdAt || null
    });
  }
  // A friends' room with a hand under way holds a seat (and its deposit) too.
  const room = tableRoomOf(state, user.id);
  if (room && ROOM_SCREEN[room.game] && room.round?.status === 'PLAYING') out.push({ id: room.id, game: ROOM_SCREEN[room.game], event: null, floor: room.floor || null, locked: 0, room: room.code });
  // A friends' hand this player got up from still holds their deposit until it ends (the table
  // plays their seat out). It can't be resumed; the bank only says where the chips are.
  for (const r of Array.isArray(state.tableRooms) ? state.tableRooms : []) {
    if (r === room || r.status !== 'OPEN' || !ROOM_SCREEN[r.game] || r.round?.status !== 'PLAYING') continue;
    const locked = r.round.locked?.[user.id];
    if (locked > 0 && r.round.seats.some(s => s.userId === user.id)) out.push({ id: r.id, game: ROOM_SCREEN[r.game], event: null, floor: r.floor || null, locked, room: r.code, left: true });
  }
  const holdem = roomOfUser(state, user.id);
  // A nightly tournament seat whose place is already paid holds nothing.
  const paid = holdem?.nightly && state.nightly?.entries?.[user.id]?.settled;
  if (holdem && holdem.started && !paid) out.push({ id: holdem.id, game: 'poker', event: null, floor: holdem.floor || null, locked: Number(holdem.buyIn || 0), room: holdem.code });
  return out;
}
