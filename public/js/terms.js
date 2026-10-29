// 이용약관: what the chips are (and are not), who may play, and where to get help.
// New accounts agree on the sign-up form; existing players agree once per version after signing in.
import { el } from './fx.js';
import { remember } from './seen.js';

export const TERMS_VERSION = '2026-10-13';
const KEY = 'vegas:terms';

export const HELPLINE = { name: '한국도박문제예방치유원', phone: '1336', url: 'https://www.kcgp.or.kr' };

export function termsAgreed() {
  try { return localStorage.getItem(KEY) === TERMS_VERSION; } catch { return false; }
}
export function markAgreed() {
  remember(KEY, TERMS_VERSION);
}

const SECTIONS = [
  ['제1조 서비스의 성격', [
    'VEGAS는 친구들끼리 즐기는 비영리 소셜 카지노 게임이에요. 판돈은 모두 현금 가치가 없는 가상 칩이에요.',
    '칩은 돈으로 살 수 없고, 현금·상품권·재화로 바꾸거나 다른 사람에게 팔 수 없어요. 어떤 게임 결과에도 경품이나 현금 보상은 없어요.',
    '게임 결과물을 환전하거나 환전을 알선·재매입하는 행위는 게임산업진흥에 관한 법률 제32조 제1항 제7호로 금지돼 있고, 이 서비스는 그런 방법을 제공하지 않아요.'
  ]],
  ['제2조 이용 자격', [
    '카지노·화투 게임을 소재로 하므로 만 19세 이상만 이용할 수 있어요.',
    '계정을 만들 때 만 19세 이상이며 이 약관에 동의한다고 확인해요.'
  ]],
  ['제3조 계정', [
    '계정은 이름과 비밀번호로 만들어요. 비밀번호는 서버에 원문 그대로 저장하지 않고 암호화(해시)해서 보관해요.',
    '계정을 다른 사람과 같이 쓰거나 빌려주지 마세요. 비밀번호 관리는 본인 책임이에요.'
  ]],
  ['제4조 금지 행위', [
    '칩·계정을 현금이나 재화와 거래하거나 그런 거래를 제안하는 행위.',
    '버그나 오류를 일부러 이용하거나 자동화 프로그램으로 플레이하는 행위.',
    '다른 이용자를 속이거나 괴롭히는 행위, 다른 사람인 척하는 행위.',
    '위반하면 운영자가 칩을 회수하거나 계정 이용을 제한할 수 있어요.'
  ]],
  ['제5조 칩과 기록', [
    '칩·RP·랭킹 같은 게임 안 기록은 게임을 위한 데이터일 뿐 재산이 아니에요.',
    '게임 균형이나 오류 수정을 위해 운영자가 칩과 기록을 조정하거나 초기화할 수 있고, 이에 대한 보상은 없어요.'
  ]],
  ['제6조 개인정보', [
    '모으는 정보: 이름(닉네임), 암호화된 비밀번호, 게임 기록, 알림을 켠 경우 푸시 알림 주소.',
    '쓰는 곳: 로그인, 게임 진행, 랭킹 표시, 알림 보내기. 그 밖의 목적으로 쓰거나 제3자에게 주지 않아요.',
    '플레이 시간과 하루 한도, 소리 같은 설정은 서버가 아니라 이 기기에만 저장돼요.',
    '계정 삭제를 원하면 운영자에게 알려 주세요. 해당 계정의 정보를 지워요.'
  ]],
  ['제7조 건강한 이용', [
    '쉬지 않고 1시간을 플레이할 때마다 이용 시간과 함께 "과도한 게임이용은 정상적인 일상생활에 지장을 줄 수 있습니다."라는 안내가 나와요(게임산업진흥에 관한 법률 시행령 제8조의3 제7항·제8항의 기준을 따라요).',
    '설정 > 건강한 이용에서 하루 플레이 한도를 정할 수 있어요. 한도를 다 쓰면 그날은 테이블에 앉을 수 없어요. 한도를 줄이면 바로, 늘리거나 끄면 다음 날부터 적용돼요.',
    `게임이 일상을 방해한다고 느껴지면 ${HELPLINE.name} 헬프라인(국번 없이 ${HELPLINE.phone}, 24시간 무료)에서 상담받을 수 있어요.`
  ]],
  ['제8조 서비스 변경과 중단', [
    '개인이 운영하는 서비스라 기능이 바뀌거나, 점검·장애로 멈추거나, 운영이 끝날 수 있어요. 가능하면 미리 앱 안에서 알려요.',
    '약관이 바뀌면 다음 로그인 때 바뀐 약관을 보여 주고 다시 동의를 받아요.'
  ]]
];

export function termsHTML() {
  return SECTIONS.map(([title, items]) => `<section class="terms-section"><h3>${title}</h3><ol>${items.map(t => `<li>${t}</li>`).join('')}</ol></section>`).join('') +
    `<p class="terms-date">시행일 ${TERMS_VERSION.replace(/-/g, '. ')}.</p>`;
}

let open = null;

// consent: blocks the app until the player agrees (age + terms); onAgree runs after.
export function openTerms({ consent = false, onAgree = null } = {}) {
  if (open) return;
  const back = document.activeElement;
  const node = el('section', 'terms-gate');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-labelledby', 'terms-title');
  node.innerHTML = `
    <div class="terms-card">
      <div class="terms-head">
        <h2 id="terms-title" tabindex="-1">${consent ? '이용약관이 생겼어요' : '이용약관'}</h2>
        ${consent ? '' : '<button type="button" class="sheet-close" data-terms-close>닫기</button>'}
      </div>
      ${consent ? '<p class="terms-lede">계속 이용하려면 아래 내용을 읽고 동의해 주세요.</p>' : ''}
      <div class="terms-body" tabindex="0">${termsHTML()}</div>
      ${consent ? `<div class="terms-foot">
        <label class="auth-claim terms-check"><input type="checkbox" data-terms-check><span><b>만 19세 이상이며 이용약관에 동의해요</b></span></label>
        <button type="button" class="pill-button pill-button--solid terms-agree" data-terms-agree disabled>동의하고 계속하기</button>
      </div>` : ''}
    </div>`;
  document.body.append(node);
  document.body.classList.add('terms-mode');
  open = node;
  const close = () => {
    node.remove();
    open = null;
    document.body.classList.remove('terms-mode');
    removeEventListener('keydown', onKey, true);
    back?.focus?.({ preventScroll: true });
  };
  const onKey = e => { if (e.key === 'Escape' && !consent) { e.stopImmediatePropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-terms-close]')?.addEventListener('click', close);
  const check = node.querySelector('[data-terms-check]');
  const agree = node.querySelector('[data-terms-agree]');
  check?.addEventListener('change', () => { agree.disabled = !check.checked; });
  agree?.addEventListener('click', () => { markAgreed(); close(); onAgree?.(); });
  requestAnimationFrame(() => node.querySelector('#terms-title').focus({ preventScroll: true }));
}

// After sign-in: ask once per terms version on this device.
export function ensureTerms() {
  if (!termsAgreed()) openTerms({ consent: true });
}
