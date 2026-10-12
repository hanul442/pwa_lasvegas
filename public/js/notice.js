// App-wide notices in the lounge style, in place of native browser popups: a toast that can carry
// one action ("다시 시도"), and a slim banner while the connection is down.
import { errorMessage } from './api.js';
import { el } from './fx.js';

let toastNode = null, toastTimer = null;

// text: what happened; action/onAction: one optional button, e.g. a retry.
export function toast(text, { action = '', onAction = null, duration = action ? 7000 : 3200 } = {}) {
  toastNode?.remove();
  clearTimeout(toastTimer);
  const node = el('div', 'app-toast');
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.append(el('span', 'app-toast-text', text));
  const hide = () => {
    clearTimeout(toastTimer);
    node.classList.remove('is-shown');
    setTimeout(() => node.remove(), 300);
    if (toastNode === node) toastNode = null;
  };
  if (action && onAction) {
    const b = el('button', 'app-toast-action', action);
    b.type = 'button';
    b.addEventListener('click', () => { hide(); onAction(); });
    node.append(b);
  }
  document.body.append(node);
  toastNode = node;
  requestAnimationFrame(() => node.classList.add('is-shown'));
  toastTimer = setTimeout(hide, duration);
  return hide;
}

// A failed request. Only a dropped connection offers 다시 시도, and only where the caller passes a
// retry that is safe to repeat (a claim the server pays once, a round sent under the same key).
export function errorToast(err, retry = null) {
  const network = err?.code === 'NETWORK';
  return toast(errorMessage(err), network && retry ? { action: '다시 시도', onAction: retry } : {});
}

// ---------- connection banner ----------
// Shown while the browser is offline or the server can't be reached (api.js reports both);
// when the connection is back it says so for a moment and calls onBack, e.g. to reload state.
let banner = null, down = false, backTimer = null;
function paint(text, state) {
  if (!banner) {
    banner = el('div', 'net-banner');
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    document.body.append(banner);
  }
  banner.textContent = text;
  banner.dataset.state = state;
  banner.hidden = false;
}

export function watchConnection(onBack = () => {}) {
  const goDown = text => {
    clearTimeout(backTimer);
    down = true;
    paint(text, 'down');
  };
  const goUp = () => {
    if (!down) return;
    down = false;
    paint('다시 연결됐어요', 'up');
    clearTimeout(backTimer);
    backTimer = setTimeout(() => { if (banner && !down) banner.hidden = true; }, 2000);
    onBack();
  };
  addEventListener('offline', () => goDown('연결이 끊겼어요 · 다시 연결 중…'));
  addEventListener('online', goUp);
  addEventListener('vegas:network', e => {
    if (e.detail?.ok) goUp();
    else goDown(navigator.onLine === false ? '연결이 끊겼어요 · 다시 연결 중…' : '서버에 연결할 수 없어요 · 다시 연결 중…');
  });
  if (navigator.onLine === false) goDown('연결이 끊겼어요 · 다시 연결 중…');
  // While down, knock every few seconds: a server that comes back fires no browser event.
  setInterval(() => { if (down && navigator.onLine !== false) onBack(); }, 8000);
}
