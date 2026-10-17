// Profile → 계정: change the password and make a recovery code for 비밀번호 찾기.
import { api, errorMessage, saveSession } from './api.js';
import { el } from './fx.js';

// The code is shown once; it survives the profile re-rendering until the player leaves the screen.
let shownCode = '';

export function renderAccountTools(root, state, onChanged) {
  if (!state?.username) return;
  const box = el('div', 'account-tools');
  box.innerHTML = `
    <div class="account-tool">
      <div><b>복구 코드</b><small>${state.hasRecovery ? '만들어 둔 코드가 있어요. 새로 만들면 예전 코드는 못 써요.' : '비밀번호를 잊었을 때 이 코드로 새 비밀번호를 정해요.'}</small></div>
      <button type="button" class="pill-button" data-recovery>${state.hasRecovery ? '새로 만들기' : '만들기'}</button>
    </div>
    <div class="account-code" data-code ${shownCode ? '' : 'hidden'}>
      <code>${shownCode}</code>
      <button type="button" class="pill-button" data-copy>복사</button>
      <small>지금만 보여요. 캡처하거나 메모해 두세요.</small>
    </div>
    <details class="account-tool account-password">
      <summary><b>비밀번호 바꾸기</b><small>운영자에게 받은 임시 비밀번호도 여기서 바꿔요.</small></summary>
      <form novalidate>
        <label class="auth-field"><span>지금 비밀번호</span><input name="current" type="password" autocomplete="current-password" maxlength="72" required></label>
        <label class="auth-field"><span>새 비밀번호</span><input name="password" type="password" autocomplete="new-password" maxlength="72" required><small>6자 이상. 다른 기기는 로그아웃돼요.</small></label>
        <p class="auth-error" role="alert"></p>
        <button type="submit" class="pill-button pill-button--solid">비밀번호 바꾸기</button>
      </form>
    </details>`;
  const make = box.querySelector('[data-recovery]');
  make.addEventListener('click', async () => {
    make.disabled = true;
    try {
      const out = await api.makeRecoveryCode();
      shownCode = out.code;
      onChanged(out.state);
    } catch (err) { make.disabled = false; make.textContent = errorMessage(err); }
  });
  box.querySelector('[data-copy]').addEventListener('click', async e => {
    try { await navigator.clipboard.writeText(shownCode); e.target.textContent = '복사했어요'; } catch { e.target.textContent = '길게 눌러 복사해 주세요'; }
  });
  const form = box.querySelector('form');
  const error = form.querySelector('.auth-error');
  form.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { error.textContent = ''; error.classList.remove('is-ok'); }));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const out = await api.changePassword(form.current.value, form.password.value);
      saveSession(out.token, out.state.user.id);
      form.reset();
      error.textContent = '비밀번호를 바꿨어요.';
      error.classList.add('is-ok');
    } catch (err) {
      error.textContent = err.code === 'BAD_CREDENTIALS' ? '지금 비밀번호가 맞지 않아요.' : errorMessage(err);
      (err.code === 'BAD_CREDENTIALS' ? form.current : form.password).focus();
    }
    submit.disabled = false;
  });
  root.append(box);
}

// Leaving the profile hides the code for good.
export function forgetShownCode() { shownCode = ''; }
