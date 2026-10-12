// 묻고 더블로 가: a 나가리 in 고스톱 or 맞고 carries the hand into the next one at twice the
// points, ×4 and ×8 on further 나가리. Playing alone the person chooses to carry it or start
// fresh; in a friends' room it always carries (lib/table-room.mjs).
import { el, animate, sound, haptic, ms, wait } from './fx.js';

// The stamp across the blanket as a doubled hand is dealt. `times` may instead be a short
// line (섯다's 재경기 keeps the pot rather than doubling the points).
export async function doubleStamp(host, times) {
  const node = el('div', 'dd-stamp');
  node.setAttribute('role', 'status');
  node.innerHTML = `<span class="dd-stamp-line">묻고 더블로 가</span><b class="dd-stamp-times${typeof times === 'number' ? '' : ' dd-stamp-times--text'}">${typeof times === 'number' ? `×${times}` : times}</b>`;
  host.append(node);
  sound.chips?.(4);
  haptic([20, 40, 30]);
  await animate(node, [
    { opacity: 0, transform: 'translate(-50%,-50%) scale(1.6) rotate(-6deg)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(.96) rotate(-4deg)', offset: 0.18 },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(-4deg)', offset: 0.82 },
    { opacity: 0, transform: 'translate(-50%,-50%) scale(1) rotate(-4deg)' }
  ], { duration: ms(1500), fill: 'none' });
  node.remove();
  await wait(80);
}

// A small tag that stays on the board while the hand is doubled.
export function doubleBadge(board) {
  const b = el('span', 'dd-badge');
  b.hidden = true;
  board.append(b);
  return { set(times) { b.hidden = !(times > 1); b.textContent = `묻고 더블 ×${times}`; } };
}

// The idle actions after a 나가리: carry it doubled (primary) or start a plain hand.
export function doubleActions(t, times, go) {
  const ready = async () => {
    if (!t.total && t.lastBet) await t.rebet();
    if (!t.betReady) { t.reject('점당 칩을 먼저 올려 주세요'); return false; }
    return true;
  };
  return [
    { label: '그냥 새 판', ghost: true, onClick: async () => { if (await ready()) await go(false); } },
    { label: `묻고 더블로 가 ×${times}`, key: '↵', primary: true, onClick: async () => { if (await ready()) await go(true); } }
  ];
}
