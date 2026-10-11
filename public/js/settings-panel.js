// The settings form. The full screen and the quick sheet at a table render the same rows;
// the sheet shows only what you'd change mid-game.
import { el, isMuted, sound, haptic } from './fx.js';
import { settings, onSettings, pace, PACES } from './settings.js';
import { resetGuides } from './guide.js';
import { voice } from './voice.js';

const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const canWakeLock = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

function row(label, note, control) {
  const r = el('div', 'set-row');
  const text = el('div', 'set-text');
  text.append(el('span', 'set-label', label));
  if (note) text.append(el('small', 'set-note', note));
  r.append(text, control);
  return r;
}

let uid = 0;
function toggle(key, label, note, { onChange } = {}) {
  const b = el('button', 'switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', label);
  const paint = () => b.setAttribute('aria-checked', String(Boolean(settings.get(key))));
  paint();
  b.addEventListener('click', () => { settings.set(key, !settings.get(key)); paint(); onChange?.(settings.get(key)); });
  return { node: row(label, note, b), paint };
}

// The master switch is a [data-sound] button, so the shared ♪ handler flips it and repaints it.
function soundSwitch() {
  const b = el('button', 'switch');
  b.type = 'button';
  b.dataset.sound = '';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', '소리');
  b.setAttribute('aria-checked', String(!isMuted()));
  return row('소리', '모든 효과음과 음악을 한 번에 켜고 꺼요', b);
}

function slider(key, label, { onRelease } = {}) {
  const id = `set-${key}-${++uid}`;
  const wrap = el('div', 'set-slider');
  wrap.innerHTML = `<input type="range" min="0" max="100" step="5" id="${id}"><output for="${id}"></output>`;
  const input = wrap.querySelector('input');
  const out = wrap.querySelector('output');
  input.setAttribute('aria-label', label);
  const paint = () => {
    const v = settings.get(key);
    input.value = v;
    out.textContent = v ? `${v}` : '끔';
    input.style.setProperty('--fill', `${v}%`);
  };
  paint();
  input.addEventListener('input', () => { settings.set(key, Number(input.value)); paint(); });
  input.addEventListener('change', () => onRelease?.());
  const r = row(label, null, wrap);
  r.classList.add('set-row--slider');
  return { node: r, paint };
}

function paceControl() {
  const group = el('div', 'segmented');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', '애니메이션 속도');
  const paint = () => group.querySelectorAll('button').forEach(b => {
    const on = b.dataset.pace === pace();
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  Object.entries(PACES).forEach(([id, p]) => {
    const b = el('button', 'segment', p.label);
    b.type = 'button';
    b.dataset.pace = id;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { settings.set('pace', id); paint(); });
    group.append(b);
  });
  // Arrow keys move along the group like native radio buttons.
  group.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const ids = Object.keys(PACES);
    const next = ids[(ids.indexOf(pace()) + step + ids.length) % ids.length];
    settings.set('pace', next);
    paint();
    group.querySelector(`[data-pace="${next}"]`).focus();
  });
  paint();
  const r = row('애니메이션', '카드·칩이 움직이는 속도. 최소는 움직임을 거의 없애요', group);
  r.classList.add('set-row--stack');
  return { node: r, paint };
}

// Two taps for anything that wipes something: the first arms the button, the second does it.
function confirmButton(label, armedLabel, action) {
  const b = el('button', 'pill-button set-danger', label);
  b.type = 'button';
  let armed = null;
  const disarm = () => { clearTimeout(armed); armed = null; b.textContent = label; b.classList.remove('is-armed'); };
  b.addEventListener('click', () => {
    if (!armed) { b.textContent = armedLabel; b.classList.add('is-armed'); armed = setTimeout(disarm, 4000); return; }
    disarm();
    action(b);
  });
  b.addEventListener('blur', disarm);
  return b;
}

function section(title, rows) {
  const s = el('section', 'set-section');
  s.append(el('h2', 'set-head', title), ...rows.filter(Boolean));
  return s;
}

function done(button, text) {
  const was = button.textContent;
  button.textContent = text;
  button.disabled = true;
  setTimeout(() => { button.textContent = was; button.disabled = false; }, 1600);
}

