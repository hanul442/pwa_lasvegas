// Table hand signals, the way blackjack is played at a real table: tap the felt for a card,
// wave a hand flat across it to stand. The buttons stay; this is another way in. Only bare felt
// listens, so tapping a chip, a betting spot or a button does what it always did.
import { animate, el } from './fx.js';
import { settings } from './settings.js';

const TIP_KEY = 'vegas:gesture-tip';
const IGNORE = 'button,a,input,textarea,select,[data-zone],.chip,.table-moved,.toast,.dn-offer,[role="dialog"]';

function mark(x, y) {
  const ring = el('i', 'gesture-mark');
  Object.assign(ring.style, { left: `${x}px`, top: `${y}px` });
  document.body.append(ring);
  animate(ring, [{ opacity: 0.9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 420, easing: 'ease-out' }).then(() => ring.remove());
}

function trail(x0, y0, x1, y1) {
  const line = el('i', 'gesture-trail');
  const len = Math.hypot(x1 - x0, y1 - y0);
  Object.assign(line.style, { left: `${x0}px`, top: `${y0}px`, width: `${len}px`, rotate: `${Math.atan2(y1 - y0, x1 - x0)}rad` });
  document.body.append(line);
  animate(line, [{ opacity: 0.9, transform: 'scaleX(.2)' }, { opacity: 0.6, transform: 'scaleX(1)', offset: 0.5 }, { opacity: 0, transform: 'scaleX(1)' }], { duration: 420, easing: 'ease-out' }).then(() => line.remove());
}

// live(): whether a signal would mean anything right now (my turn, nothing moving).
// onTap / onWave: what the signal does. Returns a function that removes the listeners.
// tip(text): shows the one-line reminder (the table's toast).
export function feltGestures(felt, { live, onTap, onWave, tip }) {
  let start = null;
  const on = () => settings.get('gestures') !== false;
  const down = e => {
    if (!on() || !e.isPrimary || e.button > 0 || e.target.closest(IGNORE) || !live()) { start = null; return; }
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, maxOff: 0 };
  };
  const move = e => {
    if (!start || e.pointerId !== start.id) return;
    start.maxOff = Math.max(start.maxOff, Math.abs(e.clientY - start.y));
  };
  const up = e => {
    const s = start; start = null;
    if (!s || e.pointerId !== s.id || !live()) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y, dt = e.timeStamp - s.t;
    // A wave: quick, mostly sideways, and long enough not to be a wobbly tap.
    if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.8 && s.maxOff < 50 && dt < 800) {
      trail(s.x, s.y, e.clientX, e.clientY);
      onWave();
      return;
    }
    if (Math.hypot(dx, dy) < 12 && dt < 320) { mark(e.clientX, e.clientY); onTap(); }
  };
  const cancel = () => { start = null; };
  felt.addEventListener('pointerdown', down);
  felt.addEventListener('pointermove', move);
  felt.addEventListener('pointerup', up);
  felt.addEventListener('pointercancel', cancel);

  // The first few turns, a quiet line says the felt listens.
  const showTip = () => {
    if (!on() || !tip) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem(TIP_KEY) || 0); } catch {}
    if (seen >= 3) return;
    try { localStorage.setItem(TIP_KEY, String(seen + 1)); } catch {}
    tip('펠트를 톡 치면 히트, 옆으로 쓸면 스탠드');
  };

  return {
    // Bare felt takes horizontal swipes during my turn instead of handing them to the browser.
    sync() { felt.classList.toggle('is-gesture-live', on() && Boolean(live())); },
    showTip,
    destroy() {
      felt.removeEventListener('pointerdown', down);
      felt.removeEventListener('pointermove', move);
      felt.removeEventListener('pointerup', up);
      felt.removeEventListener('pointercancel', cancel);
    }
  };
}
