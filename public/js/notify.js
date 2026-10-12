// Push notifications on this device. Until the player allows them, a sheet keeps asking:
// every time the app opens, every time they come back to the lobby, and every few minutes
// while they browse the menus (never over a table mid-game). Once allowed, the device's
// subscription is kept on the server so the hourly reminders can reach it.
import { api } from './api.js';
import { el } from './fx.js';
import { isIOS, standalone, openInstallGuide } from './install.js';

const NAG_EVERY = 3 * 60 * 1000;
const NAG_GAP = 45 * 1000; // never twice in a row right after closing it
const COUNT_KEY = 'vegas:push-nags';

const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// 'on' | 'ask' | 'blocked' | 'install' (iPhone Safari: only a home-screen app gets push) | 'none'
export function pushState() {
  if (!canPush()) return isIOS() && !standalone() ? 'install' : 'none';
  if (Notification.permission === 'granted') return 'on';
  return Notification.permission === 'denied' ? 'blocked' : 'ask';
}

function b64urlToBytes(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function bytesToB64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Makes sure this browser is subscribed with the server's current key and that the server knows it.
// The service worker can be missing (a failed install) and then `ready` never settles; register
// it again and give up after a while instead of leaving the button spinning.
async function workerReady() {
  if (!(await navigator.serviceWorker.getRegistration().catch(() => null))) await navigator.serviceWorker.register('sw.js').catch(() => {});
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('SW_TIMEOUT')), 10_000))]);
}

async function syncDevice() {
  const reg = await workerReady();
  const { publicKey } = await api.pushKey();
  let sub = await reg.pushManager.getSubscription();
  const key = sub?.options?.applicationServerKey;
  if (sub && key && bytesToB64url(key) !== publicKey) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
  await api.pushSubscribe(sub.toJSON());
  return sub;
}

// The tap on "알림 켜기". Browsers only show their permission prompt from a tap like this.
// Returns {ok} or {ok: false, reason} so the sheet can say what went wrong instead of nothing.
export async function enablePush({ test = true } = {}) {
  // Older browsers only take a callback.
  const result = await new Promise(resolve => { const p = Notification.requestPermission(resolve); if (p?.then) p.then(resolve, () => resolve('default')); });
  if (result !== 'granted') return { ok: false, reason: result === 'denied' ? 'denied' : 'dismissed' };
  return checkDevice({ test });
}

// Registers this device and sends the "알림이 켜졌어요" test; reports the first step that failed.
export async function checkDevice({ test = true } = {}) {
  try { await syncDevice(); } catch (e) { return { ok: false, reason: 'device', detail: (typeof e?.code === 'string' && e.code) || e?.name || e?.message || '' }; }
  synced = true;
  if (!test) return { ok: true };
  try {
    const out = await api.pushTest();
    return out.sent > 0 ? { ok: true } : { ok: false, reason: 'delivery', detail: (out.statuses || []).join(',') };
  } catch (e) { return { ok: false, reason: 'delivery', detail: e?.code || '' }; }
}

const FAILURES = {
  dismissed: '알림 허용 창이 닫혔어요. 한 번 더 눌러서 허용을 골라 주세요.',
  device: '이 휴대폰을 알림 받을 기기로 등록하지 못했어요. 앱을 완전히 닫았다가 다시 열고 한 번 더 눌러 주세요.',
  delivery: '등록은 됐는데 테스트 알림이 나가지 못했어요. 잠시 뒤 한 번 더 눌러 주세요.'
};
export const failureText = r => `${FAILURES[r.reason] || FAILURES.device}${r.detail ? ` (${r.detail})` : ''}`;

// On sign-out, this device stops getting that player's reminders.
export async function forgetDevice() {
  try {
    if (pushState() !== 'on') return;
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await api.pushUnsubscribe(sub.endpoint);
  } catch {}
}

