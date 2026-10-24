// Table talk in friends' rooms: short lines and emoji everyone at the table sees.
// A room keeps only its last few lines, so the shared state stays small.
export const CHAT_KEEP = 20;
export const CHAT_MAX = 40; // characters per line
export const CHAT_GAP_MS = 1200; // one line per person this often, so nobody floods the felt
export const CHAT_PRESETS = ['따당!', '죽어라~', '나이스!', '굿 게임', 'ㅋㅋㅋ', '올인 각?', '빨리 좀!', '운 좋네', '한 판 더!', '아깝다'];
export const CHAT_EMOJI = ['👍', '😂', '😱', '🔥', '😭', '😎', '🙏', '💸'];

// Control characters, zero-width marks and direction overrides become plain spaces.
const hidden = c => c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e);
const clean = text => [...String(text ?? '')].map(ch => (hidden(ch.codePointAt(0)) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();

// Adds one line from a person sitting in the room. Throws CHAT_EMPTY or CHAT_TOO_FAST.
export function postChat(room, user, { text, emoji } = {}, now = Date.now()) {
  const line = emoji != null ? (CHAT_EMOJI.includes(String(emoji)) ? String(emoji) : '') : [...clean(text)].slice(0, CHAT_MAX).join('');
  if (!line) throw new Error('CHAT_EMPTY');
  const chat = Array.isArray(room.chat) ? room.chat : (room.chat = []);
  const last = chat.findLast(c => c.userId === user.id);
  if (last && now - last.at < CHAT_GAP_MS) throw new Error('CHAT_TOO_FAST');
  const n = (chat.at(-1)?.n ?? 0) + 1;
  chat.push({ n, userId: user.id, nickname: user.nickname, text: line, emoji: emoji != null, at: now });
  if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
  return chat.at(-1);
}

// What every view carries: the recent lines, numbered so a screen shows each one once.
export const chatView = (room, userId) => (Array.isArray(room.chat) ? room.chat : []).map(c => ({ n: c.n, nickname: c.nickname, text: c.text, emoji: c.emoji, mine: c.userId === userId, at: c.at }));
