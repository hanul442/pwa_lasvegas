// A friends' room said I'm still sitting at another one (leaving a table screen keeps the seat).
// Say which room that is and offer the two ways out: go back to it, or get up from it and carry
// on here.
import { api, errorMessage } from '../api.js';
import { el, sound } from '../fx.js';
import { gameName } from '../names.js';

const SCREEN = { holdem: 'poker' }; // the lobby's id for a room game, where it differs

// t: the table; e: the ApiError; retry(): what the person was trying to do.
// goHere(code): set when that room is this same game, so going back needs no new screen.
// Resolves true when it took the error over.
export function seatedElsewhere(t, e, retry, goHere = null) {
  const where = e?.code === 'ALREADY_IN_ROOM' && e.where;
  if (!where?.code) return false;
  t.felt.querySelector('.rm-elsewhere')?.remove();
  const name = (where.game && gameName(where.game)) || '다른 게임';
  const box = el('div', 'pk-lobby rm-elsewhere');
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'rm-elsewhere-title');
  box.innerHTML = `
    <header class="pk-lobby-head"><h2 id="rm-elsewhere-title">이미 다른 방에 앉아 있어요</h2><button type="button" class="pk-lobby-close" data-close aria-label="닫기">×</button></header>
    <section class="pk-lobby-block">
      <p class="pk-lobby-note"></p>
      <button type="button" class="pk-lobby-primary" data-go></button>
      <button type="button" class="pk-lobby-secondary" data-leave>그 방에서 나오고 여기서 하기</button>
    </section>`;
  box.querySelector('p').textContent = `${name} 친구 방 ${where.code}에 자리가 남아 있어요. 테이블 화면을 나가도 방에서 일어나기 전까지는 자리가 그대로예요. 한 번에 한 방에만 앉을 수 있어요.`;
  box.querySelector('[data-go]').textContent = `${name} 방으로 돌아가기`;
  const close = () => box.remove();
  box.querySelector('[data-close]').addEventListener('click', close);
  box.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
  box.querySelector('[data-go]').addEventListener('click', () => {
    close();
    if (goHere) t.run(() => goHere(where.code));
    else dispatchEvent(new CustomEvent('vegas:open-table', { detail: { game: SCREEN[where.game] || where.game, tier: where.tier } }));
  });
  box.querySelector('[data-leave]').addEventListener('click', () => t.run(async () => {
    try { await (where.game === 'holdem' ? api.holdemRoomLeave(where.code) : api.roomLeave(where.code)); }
    catch (err) { if (err.code !== 'NOT_IN_ROOM' && err.code !== 'ROOM_NOT_FOUND') { t.toast(errorMessage(err)); return; } }
    close();
    sound.tick();
    t.toast(`${name} 방에서 나왔어요`);
    await retry();
  }));
  t.felt.append(box);
  box.querySelector('[data-go]').focus({ preventScroll: true });
  return true;
}
