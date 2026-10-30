// Operator panel on the profile screen: hand chips to (or take them back from) any player.
import { api, errorMessage } from './api.js';
import { formatCH, el } from './fx.js';
import { TIERS, tierName } from './rank.js';

const PRESETS = [1e8, 5e8, 1e9, 1e10];
// Survives the profile re-rendering after every state change.
const ui = { mode: 'grant', amount: PRESETS[2], target: null, message: '', ok: false, temp: null, armed: false, tier: 'silver', division: 'V' };
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
          <label class="admin-custom"><input name="custom" inputmode="numeric" aria-labelledby="admin-amount-label" placeholder="직접 입력" value="${PRESETS.includes(amount) ? '' : amount / 1e4}"><span>만원</span></label></div>
        <label class="admin-field"><span>메모 <small>선택</small></span><input name="note" maxlength="40"></label>
        <p class="admin-msg${ok ? ' is-ok' : ''}" role="status">${esc(message)}</p>
        <button type="submit" class="pill-button pill-button--solid">${formatCH(amount)} ${mode === 'grant' ? '지급하기' : '회수하기'}</button>
      </form>
      <h3 class="admin-log-head">RP 티어 설정</h3>
      <p class="admin-note">위에서 고른 플레이어를 이번 시즌 그 티어·디비전 시작 RP로 옮겨요. 진행 중인 승급전은 없어져요.</p>
      <div class="admin-rp">
        <select name="rp-tier" aria-label="티어">${Object.entries(TIERS).map(([id, t]) => `<option value="${id}"${id === ui.tier ? ' selected' : ''}>${t.name}</option>`).join('')}</select>
        <select name="rp-division" aria-label="디비전"${ui.tier === 'legend' ? ' disabled' : ''}>${['V', 'IV', 'III', 'II', 'I'].map(d => `<option${d === ui.division ? ' selected' : ''}>${d}</option>`).join('')}</select>
        <button type="button" class="pill-button pill-button--solid" data-set-rp>${tierName(ui.tier, ui.tier === 'legend' ? null : ui.division)}로 설정</button>
      </div>
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
    box.querySelector('[name=rp-tier]').addEventListener('change', e => { ui.tier = e.target.value; paint(); });
    box.querySelector('[name=rp-division]').addEventListener('change', e => { ui.division = e.target.value; paint(); });
    box.querySelector('[data-set-rp]').addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        const out = await api.adminSetRp(ui.target, ui.tier, ui.division);
        const r = out.rp;
        Object.assign(ui, { message: `${r.nickname}: ${tierName(r.tier, r.division)} (${r.points} RP)로 옮겼어요.`, ok: true });
        onChanged(out.state);
      } catch (err) { Object.assign(ui, { message: errorMessage(err), ok: false }); paint(); }
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
        Object.assign(ui, { message: `${a.nickname}에게 ${a.amount > 0 ? '+' : ''}${formatCH(a.amount)} 반영했어요. 지금 ${formatCH(a.available)}원.`, ok: true });
        onChanged(out.state);
      } catch (err) {
        Object.assign(ui, { message: err.code === 'INSUFFICIENT_BANKROLL' ? '회수할 만큼 칩이 없어요.' : errorMessage(err), ok: false });
        paint();
      }
    });
  }
  paint();
  root.append(usageBox(), box, errorBox());
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