// ---------- the sheet that keeps asking ----------
const ASKS = [
  { title: '알림 켜고 보너스 챙겨 가세요', note: '출석 보너스, 무료 칩 충전, 미션 보상이 생기면 바로 알려 드려요.' },
  { title: '알림, 아직 꺼져 있어요', note: '켜 두면 출석 연속 기록이 끊기기 전에 귀띔해 드려요.' },
  { title: '진짜 안 켜실 거예요?', note: '무료 칩이 충전돼도 모르고 지나가요. 딜러가 서운해해요.' },
  { title: '한 번만 눌러 주세요', note: '알림 켜기 한 번이면 이 창은 다시 안 떠요. 약속해요.' }
];
const LATER = ['나중에', '그래도 나중에', '다음에 진짜로', '조금만 더 생각해 볼게요'];

let sheet = null, lastClosed = 0, timer = null, synced = false, isLobby = () => true;

const nagCount = () => { try { return Number(localStorage.getItem(COUNT_KEY)) || 0; } catch { return 0; } };
const bumpNag = () => { try { localStorage.setItem(COUNT_KEY, String(nagCount() + 1)); } catch {} };

function content(state) {
  if (state === 'blocked') {
    const android = /Android/.test(navigator.userAgent);
    return {
      eyebrow: '알림 차단됨', title: '알림이 막혀 있어요',
      note: android
        ? '주소창 옆 ⓘ 또는 자물쇠 → 권한 → 알림을 허용으로 바꿔 주세요. 홈 화면 앱이면 휴대폰 설정 → 애플리케이션 → VEGAS → 알림이에요.'
        : isIOS() ? '설정 앱 → 알림 → VEGAS에서 알림 허용을 켜 주세요.' : '주소창 왼쪽 자물쇠(ⓘ) → 사이트 설정 → 알림을 허용으로 바꿔 주세요.',
      action: '바꿨어요'
    };
  }
  if (state === 'install') {
    return { eyebrow: '알림', title: '아이폰은 홈 화면에 추가해야 알림이 와요', note: '앱스토어 없이 10초면 끝나요. 홈 화면에 추가한 VEGAS로 열면 알림 켜기 버튼이 나와요.', action: '추가하는 법 보기', later: '나중에' };
  }
  const n = nagCount();
  return { eyebrow: '알림', ...ASKS[Math.min(n, ASKS.length - 1)], action: '알림 켜기', later: LATER[Math.min(n, LATER.length - 1)] };
}

function close() {
  if (!sheet) return;
  const { scrim, node, onKey } = sheet;
  sheet = null;
  lastClosed = Date.now();
  scrim.classList.remove('is-open'); node.classList.remove('is-open');
  removeEventListener('keydown', onKey, true);
  setTimeout(() => { scrim.remove(); node.remove(); }, 320);
}

function open(state) {
  const c = content(state);
  const scrim = el('div', 'lounge-scrim');
  const node = el('section', 'lounge-sheet push-ask');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-labelledby', 'push-ask-title');
  node.innerHTML = `<p class="lounge-eyebrow">${c.eyebrow}</p><h2 id="push-ask-title">${c.title}</h2><p class="lounge-note">${c.note}</p>`;
  if (state === 'ask') {
    const list = el('ul', 'push-perks');
    list.innerHTML = '<li><b>출석</b><span>아침에 오늘 보너스를 알려 드려요</span></li><li><b>무료 칩</b><span>지갑이 비면 충전 소식을 보내요</span></li><li><b>미션</b><span>깬 미션 보상을 잊지 않게 챙겨요</span></li>';
    node.append(list);
  }
  const actions = el('div', 'lounge-sheet-actions');
  const later = el('button', 'pill-button', c.later || (c.action ? '나중에' : '알겠어요'));
  later.type = 'button';
  actions.append(later);
  if (c.action) {
    const go = el('button', 'pill-button pill-button--solid', c.action);
    go.type = 'button';
    actions.append(go);
    go.addEventListener('click', async () => {
      go.disabled = true;
      if (state === 'install') { bumpNag(); close(); setTimeout(() => openInstallGuide(), 340); return; }
      const note = node.querySelector('.lounge-note');
      if (state === 'blocked' && pushState() !== 'on') { go.disabled = false; note.textContent = '아직 막혀 있어요. 허용으로 바꾼 다음 다시 눌러 주세요.'; return; }
      go.textContent = '켜는 중…';
      const r = state === 'blocked' ? await checkDevice() : await enablePush();
      if (r.ok) { close(); return; }
      go.disabled = false;
      go.textContent = c.action;
      if (r.reason === 'denied') { close(); setTimeout(() => maybeAsk({ force: true }), 400); }
      else note.textContent = failureText(r);
    });
  }
  node.append(actions);
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); bumpNag(); close(); } };
  later.addEventListener('click', () => { bumpNag(); close(); });
  scrim.addEventListener('click', () => { bumpNag(); close(); });
  addEventListener('keydown', onKey, true);
  document.body.append(scrim, node);
  sheet = { scrim, node, onKey };
  requestAnimationFrame(() => { scrim.classList.add('is-open'); node.classList.add('is-open'); node.querySelector('.pill-button--solid, .pill-button')?.focus({ preventScroll: true }); });
}

