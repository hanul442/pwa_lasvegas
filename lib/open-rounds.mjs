// Unfinished rounds holding this player's chips, for the lobby's "이어하기" notice. Each entry
// names the client screen that resumes it (public/app.js GAMES id) and the table (floor slug).
import { tableRoomOf } from './table-room.mjs';
import { roomOfUser } from './holdem-room.mjs';

// Server game name -> lobby screen id; event rounds open their event table instead.
const SCREEN = { Blackjack: 'blackjack', Matgo: 'matgo', Gostop: 'gostop', Seotda: 'seotda', "Hold'em": 'poker' };
const ROOM_SCREEN = { blackjack: 'blackjack', matgo: 'matgo', gostop: 'gostop', seotda: 'seotda' };

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
  const holdem = roomOfUser(state, user.id);
  if (holdem && holdem.started) out.push({ id: holdem.id, game: 'poker', event: null, floor: holdem.floor || null, locked: Number(holdem.buyIn || 0), room: holdem.code });
  return out;
}
