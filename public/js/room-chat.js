// Table talk in a friends' room: a 💬 button opens quick lines, emoji and a short text box, and
// every new line floats over the felt for a few seconds. Lines arrive with each room view.
import { el, sound } from './fx.js';
import { errorMessage } from './api.js';

const PRESETS = ['따당!', '죽어라~', '나이스!', '굿 게임', 'ㅋㅋㅋ', '올인 각?', '빨리 좀!', '운 좋네', '한 판 더!', '아깝다'];
const EMOJI = ['👍', '😂', '😱', '🔥', '😭', '😎', '🙏', '💸'];
const SHOW_MS = 4200;
const MAX_LEN = 40;

// send({ text } | { emoji }) posts a line and resolves with the room view it returns.
export function createRoomChat(t, { send, onView }) {
  let seen = null; // the last line number already on screen (null until the first view)
  let sending = false;

  const button = el('button', 'chat-open');
  button.type = 'button';
  button.hidden = true;
  button.setAttribute('aria-label', '채팅');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4z"/></svg>';

  const feed = el('div', 'chat-feed');
  feed.setAttribute('aria-live', 'polite');
  feed.hidden = true;

  const sheet = el('div', 'chat-sheet');
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', '채팅');
  sheet.innerHTML = `
    <div class="chat-emoji">${EMOJI.map(e => `<button type="button" data-emoji="${e}" aria-label="${e} 보내기">${e}</button>`).join('')}</div>
    <div class="chat-presets">${PRESETS.map(p => `<button type="button" data-text="${p}">${p}</button>`).join('')}</div>
    <form class="chat-form">
      <label class="sr-only" for="chat-input-${t.game}">채팅 입력</label>
      <input id="chat-input-${t.game}" maxlength="${MAX_LEN}" autocomplete="off" enterkeyhint="send" placeholder="한마디 (40자)">
      <button type="submit">보내기</button>
    </form>`;
  t.felt.append(feed, sheet);
  const input = sheet.querySelector('input');

  const setOpen = open => {
    sheet.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-active', open);
  };
  button.addEventListener('click', () => { setOpen(sheet.hidden); sound.tick(); });
  sheet.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); button.focus(); } });
  const outside = e => { if (!sheet.hidden && !sheet.contains(e.target) && !button.contains(e.target)) setOpen(false); };
  document.addEventListener('pointerdown', outside, true);

  async function post(payload) {
    if (sending) return;
    sending = true;
    try { const res = await send(payload); setOpen(false); if (res?.room) onView?.(res.room); }
    catch (e) { t.toast(e.code === 'CHAT_TOO_FAST' ? '조금 천천히 보내 주세요' : errorMessage(e)); }
    finally { sending = false; }
  }
  sheet.querySelectorAll('[data-emoji]').forEach(b => b.addEventListener('click', () => post({ emoji: b.dataset.emoji })));
  sheet.querySelectorAll('[data-text]').forEach(b => b.addEventListener('click', () => post({ text: b.dataset.text })));
  sheet.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    input.value = '';
    post({ text });
  });

  function bubble(line) {
    const b = el('div', `chat-line${line.emoji ? ' is-emoji' : ''}${line.mine ? ' is-mine' : ''}`);
    const who = el('b'), what = el('span');
    who.textContent = line.mine ? '나' : line.nickname; // people's words never become markup
    what.textContent = line.text;
    b.append(who, what);
    feed.append(b);
    while (feed.children.length > 4) feed.firstElementChild.remove();
    if (!line.mine) sound.tick();
    setTimeout(() => { b.classList.add('is-leaving'); setTimeout(() => b.remove(), 300); }, SHOW_MS);
  }

  return {
    // Every room view: float the lines this screen hasn't shown yet.
    sync(chat = []) {
      const last = chat.at(-1)?.n ?? 0;
      if (seen === null) { seen = last; return; } // joining: the talk before I sat down stays unsaid
      for (const line of chat) if (line.n > seen) bubble(line);
      seen = Math.max(seen, last);
    },
    show(on) {
      button.hidden = feed.hidden = !on;
      if (!on) { setOpen(false); feed.replaceChildren(); seen = null; }
    },
    button,
    destroy() { document.removeEventListener('pointerdown', outside, true); }
  };
}
