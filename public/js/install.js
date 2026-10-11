// "앱 설치": puts VEGAS on the home screen. Chrome/Edge/Samsung hand us a one-tap install
// prompt (beforeinstallprompt); iPhone Safari has none, so we show the share → 홈 화면에 추가
// steps instead. Once the app runs from the home screen the button disappears.
import { el } from './fx.js';

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isAndroid = () => /Android/.test(navigator.userAgent);

let deferred = null, installed = false, sheet = null;
const listeners = new Set();
const changed = () => listeners.forEach(fn => fn());

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; changed(); });
addEventListener('appinstalled', () => { deferred = null; installed = true; changed(); });

// 'installed' | 'prompt' (one tap) | 'ios' (share sheet steps) | 'android' (browser menu steps) | 'none'
export function installState() {
  if (installed || standalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  if (isAndroid()) return 'android';
  return 'none';
}

export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const SHARE_ICON = '<svg class="install-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1"/></svg>';
const PLUS_ICON = '<svg class="install-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
const MENU_ICON = '<svg class="install-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/></svg>';

function steps(state) {
  if (state === 'ios') {
    const chrome = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    return [
      [SHARE_ICON, '공유 버튼 누르기', chrome ? '주소창 오른쪽의 공유 버튼이에요' : 'Safari 아래쪽 가운데 버튼이에요'],
      [PLUS_ICON, '홈 화면에 추가', '목록을 조금 내리면 있어요. 오른쪽 위 추가를 누르면 끝이에요'],
      ['<img class="install-app" src="icon-192.png" alt="">', '홈 화면의 VEGAS로 열기', '전체 화면으로 열리고 알림도 받을 수 있어요']
    ];
  }
  return [
    [MENU_ICON, '브라우저 메뉴 열기', '주소창 오른쪽 ⋮ 버튼이에요'],
    [PLUS_ICON, '앱 설치 또는 홈 화면에 추가', '삼성 인터넷은 아래쪽 ≡ 메뉴 → 현재 페이지 추가 → 홈 화면이에요'],
    ['<img class="install-app" src="icon-192.png" alt="">', '홈 화면의 VEGAS로 열기', '전체 화면으로 열리고 알림도 받을 수 있어요']
  ];
}

function close() {
  if (!sheet) return;
  const { scrim, node, onKey, trigger } = sheet;
  sheet = null;
  scrim.classList.remove('is-open'); node.classList.remove('is-open');
  removeEventListener('keydown', onKey, true);
  setTimeout(() => { scrim.remove(); node.remove(); }, 320);
  trigger?.focus?.({ preventScroll: true });
}

// The how-to sheet for browsers without a one-tap prompt.
export function openInstallGuide(trigger = document.activeElement) {
  if (sheet) return;
  const state = installState();
  const scrim = el('div', 'lounge-scrim install-scrim');
  const node = el('section', 'lounge-sheet install-sheet');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-labelledby', 'install-title');
  node.innerHTML = state === 'installed'
    ? '<p class="lounge-eyebrow">앱 설치</p><h2 id="install-title">이미 설치돼 있어요</h2><p class="lounge-note">홈 화면의 VEGAS 아이콘으로 열면 돼요.</p>'
    : `<p class="lounge-eyebrow">앱 설치</p><h2 id="install-title">홈 화면에 VEGAS 추가하기</h2><p class="lounge-note">앱스토어 없이 10초면 끝나요. 아이콘을 누르면 바로 라운지로 들어와요.</p>
       <ol class="install-steps">${steps(state).map(([icon, title, note], i) => `<li><span class="install-num">${i + 1}</span>${icon}<span><b>${title}</b><small>${note}</small></span></li>`).join('')}</ol>`;
  const actions = el('div', 'lounge-sheet-actions');
  const ok = el('button', 'pill-button pill-button--solid', '알겠어요');
  ok.type = 'button';
  actions.append(ok);
  node.append(actions);
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  ok.addEventListener('click', close);
  scrim.addEventListener('click', close);
  addEventListener('keydown', onKey, true);
  document.body.append(scrim, node);
  sheet = { scrim, node, onKey, trigger };
  requestAnimationFrame(() => { scrim.classList.add('is-open'); node.classList.add('is-open'); ok.focus({ preventScroll: true }); });
}

// The tap on any "앱 설치" button: the browser's own install dialog when it offers one,
// otherwise the steps for this phone.
export async function install(trigger) {
  if (deferred) {
    const e = deferred;
    deferred = null;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') installed = true;
    } catch {}
    changed();
    return;
  }
  openInstallGuide(trigger);
}

// The pill in the top bar and on the sign-in card. Hidden once installed and on desktop browsers that can't install.
export function mountInstallButton(button) {
  const paint = () => {
    if (!button.isConnected) return off(); // the sign-in card re-renders and drops its button
    button.hidden = !['prompt', 'ios', 'android'].includes(installState());
  };
  button.addEventListener('click', () => install(button));
  const off = onInstallChange(paint);
  matchMedia('(display-mode: standalone)').addEventListener?.('change', paint);
  paint();
}

// The row in 설정 → 이 기기.
export function installRow(row) {
  const button = el('button', 'pill-button');
  button.type = 'button';
  const notes = {
    installed: '홈 화면의 VEGAS로 열려 있어요',
    prompt: '홈 화면에 아이콘을 만들고 전체 화면으로 열어요',
    ios: '공유 → 홈 화면에 추가로 앱처럼 쓰고 알림도 받아요',
    android: '브라우저 메뉴에서 홈 화면에 추가할 수 있어요',
    none: '휴대폰 브라우저에서 열면 홈 화면에 추가할 수 있어요'
  };
  const r = row('앱 설치', notes[installState()], button);
  const paint = () => {
    const s = installState();
    r.querySelector('.set-note').textContent = notes[s];
    button.textContent = { installed: '설치됨', prompt: '설치하기', ios: '방법 보기', android: '방법 보기', none: '설치 불가' }[s];
    button.disabled = s === 'installed' || s === 'none';
  };
  paint();
  onInstallChange(paint);
  button.addEventListener('click', () => install(button));
  return r;
}
