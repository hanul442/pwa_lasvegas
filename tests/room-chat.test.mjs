import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { postChat, chatView, CHAT_KEEP, CHAT_MAX, CHAT_GAP_MS } from '../lib/room-chat.mjs';

function memoryStore() {
  let state = defaultState();
  for (const uid of ['hanseo', 'min', 'june']) state.users[uid].account.available = Math.min(state.users[uid].account.available, 900_000_000);
  let queue = Promise.resolve();
  return {
    peek: () => state,
    load: async () => structuredClone(state),
    mutate(fn) {
      const task = queue.then(async () => { const next = structuredClone(state); const out = await fn(next); state = next; return out; });
      queue = task.catch(() => {});
      return task;
    }
  };
}
let n = 0;
const call = (store, player, method, path, body, key = `k-chat-${++n}`) =>
  handleApi({ method, header: h => (h === 'x-idempotency-key' ? key : h === 'x-player-id' ? player : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production' });

test('a room keeps its last lines, cleans them, and paces each person', () => {
  const room = {};
  const a = { id: 'a', nickname: 'A' }, b = { id: 'b', nickname: 'B' };
  let now = 1_000_000;
  postChat(room, a, { text: '  따당!\n​ ' }, now);
  assert.equal(room.chat[0].text, '따당!');
  assert.throws(() => postChat(room, a, { text: '또' }, now + 10), /CHAT_TOO_FAST/);
  postChat(room, b, { emoji: '🔥' }, now + 10); // someone else may talk at once
  assert.throws(() => postChat(room, b, { emoji: '<b>' }, now + CHAT_GAP_MS * 2), /CHAT_EMPTY/);
  assert.throws(() => postChat(room, b, { text: '   ' }, now + CHAT_GAP_MS * 2), /CHAT_EMPTY/);
  postChat(room, a, { text: 'ㅋ'.repeat(99) }, now += CHAT_GAP_MS);
  assert.equal([...room.chat.at(-1).text].length, CHAT_MAX);
  for (let k = 0; k < CHAT_KEEP + 5; k++) postChat(room, a, { text: `줄 ${k}` }, now += CHAT_GAP_MS);
  assert.equal(room.chat.length, CHAT_KEEP);
  const view = chatView(room, 'a');
  assert.ok(view.every((c, i) => i === 0 || c.n === view[i - 1].n + 1), 'lines are numbered in order');
  assert.equal(view.at(-1).mine, true);
  assert.equal('userId' in view[0], false, 'views never carry account ids');
});

test('friends talk at a 섯다 room and a Hold\'em room over the API', async () => {
  const store = memoryStore();
  const made = await call(store, 'hanseo', 'POST', '/api/rooms', { game: 'seotda', stake: 50_000_000, floor: 'high-limit', size: 3 });
  const code = made.data.room.code;
  await call(store, 'min', 'POST', '/api/rooms/join', { code });
  const said = await call(store, 'min', 'POST', '/api/rooms/chat', { code, text: '죽어라~' });
  assert.equal(said.status, 200, JSON.stringify(said.data));
  assert.equal(said.data.room.chat.at(-1).text, '죽어라~');
  const seen = await call(store, 'hanseo', 'GET', `/api/room?code=${code}`);
  assert.equal(seen.data.room.chat.at(-1).nickname, store.peek().users.min.nickname);
  assert.equal(seen.data.room.chat.at(-1).mine, false);
  const fast = await call(store, 'min', 'POST', '/api/rooms/chat', { code, text: '또' });
  assert.equal(fast.status, 429);
  const outsider = await call(store, 'june', 'POST', '/api/rooms/chat', { code, text: '안녕' });
  assert.equal(outsider.status, 409);
  // Talking doesn't disturb the replay of the last game command.
  assert.equal(store.peek().tableRoomCmds.min.code, code);

  const hm = await call(store, 'june', 'POST', '/api/holdem/rooms', { buyIn: 50_000_000, floor: 'high-limit', size: 3 });
  const hcode = hm.data.room.code;
  const h = await call(store, 'june', 'POST', '/api/holdem/rooms/chat', { code: hcode, emoji: '😎' });
  assert.equal(h.status, 200, JSON.stringify(h.data));
  assert.equal(h.data.room.chat.at(-1).emoji, true);
});
