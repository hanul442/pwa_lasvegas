// Sign-in gate: every visitor plays with their own account (username + password).
import { api, errorMessage, saveSession, playerId } from './api.js';
import { pendingRef, dropPendingRef, pendingJoin } from './invite.js';
import { formatCH } from './fx.js';
import { el } from './fx.js';
import { mountInstallButton } from './install.js';
import { openTerms, markAgreed } from './terms.js';

let gate = null;

export function isGateOpen() { return Boolean(gate); }

// Shows the sign-in screen over the app; onSignedIn gets the server state of the signed-in player.
export function openSignIn(onSignedIn, { mode = 'login', notice = '' } = {}) {
  if (gate) return;
  gate = el('section', 'auth-gate');
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'auth-title');
  document.body.append(gate);
  document.body.classList.add('auth-mode');
  let claimable = [];
  api.authOptions().then(out => { claimable = out.claimable || []; if (gate) render(); }).catch(() => {});
  // A friend's invite link: who sent it, shown above the 바로 플레이 button.
  const ref = pendingRef();
  const join = pendingJoin();
  let invite = null;
  if (ref) api.inviteInfo(ref).then(out => { invite = out; if (gate && mode !== 'reset') render(); }).catch(() => {});
  // A phone that never signed in here gets 가입 없이 바로 플레이 first; a returning player the login.
  const fresh = !playerId() || Boolean(ref || join);
  const GAME_NAMES = { holdem: '홀덤', seotda: '섯다', gostop: '고스톱', matgo: '맞고', blackjack: '블랙잭', baccarat: '바카라' };
  const inviteLine = () => {
    const who = invite?.inviter ? `<span><b>${invite.inviter}</b>님이 초대했어요</span>` : join || ref ? '<span>친구가 초대했어요</span>' : '';
    if (!who) return '';
    const where = join ? `${GAME_NAMES[join.game] || ''} 방 ${join.code}에 바로 앉아요.` : '';
    const reward = ref && invite?.reward ? ` 첫 판을 끝내면 둘 다 ${formatCH(invite.reward)}원.` : '';
    return `<p class="auth-invite">${who}<small>${where}${reward}</small></p>`;
  };
  const guestBlock = () => `
        <div class="auth-guest">
          ${inviteLine()}
          <button class="pill-button pill-button--solid auth-guest-go" type="button" data-guest>가입 없이 바로 플레이</button>
          <small class="auth-guest-note">시작하면 만 19세 이상이며 <button type="button" class="auth-link" data-terms>이용약관</button>에 동의한 걸로 봐요. 칩은 현금 가치가 없어요.</small>
        </div>
        <div class="auth-or"><span>${mode === 'signup' ? '또는 바로 계정 만들기' : '계정이 있다면'}</span></div>`;
  async function startGuest(btn) {
    btn.disabled = true;
    try {
      const out = await api.guest(ref || undefined);
      markAgreed();
      dropPendingRef();
      saveSession(out.token, out.state.user.id);
      close();
      onSignedIn(out.state);
    } catch (err) {
      btn.disabled = false;
      gate.querySelector('.auth-error').textContent = errorMessage(err);
      if (err.code === 'GUESTS_FULL' || err.code === 'GUEST_LIMIT') { mode = 'signup'; render(errorMessage(err)); }
    }
  }

  function render(error = '') {
    if (mode === 'reset') return renderReset(error);
    const signup = mode === 'signup';
    const claim = signup ? claimable[0] : null;
    gate.innerHTML = `
      <div class="auth-card">
        <img class="auth-logo" src="logo.svg" alt="VEGAS" width="132" height="28">
        <h1 id="auth-title">${fresh && !signup ? 'VEGAS에 어서 오세요' : signup ? '새 계정 만들기' : '로그인'}</h1>
        <p class="auth-lede">${fresh && !signup && !notice ? '가입 없이 바로 앉아요. 이름은 이기고 나서 정해도 칩이 그대로 남아요.' : signup ? '칩과 기록은 이 계정에 저장돼서 어느 기기에서든 이어서 할 수 있어요.' : notice || '내 계정으로 들어가서 칩과 기록을 이어가요.'}</p>
        ${fresh ? guestBlock() : ''}
        <form class="auth-form" novalidate>
          <label class="auth-field"><span>이름</span>
            <input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="12" required>
            ${signup ? '<small>랭킹에 보이는 이름이에요. 한글·영문·숫자 2~12자.</small>' : ''}</label>
          <label class="auth-field"><span>비밀번호</span>
            <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="72" required>
            ${signup ? '<small>6자 이상.</small>' : '<small><button type="button" class="auth-link" data-forgot>비밀번호를 잊었어요</button></small>'}</label>
          ${claim ? `<label class="auth-claim"><input type="checkbox" name="claim" value="${claim.id}"><span><b>${claim.nickname} 기록 이어받기</b><small>지금까지 ${claim.nickname} 프로필에 쌓인 칩과 전적을 이 계정으로 가져와요. 한 계정만 이어받을 수 있어요.</small></span></label>` : ''}
          ${signup ? '<label class="auth-claim auth-terms"><input type="checkbox" name="terms" required><span><b>만 19세 이상이며 이용약관에 동의해요</b><small><button type="button" class="auth-link" data-terms>이용약관 보기</button></small></span></label>' : ''}
          <p class="auth-error" role="alert">${error}</p>
          <button class="pill-button pill-button--solid auth-submit" type="submit">${signup ? '계정 만들기' : '로그인'}</button>
        </form>
        <p class="auth-switch">${signup ? '이미 계정이 있나요?' : '처음 왔나요?'} <button type="button" data-auth-mode>${signup ? '로그인하기' : '새 계정 만들기'}</button></p>
        ${fresh ? '' : '<p class="auth-switch">계정 없이 해 보려면 <button type="button" data-guest>가입 없이 바로 플레이</button></p>'}
        <button class="pill-button auth-install" type="button" data-auth-install hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>홈 화면에 앱 설치</button>
      </div>`;
    mountInstallButton(gate.querySelector('[data-auth-install]'));
    const form = gate.querySelector('form');
    gate.querySelector('[data-forgot]')?.addEventListener('click', () => { mode = 'reset'; render(); gate.querySelector('input')?.focus(); });
    gate.querySelectorAll('[data-terms]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); openTerms(); }));
    gate.querySelector('[data-guest]')?.addEventListener('click', e => startGuest(e.currentTarget));
    gate.querySelector('[data-auth-mode]').addEventListener('click', () => { mode = signup ? 'login' : 'signup'; render(); gate.querySelector('input')?.focus(); });
    form.querySelectorAll('input').forEach(input => input.addEventListener('input', () => { gate.querySelector('.auth-error').textContent = ''; }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const username = form.username.value.trim(), password = form.password.value;
      const submit = form.querySelector('.auth-submit');
      if (signup && !form.terms.checked) { gate.querySelector('.auth-error').textContent = '만 19세 이상인지, 이용약관에 동의하는지 체크해 주세요.'; form.terms.focus(); return; }
      submit.disabled = true;
      try {
        const out = signup ? await api.signup(username, password, form.claim?.checked ? form.claim.value : undefined, ref || undefined) : await api.login(username, password);
        if (signup) { markAgreed(); dropPendingRef(); }
        saveSession(out.token, out.state.user.id);
        close();
        onSignedIn(out.state);
      } catch (err) {
        submit.disabled = false;
        gate.querySelector('.auth-error').textContent = errorMessage(err);
        (err.code === 'USERNAME_TAKEN' || err.code === 'INVALID_USERNAME' ? form.username : form.password).focus();
      }
    });
  }
  // 비밀번호 찾기: accounts have no email, so the way back is the recovery code the player made
  // in their profile, or a temporary password from the operator.
  function renderReset(error = '') {
    gate.innerHTML = `
      <div class="auth-card">
        <img class="auth-logo" src="logo.svg" alt="VEGAS" width="132" height="28">
        <h1 id="auth-title">비밀번호 찾기</h1>
        <p class="auth-lede">프로필에서 만들어 둔 복구 코드로 새 비밀번호를 정해요.</p>
        <form class="auth-form" novalidate>
          <label class="auth-field"><span>이름</span>
            <input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="12" required></label>
          <label class="auth-field"><span>복구 코드</span>
            <input name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="ABCD-EFGH-JKLM" required>
            <small>복구 코드는 한 번 쓰면 사라져요. 로그인한 뒤 프로필에서 새로 만들어 두세요.</small></label>
          <label class="auth-field"><span>새 비밀번호</span>
            <input name="password" type="password" autocomplete="new-password" maxlength="72" required>
            <small>6자 이상.</small></label>
          <p class="auth-error" role="alert">${error}</p>
          <button class="pill-button pill-button--solid auth-submit" type="submit">새 비밀번호로 로그인</button>
        </form>
        <p class="auth-note">복구 코드를 만들어 두지 않았다면 운영자에게 임시 비밀번호를 받아 로그인한 뒤, 프로필에서 비밀번호를 바꿔 주세요.</p>
        <p class="auth-switch">비밀번호가 기억났나요? <button type="button" data-auth-mode>로그인하기</button></p>
      </div>`;
    const form = gate.querySelector('form');
    gate.querySelector('[data-auth-mode]').addEventListener('click', () => { mode = 'login'; render(); gate.querySelector('input')?.focus(); });
    form.querySelectorAll('input').forEach(input => input.addEventListener('input', () => { gate.querySelector('.auth-error').textContent = ''; }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const submit = form.querySelector('.auth-submit');
      submit.disabled = true;
      try {
        const out = await api.resetPassword(form.username.value.trim(), form.code.value, form.password.value);
        saveSession(out.token, out.state.user.id);
        close();
        onSignedIn(out.state);
      } catch (err) {
        submit.disabled = false;
        gate.querySelector('.auth-error').textContent = errorMessage(err);
        (err.code === 'INVALID_PASSWORD' ? form.password : err.code === 'INVALID_USERNAME' ? form.username : form.code).focus();
      }
    });
  }
  render();
  requestAnimationFrame(() => gate?.querySelector('input')?.focus({ preventScroll: true }));
}

function close() {
  gate?.remove();
  gate = null;
  document.body.classList.remove('auth-mode');
}
