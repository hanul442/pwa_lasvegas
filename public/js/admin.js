// Operator panel on the profile screen: hand chips to (or take them back from) any player.
import { api, errorMessage } from './api.js';
import { formatCH, formatFull, el } from './fx.js';

const PRESETS = [1e8, 5e8, 1e9, 1e10];
// Survives the profile re-rendering after every state change.
const ui = { mode: 'grant', amount: PRESETS[2], target: null, message: '', ok: false, temp: null, armed: false };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function renderAdmin(root, state, onChanged) {
  if (!state?.user?.isAdmin) return;
  const box = el('section', 'admin-panel');
  box.setAttribute('aria-labelledby', 'admin-title');
  const players = [...state.users].sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  if (!players.some(p => p.id === ui.target)) ui.target = players.find(p => p.id !== state.user.id)?.id || state.user.id;

  function paint() {
    const { mode, amount, target, message, ok } = ui;
    ui.message = '';
    const log = (state.adminLog || []).slice(0, 8).map(x => `<li><span>${esc(x.nickname)}${x.note ? ` · ${esc(x.note)}` : ''}</span><b class="${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${formatCH(x.amount)}</b></li>`).join('');
    box.innerHTML = `
      <h2 class="sub-head" id="admin-title">운영자 <small>칩 지급·회수</small></h2>
      <form class="admin-form" novalidate>
        <label class="admin-field"><span>플레이어</span>
          <select name="player">${players.map(p => `<option value="${esc(p.id)}"${p.id === target ? ' selected' : ''}>${esc(p.nickname)}${p.id === state.user.id ? ' (나)' : ''} · ${formatCH(p.account.available)}</option>`).join('')}</select></label>
        <div class="segmented segmented--two admin-mode" role="radiogroup" aria-label="지급 또는 회수">
          <button type="button" role="radio" aria-checked="${mode === 'grant'}" class="${mode === 'grant' ? 'is-active' : ''}" data-mode="grant">지급</button>
          <button type="button" role="radio" aria-checked="${mode === 'deduct'}" class="${mode === 'deduct' ? 'is-active' : ''}" data-mode="deduct">회수</button>
        </div>
        <div class="admin-field"><span id="admin-amount-label">금액</span>
          <div class="admin-presets">${PRESETS.map(v => `<button type="button" class="pill-button${v === amount ? ' is-active' : ''}" data-amount="${v}">${formatCH(v)}</button>`).join('')}</div>
          <label class="admin-custom"><input name="custom" inputmode="numeric" aria-labelledby="admin-amount-label" placeholder="직접 입력" value="${PRESETS.includes(amount) ? '' : amount / 1e4}"><span>만 원</span></label></div>
        <label class="admin-field"><span>메모 <small>선택</small></span><input name="note" maxlength="40"></label>
        <p class="admin-msg${ok ? ' is-ok' : ''}" role="status">${esc(message)}</p>
        <button type="submit" class="pill-button pill-button--solid">${formatCH(amount)} ${mode === 'grant' ? '지급하기' : '회수하기'}</button>
      </form>
      <h3 class="admin-log-head">비밀번호 초기화</h3>
      <p class="admin-note">위에서 고른 플레이어에게 임시 비밀번호를 만들어 줘요. 그 플레이어는 모든 기기에서 로그아웃되고, 받은 비밀번호로 들어와 프로필에서 바꾸면 돼요.</p>
      ${ui.temp ? `<p class="account-code"><span>${esc(ui.temp.username)}</span><code>${esc(ui.temp.password)}</code><small>지금만 보여요. 플레이어에게 전해 주세요.</small></p>` : ''}
      <button type="button" class="pill-button${ui.armed ? ' is-armed' : ''}" data-reset-password>${ui.armed ? '한 번 더 누르면 초기화해요' : '임시 비밀번호 만들기'}</button>
      <h3 class="admin-log-head">최근 운영 기록</h3>
      <ul class="ledger admin-log">${log || '<li><span>아직 기록이 없어요</span></li>'}</ul>`;
    const form = box.querySelector('form');
    form.player.addEventListener('change', () => { ui.target = form.player.value; ui.temp = null; ui.armed = false; paint(); });
    box.querySelector('[data-reset-password]').addEventListener('click', async e => {
      if (!ui.armed) { ui.armed = true; paint(); box.querySelector('[data-reset-password]').focus(); return; }
      ui.armed = false;
      e.target.disabled = true;
      try { ui.temp = await api.adminResetPassword(ui.target); }
      catch (err) { ui.temp = null; Object.assign(ui, { message: errorMessage(err), ok: false }); }
      paint();
    });
    box.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { ui.mode = b.dataset.mode; paint(); }));
    box.querySelectorAll('[data-amount]').forEach(b => b.addEventListener('click', () => { ui.amount = Number(b.dataset.amount); paint(); }));
    form.custom.addEventListener('change', () => {
      const m = Number(form.custom.value.replace(/[^\d.]/g, ''));
      if (m > 0) { ui.amount = Math.round(m * 1e4); paint(); box.querySelector('[name=custom]').focus(); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      const note = form.note.value;
      try {
        const out = await api.adminAdjust(ui.target, ui.mode === 'grant' ? ui.amount : -ui.amount, note);
        const a = out.adjustment;
        Object.assign(ui, { message: `${a.nickname}에게 ${a.amount > 0 ? '+' : ''}${formatCH(a.amount)} 반영했어요. 지금 ${formatFull(a.available)}원.`, ok: true });
        onChanged(out.state);
      } catch (err) {
        Object.assign(ui, { message: err.code === 'INSUFFICIENT_BANKROLL' ? '회수할 만큼 칩이 없어요.' : errorMessage(err), ok: false });
        paint();
      }
    });
  }
  paint();
  root.append(box, errorBox());
}

// 오류 기록: what broke on players' phones and on the server, newest first.
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
function errorBox() {
  const box = el('section', 'admin-panel admin-errors');
  box.setAttribute('aria-labelledby', 'admin-errors-title');
  box.innerHTML = `<h2 class="sub-head" id="admin-errors-title">오류 기록 <small>폰·서버에서 난 오류</small></h2><ul class="ledger admin-log" data-errors><li><span>불러오는 중…</span></li></ul>
    <div class="admin-error-actions"><button type="button" class="pill-button" data-reload>새로고침</button><button type="button" class="pill-button" data-clear>모두 지우기</button></div>`;
  const list = box.querySelector('[data-errors]');
  async function load(call = api.adminErrors) {
    try {
      const { errors } = await call();
      list.innerHTML = errors.length ? errors.map(x => `<li class="admin-error"><details><summary><span><b class="admin-error-src">${x.source === 'server' ? '서버' : '폰'}</b> ${esc(x.message)}</span><small>${x.count}번 · ${esc(x.players.join(', ') || '로그인 전')} · ${ago(x.lastAt)}</small></summary><p>${esc(x.where)}</p>${x.stack ? `<pre>${esc(x.stack)}</pre>` : ''}<p>${esc(x.ua)} ${esc(x.build)}</p></details></li>`).join('') : '<li><span>오류가 없어요</span></li>';
    } catch (e) { list.innerHTML = `<li><span>${esc(errorMessage(e))}</span></li>`; }
  }
  box.querySelector('[data-reload]').addEventListener('click', () => load());
  box.querySelector('[data-clear]').addEventListener('click', () => load(api.adminErrorsClear));
  load();
  return box;
}