// Shows the sheet if notifications are off and nothing else is on screen. The daily-bonus
// sheet goes first; we try again shortly after it closes.
export function maybeAsk({ force = false } = {}) {
  const state = pushState();
  if (state === 'on') { if (!synced) syncDevice().then(() => { synced = true; }, () => {}); return; }
  if (state === 'none' || sheet || document.hidden || !isLobby()) return;
  if (!force && Date.now() - lastClosed < NAG_GAP) return;
  if (document.querySelector('.lounge-sheet, .auth-gate, .bigwin, dialog[open]')) { setTimeout(() => maybeAsk(), 4000); return; }
  open(state);
}

// Call once after the player is signed in. `inMenus` says whether the player is off the tables.
export function startNotifications(inMenus) {
  if (inMenus) isLobby = inMenus;
  synced = false;
  if (pushState() === 'on') { syncDevice().then(() => { synced = true; }, () => {}); return; }
  setTimeout(() => maybeAsk({ force: true }), 1500);
  clearInterval(timer);
  timer = setInterval(() => maybeAsk(), NAG_EVERY);
}

// Coming back to the app after a while counts as opening it again.
document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) setTimeout(() => maybeAsk(), 800); });

// The row in 설정 → 알림.
export function notifyRow(row) {
  const button = el('button', 'pill-button');
  button.type = 'button';
  const notes = {
    on: '출석 보너스, 무료 칩, 미션 보상, 오랜만에 들를 때를 알려 드려요',
    ask: '켜 두면 출석 보너스와 무료 칩을 놓치지 않아요',
    blocked: '브라우저나 휴대폰 설정에서 이 사이트 알림이 막혀 있어요',
    install: '아이폰은 홈 화면에 추가한 VEGAS에서만 알림을 받을 수 있어요',
    none: '이 브라우저는 알림을 지원하지 않아요'
  };
  const state = pushState();
  const r = row('푸시 알림', notes[state], button);
  // A failure stays on the row until the next paint, so the player can read it.
  const setNote = text => { r.querySelector('.set-note').textContent = text; };
  const paint = () => {
    const s = pushState();
    r.querySelector('.set-note').textContent = notes[s];
    button.textContent = { on: '테스트 알림', ask: '알림 켜기', blocked: '여는 방법', install: '추가하는 법', none: '지원 안 함' }[s];
    button.disabled = s === 'none';
  };
  paint();
  button.addEventListener('click', async () => {
    const s = pushState();
    if (s === 'on') {
      button.disabled = true;
      const res = await checkDevice();
      button.textContent = res.ok ? '보냈어요' : '다시 눌러 주세요';
      if (!res.ok) setNote(failureText(res));
      setTimeout(() => { button.disabled = false; paint(); }, res.ok ? 1600 : 6000);
    } else if (s === 'ask') {
      button.disabled = true;
      const res = await enablePush();
      button.disabled = false;
      paint();
      if (!res.ok && res.reason !== 'denied') setNote(failureText(res));
    }
    else if (s === 'install') openInstallGuide(button);
    else maybeAsk({ force: true });
  });
  return r;
}
