// 건강한 이용: counts time on screen, reminds the player every hour of continuous play and holds
// the player's own daily limit. The hourly notice follows 게임산업진흥에 관한 법률 시행령 제8조의3
// 제7항·제8항: at least once an hour, for at least 3 seconds, the fixed warning plus the time played.
// Everything is kept on this device.
import { el } from './fx.js';
import { HELPLINE, openTerms } from './terms.js';

const KEY = 'vegas:playtime';
export const MIN = 60e3;
export const HOUR = 60 * MIN;
export const BREAK = 15 * MIN;   // away this long counts as a real break: the continuous clock restarts
export const REST = 5 * MIN;     // the "5분 쉬기" screen
export const STEP_CAP = MIN;     // one tick never counts more than this (a phone asleep with the app open)
export const WARNING = '과도한 게임이용은 정상적인 일상생활에 지장을 줄 수 있습니다.';
export const LIMITS = [0, 60, 120, 180, 240]; // minutes per day; 0 = no limit
const HOLD = 3000;        // the law's 3 seconds before 계속하기 unlocks
const HOLD_LONG = 10000;  // after three hours without a break

const pad = n => String(n).padStart(2, '0');
export const dayOf = now => { const d = new Date(now); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const fresh = now => ({ day: dayOf(now), today: 0, run: 0, last: null, nudged: 0, limit: 0, nextLimit: null });

export function duration(ms) {
  const m = Math.floor(ms / MIN), h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`) : `${m}분`;
}
export const limitLabel = min => (min ? `${min / 60}시간` : '끔');

// One step of the clock. `counting` says the app was on screen since the last step.
export function advance(prev, now, counting) {
  const s = { ...prev };
  const day = dayOf(now);
  if (s.day !== day) {
    s.day = day;
    s.today = 0;
    if (s.nextLimit != null) { s.limit = s.nextLimit; s.nextLimit = null; }
  }
  if (s.last != null) {
    const gap = now - s.last;
    if (gap < 0 || gap >= BREAK) { s.run = 0; s.nudged = 0; }
    else if (counting) { const add = Math.min(gap, STEP_CAP); s.run += add; s.today += add; }
  }
  s.last = now;
  return s;
}

// Hours of continuous play not yet announced (0 when nothing is due).
export const nudgeDue = s => { const h = Math.floor(s.run / HOUR); return h > s.nudged ? h : 0; };
export const overLimit = s => s.limit > 0 && s.today >= s.limit * MIN;

// A stricter limit starts now; a looser one (or 끔) waits for tomorrow, so it can't be lifted mid-binge.
export function withLimit(prev, minutes) {
  const s = { ...prev };
  if (minutes === s.limit) s.nextLimit = null;
  else if (minutes > 0 && (s.limit === 0 || minutes < s.limit)) { s.limit = minutes; s.nextLimit = null; }
  else s.nextLimit = minutes;
  return s;
}

// A finished rest clears the continuous clock.
export const rested = prev => ({ ...prev, run: 0, nudged: 0 });

// ---------- browser side ----------
let state = null;
const load = () => { try { return { ...fresh(Date.now()), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return fresh(Date.now()); } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
// Read through to storage each time, so a second tab or a reload never rolls the clock back.
const get = () => (state = load());
const listeners = new Set();
const emit = () => listeners.forEach(fn => { try { fn(state); } catch {} });

export const playtime = {
  get: () => ({ ...get() }),
  setLimit(minutes) { state = withLimit(advance(get(), Date.now(), false), minutes); save(); emit(); check(); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
};

let resting = false;
let gate = null;
let banner = null;
let inTable = () => false;

function step(counting) {
  state = advance(get(), Date.now(), counting && !resting);
  save();
  emit();
}

function check() {
  if (resting) return;
  const s = get();
  if (overLimit(s)) { showLimit(); return; }
  if (gate?.dataset.kind === 'limit') closeGate();
  const hours = nudgeDue(s);
  if (!hours) return;
  state = { ...s, nudged: hours };
  save();
  // At a table the notice sits on top without stopping the hand (turn clocks keep running);
  // in the menus it is a full screen that offers a short rest.
  if (inTable()) showBanner(hours); else showNudge(hours);
}

function timeLine(s) { return `연속 ${duration(s.run)} · 오늘 ${duration(s.today)}`; }

function openGate(kind, html) {
  closeGate();
  gate = el('section', `rest-gate rest-gate--${kind}`);
  gate.dataset.kind = kind;
  gate.setAttribute('role', 'alertdialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'rest-title');
  gate.innerHTML = `<div class="rest-card">${html}</div>`;
  document.body.append(gate);
  document.body.classList.add('rest-mode');
  requestAnimationFrame(() => gate?.classList.add('is-open'));
  return gate;
}
function closeGate() {
  gate?.remove();
  gate = null;
  document.body.classList.remove('rest-mode');
}

function helpLine() {
  return `<p class="rest-help">혹시 게임이 일상을 방해하고 있다면 ${HELPLINE.name} <a href="tel:${HELPLINE.phone}">${HELPLINE.phone}</a>(24시간 무료)에서 이야기를 들어 줘요.</p>`;
}

// The 계속하기 button unlocks after `hold` ms, counting down on its label.
function holdButton(button, hold, label) {
  const until = Date.now() + hold;
  button.disabled = true;
  const tick = () => {
    if (!button.isConnected) return;
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left > 0) { button.textContent = `${label} (${left})`; setTimeout(tick, 250); }
    else { button.textContent = label; button.disabled = false; }
  };
  tick();
}

function showNudge(hours) {
  banner?.remove(); banner = null;
  const s = get();
  const long = hours >= 3;
  const node = openGate('nudge', `
    <span class="rest-mark" aria-hidden="true"></span>
    <p class="rest-kicker">휴식 안내</p>
    <h2 id="rest-title">${long ? `${hours}시간째 쉬지 않았어요` : `${hours}시간째 플레이 중이에요`}</h2>
    <p class="rest-time">${timeLine(s)}</p>
    <p class="rest-warning">${WARNING}</p>
    ${long ? '<p class="rest-note">잠깐 일어나서 물 한 잔 마시고, 눈을 쉬게 해 주세요.</p>' : ''}
    ${long ? helpLine() : ''}
    <div class="rest-actions">
      <button type="button" class="pill-button pill-button--solid" data-rest>5분 쉬기</button>
      <button type="button" class="pill-button" data-continue>계속하기</button>
    </div>`);
  const cont = node.querySelector('[data-continue]');
  holdButton(cont, long ? HOLD_LONG : HOLD, '계속하기');
  cont.addEventListener('click', closeGate);
  node.querySelector('[data-rest]').addEventListener('click', startRest);
  node.querySelector('[data-rest]').focus({ preventScroll: true });
}

function showBanner(hours) {
  banner?.remove();
  const s = get();
  banner = el('div', 'rest-banner');
  banner.setAttribute('role', 'status');
  banner.innerHTML = `<div class="rest-banner-text"><b>${hours}시간째 플레이 중</b><span>${timeLine(s)}</span><small>${WARNING}</small></div><button type="button" class="pill-button" data-rest>쉬기</button>`;
  banner.querySelector('[data-rest]').addEventListener('click', () => { banner?.remove(); banner = null; startRest(); });
  document.body.append(banner);
  requestAnimationFrame(() => banner?.classList.add('is-shown'));
  const mine = banner;
  setTimeout(() => {
    if (banner !== mine) return;
    mine.classList.remove('is-shown');
    setTimeout(() => mine.remove(), 400);
    banner = null;
  }, hours >= 3 ? 20000 : 10000);
}

function startRest() {
  resting = true;
  const until = Date.now() + REST;
  const node = openGate('rest', `
    <span class="rest-mark" aria-hidden="true"></span>
    <p class="rest-kicker">쉬는 중</p>
    <h2 id="rest-title" class="rest-clock" aria-live="off">5:00</h2>
    <p class="rest-note">화면에서 눈을 떼고 잠깐 쉬어요. 5분을 채우면 연속 플레이 시간이 처음부터 다시 세져요.</p>
    <div class="rest-actions"><button type="button" class="pill-button" data-done>그만 쉬기</button></div>`);
  const clock = node.querySelector('.rest-clock');
  const done = node.querySelector('[data-done]');
  const finish = full => {
    clearInterval(timer);
    resting = false;
    state = full ? rested(advance(get(), Date.now(), false)) : advance(get(), Date.now(), false);
    save(); emit();
    closeGate();
    check();
  };
  const timer = setInterval(() => {
    if (!node.isConnected) { clearInterval(timer); resting = false; return; }
    const left = Math.max(0, until - Date.now());
    clock.textContent = `${Math.floor(left / MIN)}:${pad(Math.floor(left / 1000) % 60)}`;
    if (!left) {
      clearInterval(timer);
      state = rested(advance(get(), Date.now(), false));
      save(); emit();
      clock.textContent = '다 쉬었어요';
      done.textContent = '다시 하기';
      done.classList.add('pill-button--solid');
      done.onclick = () => { resting = false; closeGate(); check(); };
    }
  }, 250);
  done.onclick = () => finish(false);
  done.focus({ preventScroll: true });
}

function showLimit() {
  if (gate?.dataset.kind === 'limit') return;
  banner?.remove(); banner = null;
  const s = get();
  const node = openGate('limit', `
    <span class="rest-mark" aria-hidden="true"></span>
    <p class="rest-kicker">오늘은 여기까지</p>
    <h2 id="rest-title">오늘 정한 ${limitLabel(s.limit)}을 다 썼어요</h2>
    <p class="rest-time">오늘 ${duration(s.today)} 플레이했어요. 내일 0시에 다시 열려요.</p>
    <p class="rest-warning">${WARNING}</p>
    <div class="rest-limit" data-limit></div>
    ${helpLine()}
    <div class="rest-actions"><button type="button" class="pill-button" data-terms>이용약관</button></div>`);
  const off = limitControl(node.querySelector('[data-limit]'));
  node.querySelector('[data-terms]').addEventListener('click', () => openTerms());
  const stop = new MutationObserver(() => { if (!node.isConnected) { off(); stop.disconnect(); } });
  stop.observe(document.body, { childList: true });
}

// 끔/1/2/3/4시간 picker plus a line saying when a change applies. Returns an unsubscribe.
export function limitControl(root) {
  const group = el('div', 'segmented segmented--five');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', '하루 플레이 한도');
  const note = el('small', 'set-note limit-note');
  for (const m of LIMITS) {
    const b = el('button', 'segment', limitLabel(m));
    b.type = 'button';
    b.dataset.limit = m;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => playtime.setLimit(m));
    group.append(b);
  }
  const paint = () => {
    const s = get();
    const shown = s.nextLimit ?? s.limit;
    group.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.limit) === shown)));
    note.textContent = s.nextLimit != null
      ? `오늘 한도는 ${s.limit ? limitLabel(s.limit) : '없음'} 그대로예요. 바꾼 값은 내일부터 적용돼요.`
      : s.limit ? `오늘 ${duration(s.today)} 썼어요. 한도를 늘리거나 끄면 내일부터 적용돼요.` : '한도를 정하면 다 쓴 날은 테이블에 앉을 수 없어요.';
  };
  paint();
  root.replaceChildren(group, note);
  return playtime.on(paint);
}

let started = false;
// isInTable: true while a hand may be in progress, so the notice doesn't cover the felt.
export function startPlaytime({ isInTable } = {}) {
  if (started || typeof document === 'undefined') return;
  started = true;
  if (isInTable) inTable = isInTable;
  step(false);
  setInterval(() => { if (!document.hidden) { step(true); check(); } }, 10e3);
  document.addEventListener('visibilitychange', () => {
    // Leaving counts the time up to now; coming back only notices how long the break was.
    step(document.hidden);
    if (!document.hidden) check();
  });
  check();
}
