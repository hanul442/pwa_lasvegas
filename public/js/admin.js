// Operator panel on the profile screen: hand chips to (or take them back from) any player.
import { api, errorMessage } from './api.js';
import { formatCH, formatFull, el } from './fx.js';

const PRESETS = [10e6, 50e6, 100e6, 1e9];
// Survives the profile re-rendering after every state change.
const ui = { mode: 'grant', amount: PRESETS[2], target: null, message: '', ok: false };
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
      <h3 class="admin-log-head">최근 운영 기록</h3>
      <ul class="ledger admin-log">${log || '<li><span>아직 기록이 없어요</span></li>'}</ul>`;
    const form = box.querySelector('form');
    form.player.addEventListener('change', () => { ui.target = form.player.value; });
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
  root.append(box);
}
