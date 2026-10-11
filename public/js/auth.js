// Sign-in gate: every visitor plays with their own account (username + password).
import { api, errorMessage, saveSession } from './api.js';
import { el } from './fx.js';

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

  function render(error = '') {
    const signup = mode === 'signup';
    const claim = signup ? claimable[0] : null;
    gate.innerHTML = `
      <div class="auth-card">
        <img class="auth-logo" src="logo.svg" alt="VEGAS" width="132" height="28">
        <h1 id="auth-title">${signup ? '새 계정 만들기' : '로그인'}</h1>
        <p class="auth-lede">${signup ? '칩과 기록은 이 계정에 저장돼서 어느 기기에서든 이어서 할 수 있어요.' : notice || '내 계정으로 들어가서 칩과 기록을 이어가요.'}</p>
        <form class="auth-form" novalidate>
          <label class="auth-field"><span>이름</span>
            <input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="12" required>
            ${signup ? '<small>랭킹에 보이는 이름이에요. 한글·영문·숫자 2~12자.</small>' : ''}</label>
          <label class="auth-field"><span>비밀번호</span>
            <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="72" required>
            ${signup ? '<small>6자 이상.</small>' : ''}</label>
          ${claim ? `<label class="auth-claim"><input type="checkbox" name="claim" value="${claim.id}"><span><b>${claim.nickname} 기록 이어받기</b><small>지금까지 ${claim.nickname} 프로필에 쌓인 칩과 전적을 이 계정으로 가져와요. 한 계정만 이어받을 수 있어요.</small></span></label>` : ''}
          <p class="auth-error" role="alert">${error}</p>
          <button class="pill-button pill-button--solid auth-submit" type="submit">${signup ? '계정 만들기' : '로그인'}</button>
        </form>
        <p class="auth-switch">${signup ? '이미 계정이 있나요?' : '처음 왔나요?'} <button type="button" data-auth-mode>${signup ? '로그인하기' : '새 계정 만들기'}</button></p>
      </div>`;
    const form = gate.querySelector('form');
    gate.querySelector('[data-auth-mode]').addEventListener('click', () => { mode = signup ? 'login' : 'signup'; render(); gate.querySelector('input')?.focus(); });
    form.querySelectorAll('input').forEach(input => input.addEventListener('input', () => { gate.querySelector('.auth-error').textContent = ''; }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const username = form.username.value.trim(), password = form.password.value;
      const submit = form.querySelector('.auth-submit');
      submit.disabled = true;
      try {
        const out = signup ? await api.signup(username, password, form.claim?.checked ? form.claim.value : undefined) : await api.login(username, password);
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
  render();
  requestAnimationFrame(() => gate?.querySelector('input')?.focus({ preventScroll: true }));
}

function close() {
  gate?.remove();
  gate = null;
  document.body.classList.remove('auth-mode');
}