// Renders into `root`; returns a cleanup that drops the listener.
// `game` is the table the quick sheet opened over, so game-specific rows show only there.
export function renderSettings(root, { compact = false, game = null } = {}) {
  const parts = [];
  const add = part => { parts.push(part); return part.node; };

  const audioRows = [
    soundSwitch(),
    add(slider('sfx', '효과음', { onRelease: () => sound.chip() })),
    add(slider('music', '음악')),
    add(toggle('voice', '딜러 음성', '"No more bets", "Your action" 같은 딜러 콜을 영어로 들려줘요', { onChange: on => on && voice.say('place-bets', { cut: true }) })),
    add(slider('voiceVolume', '음성', { onRelease: () => voice.say('your-action', { cut: true }) }))
  ];
  const motionRows = [
    add(paceControl()),
    canVibrate() ? add(toggle('haptics', '진동', '칩을 놓거나 이길 때 살짝 떨려요', { onChange: on => on && haptic(20) })) : null,
    canWakeLock() ? add(toggle('awake', '화면 켜두기', '테이블에 앉아 있는 동안 화면이 꺼지지 않아요')) : null
  ];
  const sections = [section('소리', audioRows), section('화면과 움직임', motionRows)];
  if (!compact || game === 'blackjack') {
    sections.push(section('게임', [add(toggle('bjHint', '블랙잭 정석 힌트', '내 차례에 기본 전략이 권하는 버튼을 밝혀 주고, 정석대로 친 비율을 테이블에 보여 줘요'))]));
  }

  if (!compact) {
    const replay = el('button', 'pill-button', '처음부터 다시 보기');
    replay.type = 'button';
    replay.addEventListener('click', () => { resetGuides(); done(replay, '다음에 앉으면 다시 나와요'); });
    sections.push(section('가이드', [
      add(toggle('guides', '처음 앉을 때 가이드', '게임에 처음 앉으면 테이블에서 따라 하는 가이드가 시작돼요')),
      row('본 가이드 기록', '모든 게임의 가이드를 처음 앉을 때처럼 다시 보여 줘요', replay)
    ]));
    sections.push(section('이 기기', [
      row('설정 되돌리기', '소리·속도·진동을 처음 값으로 돌려요. 칩과 기록은 그대로예요',
        confirmButton('되돌리기', '한 번 더 누르면 되돌려요', b => { settings.reset(); done(b, '되돌렸어요'); }))
    ]));
  }
  root.replaceChildren(...sections);
  return onSettings(() => parts.forEach(p => p.paint?.()));
}

// A ⚙ button in the table's top bar opens the quick settings as a bottom sheet, so the
// player can turn the music down or speed up the deal without leaving the table.
export function attachQuickSettings(table) {
  const tools = table?.root?.querySelector('.table-tools');
  if (!tools) return;
  const button = el('button', 'table-icon table-settings', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>');
  button.type = 'button';
  button.setAttribute('aria-label', '설정');
  button.setAttribute('aria-expanded', 'false');
  const sheet = el('section', 'sheet sheet--settings');
  sheet.setAttribute('aria-label', '설정');
  sheet.inert = true;
  sheet.innerHTML = '<div class="sheet-head"><h2>설정</h2><button type="button" class="sheet-close" data-close>닫기</button></div><div class="settings-body"></div>';
  let cleanup = null;
  const open = value => {
    sheet.classList.toggle('is-open', value);
    sheet.inert = !value;
    button.setAttribute('aria-expanded', String(value));
    if (value) {
      // Close the rules sheet if it is up, so only one sheet covers the felt.
      table.root.querySelectorAll('.sheet.is-open').forEach(s => { if (s !== sheet) { s.classList.remove('is-open'); s.inert = true; } });
      cleanup?.();
      cleanup = renderSettings(sheet.querySelector('.settings-body'), { compact: true, game: table.game });
      sheet.querySelector('[data-close]').focus({ preventScroll: true });
    } else { cleanup?.(); cleanup = null; }
  };
  button.addEventListener('click', () => { if (table.guide?.active) table.guide.stop(); open(!sheet.classList.contains('is-open')); });
  sheet.querySelector('[data-close]').addEventListener('click', () => { open(false); button.focus({ preventScroll: true }); });
  tools.insertBefore(button, tools.querySelector('.table-help'));
  table.root.append(sheet);

  const onKey = e => {
    if (e.key !== 'Escape' || !sheet.classList.contains('is-open')) return;
    open(false); button.focus({ preventScroll: true }); e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);
  const destroy = table.destroy.bind(table);
  table.destroy = () => { cleanup?.(); window.removeEventListener('keydown', onKey, true); destroy(); };
}
