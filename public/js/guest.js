// 게스트 플레이 and 친구 초대 on the client: the "이 칩 지키려면 이름 정하기" nudge after a guest wins,
// the sheet that turns the guest into an account (chips stay), the invite card in the profile, and
// the toast when an invite reward lands.
import { api, errorMessage, saveSession } from './api.js';
import { el, formatCH } from './fx.js';
import { toast } from './notice.js';
import { pendingRef, dropPendingRef, setMyInviteCode, shareFriendInvite } from './invite.js';

let lastWin = undefined; // the newest win this page has seen; undefined until the first state
let nudgedAt = 0;
let nudgeDue = false; // a win earned the nudge; it shows once off the table
let seenInvite = null;
let sheet = null;
const NUDGE_GAP = 3 * 60_000;

const latestWin = st => (st.ledger || []).find(x => x.type === 'GAME_WIN' && x.amount > 0) || null;

// Every new state: remember my invite code, nudge a guest after a win, cheer an invite reward.
export function onGuestState(st, applyState) {
  setMyInviteCode(st.invite?.code);
  document.body.classList.toggle('is-guest', Boolean(st.user?.guest));
  const win = latestWin(st);
  if (lastWin === undefined) lastWin = win?.id ?? null;
  else if (win && win.id !== lastWin) {
    lastWin = win.id;
    if (st.user.guest && Date.now() - nudgedAt > NUDGE_GAP) { nudgedAt = Date.now(); nudgeDue = true; }
  }
  // At a table the toast would sit on the chips and buttons, so it waits for the next screen off
  // the table (closing a table fetches a fresh state, which lands here).
  if (nudgeDue && st.user.guest && !document.body.classList.contains('game-mode')) {
    nudgeDue = false;
    setTimeout(() => toast(`이겼어요! ${formatCH(st.user.account.available + st.user.account.locked)}원, 이 칩 지키려면 이름 정하기`, { action: '이름 정하기', onAction: () => openNameSheet(applyState), duration: 9000 }), 900);
  }
  if (!st.user.guest) nudgeDue = false;
  const inv = st.invite;
  if (inv) {
    const mark = { total: inv.total || 0, paid: Boolean(inv.invitedBy?.paid) };
    if (seenInvite && st.user.id === seenInvite.id) {
      if (mark.paid && !seenInvite.paid) toast(`친구 초대 보상 ${formatCH(inv.reward)}원을 받았어요. ${inv.invitedBy.nickname ? `${inv.invitedBy.nickname}님도 받았어요.` : ''}`);
      else if (mark.total > seenInvite.total) toast(`${inv.friends[0]?.nickname || '친구'}님이 첫 판을 끝냈어요. 초대 보상 ${formatCH(inv.reward)}원!`);
    }
    seenInvite = { ...mark, id: st.user.id };
  }
}

// The guest picks a name and password; the server keeps every chip and record.
export function openNameSheet(applyState) {
  if (sheet) return;
  sheet = el('section', 'auth-gate auth-gate--sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'name-title');
  sheet.innerHTML = `
    <div class="auth-card">
      <button type="button" class="auth-close" data-close aria-label="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <h1 id="name-title">이 칩 지키려면 이름 정하기</h1>
      <p class="auth-lede">지금은 이 기기에만 남아 있어요. 이름과 비밀번호를 정하면 칩과 기록이 그대로 계정에 저장되고, 랭킹에도 올라가요.</p>
      <form class="auth-form" novalidate>
        <label class="auth-field"><span>이름</span>
          <input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="12" required>
          <small>랭킹에 보이는 이름이에요. 한글·영문·숫자 2~12자.</small></label>
        <label class="auth-field"><span>비밀번호</span>
          <input name="password" type="password" autocomplete="new-password" maxlength="72" required>
          <small>6자 이상. 다른 기기에서 이 이름으로 로그인해요.</small></label>
        <p class="auth-error" role="alert"></p>
        <button class="pill-button pill-button--solid auth-submit" type="submit">이름 정하고 칩 지키기</button>
      </form>
    </div>`;
  document.body.append(sheet);
  const close = () => { sheet?.remove(); sheet = null; removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  sheet.querySelector('[data-close]').addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  const form = sheet.querySelector('form');
  const error = form.querySelector('.auth-error');
  form.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { error.textContent = ''; }));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = form.querySelector('.auth-submit');
    submit.disabled = true;
    try {
      const out = await api.nameGuest(form.username.value.trim(), form.password.value, pendingRef() || undefined);
      dropPendingRef();
      saveSession(out.token, out.state.user.id);
      close();
      applyState(out.state);
      toast(`${out.state.user.nickname}님, 칩을 계정에 저장했어요.`);
    } catch (err) {
      submit.disabled = false;
      error.textContent = errorMessage(err);
      (err.code === 'INVALID_PASSWORD' ? form.password : form.username).focus();
    }
  });
  requestAnimationFrame(() => form.username.focus({ preventScroll: true }));
}

// Profile: a guest's card in place of the account row.
export function guestCard(st) {
  return `<div class="guest-card">
    <div><b>게스트로 플레이 중</b><small>칩 ${formatCH(st.user.account.available + st.user.account.locked)}원이 이 기기에만 있어요. 이름을 정하면 계정에 저장되고 랭킹에 올라가요.</small></div>
    <button type="button" class="pill-button pill-button--solid" data-name-guest>이름 정하기</button>
  </div>`;
}

// Profile: 친구 초대. My link, the reward, and the friends who came.
export function renderInviteCard(root, st) {
  const inv = st.invite;
  if (!root || !inv) return;
  const box = el('div', 'invite-card');
  if (!inv.code) {
    box.innerHTML = `<div class="invite-head"><b>친구 초대</b><small>이름을 정하면 내 초대 링크가 생겨요. 친구가 첫 판을 끝내면 둘 다 ${formatCH(inv.reward)}원.</small></div>`;
    root.replaceChildren(box);
    return;
  }
  const friends = (inv.friends || []).slice(0, 5).map(f => `<li><span>${f.nickname}</span><small>${f.paid ? `+${formatCH(inv.reward)}` : '이번 달 한도'}</small></li>`).join('');
  box.innerHTML = `
    <div class="invite-head"><b>친구 초대</b><small>링크로 온 친구가 첫 판을 끝내면 <b>둘 다 ${formatCH(inv.reward)}원</b>. 가입 없이 바로 앉을 수 있어요.</small></div>
    <dl class="invite-stats">
      <div><dt>데려온 친구</dt><dd>${inv.total}명</dd></div>
      <div><dt>이번 달 보상</dt><dd>${inv.paidThisMonth} / ${inv.cap}</dd></div>
      <div><dt>첫 판 대기</dt><dd>${inv.waiting}명</dd></div>
    </dl>
    ${friends ? `<ul class="invite-friends">${friends}</ul>` : ''}
    <button type="button" class="pill-button pill-button--solid invite-share" data-invite-share>친구 초대 링크 보내기</button>
    <small class="invite-fine">같은 기기에서 만든 계정은 보상이 없어요. 한 달에 ${inv.cap}명까지 받아요.</small>`;
  box.querySelector('[data-invite-share]').addEventListener('click', () => shareFriendInvite({ reward: `${formatCH(inv.reward)}원`, toast }));
  root.replaceChildren(box);
}