// 이용 현황 (lib/usage.mjs): headline counts, daily players for two weeks, games this week, and
// who came last. Kept between profile repaints and fetched again at most once a minute.
let usage = { at: 0, data: null, error: '' };
const dayText = key => { const [, m, d] = key.split('-'); return `${Number(m)}/${Number(d)}`; };
const dateText = iso => (iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' }) : '-');
function usageMarkup(r) {
  const t = r.totals;
  const tiles = [['지금', t.now, '10분 안에 들어온 사람'], ['오늘', t.today, '오늘 들어온 사람'], ['7일', t.week, '7일 동안 들어온 사람'], ['30일', t.month, '30일 동안 들어온 사람']];
  const max = Math.max(1, ...r.daily.map(d => d.active || 0));
  const bars = r.daily.map((d, i) => {
    const [, mm, dd] = d.day.split('-');
    const label = i === 0 || dd === '01' ? `${Number(mm)}/${Number(dd)}` : String(Number(dd));
    const h = d.active ? Math.max(4, Math.round((d.active / max) * 100)) : 0;
    const tip = `${dayText(d.day)} · 접속 ${d.active ?? '기록 없음'}명${d.rounds != null ? ` · ${d.rounds}판` : ''} · 가입 ${d.signups}명`;
    return `<li title="${tip}" aria-label="${tip}"><span class="usage-bar-val">${d.active ?? ''}</span><span class="usage-bar" style="height:${h}%"></span><span class="usage-bar-day">${label}</span><span class="usage-bar-new">${d.signups ? `+${d.signups}` : ''}</span></li>`;
  }).join('');
  const games = r.games.length ? r.games.slice(0, 12).map(g => `<li><span>${esc(g.game)}</span><b>${g.rounds.toLocaleString('ko-KR')}판</b></li>`).join('') : '<li><span>아직 기록이 없어요</span></li>';
  const players = r.players.slice(0, 30).map(p => `<li><span>${esc(p.nickname)}<small>가입 ${dateText(p.joinedAt)} · 칩 ${formatCH(p.worth)}</small></span><b>${p.lastSeenAt ? ago(Date.parse(p.lastSeenAt)) : '-'}</b></li>`).join('');
  return `
    <dl class="usage-tiles">${tiles.map(([k, v, label]) => `<div title="${label}"><dt>${k}</dt><dd>${v}<small>명</small></dd></div>`).join('')}</dl>
    <p class="admin-note">가입 ${t.players}명 · 이번 주 새로 ${t.signupsWeek}명 · 오늘 ${t.roundsToday.toLocaleString('ko-KR')}판 · 7일 ${t.roundsWeek.toLocaleString('ko-KR')}판</p>
    <h3 class="admin-log-head">하루 접속자 <small>최근 14일 · 아래 +는 가입</small></h3>
    <ol class="usage-chart" aria-label="최근 14일 하루 접속자">${bars}</ol>
    <h3 class="admin-log-head">게임별 판수 <small>최근 7일</small></h3>
    <ul class="ledger admin-log">${games}</ul>
    <h3 class="admin-log-head">최근 들어온 사람</h3>
    <ul class="ledger admin-log">${players}</ul>
    ${r.since ? `<p class="admin-note">판수와 하루 기록은 ${dateText(r.since + 'T12:00:00+09:00')}부터 쌓여요. 그 전 날짜의 접속자는 남은 기록으로 센 거라 실제보다 적을 수 있어요.</p>` : ''}`;
}
function usageBox() {
  const box = el('section', 'admin-panel admin-usage');
  box.setAttribute('aria-labelledby', 'admin-usage-title');
  box.innerHTML = `<h2 class="sub-head" id="admin-usage-title">이용 현황 <small>사람들이 얼마나 쓰는지</small></h2><div data-usage></div><div class="admin-error-actions"><button type="button" class="pill-button" data-reload>새로고침</button></div>`;
  const body = box.querySelector('[data-usage]');
  const paint = () => { body.innerHTML = usage.data ? usageMarkup(usage.data) : `<p class="admin-note">${esc(usage.error || '불러오는 중…')}</p>`; };
  async function load(force = false) {
    if (!force && usage.data && Date.now() - usage.at < 60_000) return;
    try { usage = { at: Date.now(), data: await api.adminUsage(), error: '' }; }
    catch (e) { usage = { ...usage, error: errorMessage(e) }; }
    if (box.isConnected) paint();
  }
  box.querySelector('[data-reload]').addEventListener('click', () => load(true));
  paint();
  load();
  return box;
}
