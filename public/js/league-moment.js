// 주간 리그 결과 (2026-10-30, 한서 "연출 ㄱ"): the first look after a week closes plays how it
// ended. Moving up, the old league's crest lifts away and the new one drops in with a ring and
// sparks (the same gold as the RP popup's promotion, js/rp-pop.js); moving down, the crest sinks
// and dims; staying, it just settles. A podium finish shows the badge it earned.
// Once per week per account (js/seen.js syncs the mark), and on demand from the 리그 tab.
import { el, sound, haptic, rollNumber, reducedMotion, ms } from './fx.js';
import { remember } from './seen.js';

const LEAGUE_IDS = ['rookie', 'pro', 'elite', 'master', 'champion'];
const MEDALS = ['', '1위', '2위', '3위'];

// A shield with one chevron per league step; 챔피언 is the only gold one.
export function leagueCrest(id, { size = 56, label = '' } = {}) {
  const n = Math.max(0, LEAGUE_IDS.indexOf(id)), k = n + 1;
  const chevrons = Array.from({ length: k }, (_, i) => {
    const y = 29 - (k - 1) * 2.6 + i * 5.2;
    return `<path class="league-crest-chev" d="M16 ${y} 24 ${y - 4} 32 ${y}"/>`;
  }).join('');
  return `<svg class="league-crest league-crest--${LEAGUE_IDS[n]}" width="${size}" height="${size}" viewBox="0 0 48 48" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><path class="league-crest-face" d="M24 3 41 9v14c0 11-7.4 18.6-17 22C14.4 41.6 7 34 7 23V9z"/><path class="league-crest-shine" d="M24 3 41 9v6L24 9 7 15V9z"/>${chevrons}</svg>`;
}

const weekLabel = week => {
  const d = String(week || '').replace('league-', '');
  const t = Date.parse(`${d}T00:00:00+09:00`);
  return Number.isFinite(t) ? `${new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' })} 주` : '지난주';
};

// Opens once for the last finished week. Returns true when it opened.
export function maybeLeagueMoment(state, { force = false, onLeague } = {}) {
  const last = state?.league?.last;
  if (!last || !state.user || state.user.guest || !last.fromId) return false;
  const key = `vegas:league-moment:${last.week}:${state.user.id}`;
  if (!force) {
    try { if (localStorage.getItem(key)) return false; } catch { return false; }
    // Only the week that just closed: an old result waiting since a long break isn't news.
    if (Date.now() - Date.parse(`${String(last.week).replace('league-', '')}T00:00:00+09:00`) > 15 * 86_400_000) { remember(key, '1'); return false; }
    remember(key, '1');
  }
  const up = last.move > 0, down = last.move < 0;
  const motion = !reducedMotion();
  const verdict = up ? '승급!' : down ? '강등' : '잔류';
  const head = up ? `${last.toName}로 올라가요` : down ? `${last.toName}로 내려가요` : `${last.fromName}에 남아요`;
  const note = up ? (last.toId === 'champion' ? '맨 위 리그예요. 이번 주엔 1위를 노려 보세요.' : '이번 주도 상위 5명이면 한 번 더 올라가요.')
    : down ? '이번 주 상위 5명에 들면 바로 다시 올라가요.'
    : last.fromId === 'champion' ? '챔피언 리그 자리를 지켰어요.' : '상위 5명이면 승급, 하위 5명이면 강등이에요.';
  const node = el('div', `floor-moment league-moment${up ? ' is-up' : down ? ' is-down' : ' is-stay'}`);
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', `주간 리그 결과: ${last.fromName} ${last.rank}위, ${verdict}`);
  const crests = up || down
    ? `<span class="league-moment-crest is-from">${leagueCrest(last.fromId, { size: 92 })}</span><span class="league-moment-crest is-to">${leagueCrest(last.toId, { size: 92 })}<i class="rp-pop-ring"></i><i class="rp-pop-sparks">${'<b></b>'.repeat(8)}</i></span>`
    : `<span class="league-moment-crest is-to">${leagueCrest(last.fromId, { size: 92 })}</span>`;
  node.innerHTML = `<div class="floor-moment-inner">
    <p class="league-moment-kicker">${weekLabel(last.week)} 주간 리그 결과</p>
    <div class="league-moment-stage" aria-hidden="true">${crests}</div>
    <span class="league-moment-verdict">${verdict}</span>
    <h2>${head}</h2>
    <dl class="league-moment-stats">
      <div><dt>${last.fromName}</dt><dd><b data-rank>${motion ? last.of : last.rank}</b><small>위 / ${last.of}명</small></dd></div>
      <div><dt>주간 RP</dt><dd><b data-score>${motion ? 0 : last.score}</b><small>RP</small></dd></div>
    </dl>
    ${last.badge ? `<p class="league-moment-badge">${leagueCrest(last.fromId, { size: 22 })}<span><b>${last.fromName} ${MEDALS[last.rank]} 배지</b><small>프로필 배지에 추가됐어요</small></span></p>` : ''}
    <p class="league-moment-note">${note}</p>
    <div class="moment-actions">${onLeague ? '<button type="button" class="pill-button pill-button--solid" data-league>이번 주 리그 보기</button>' : ''}<button type="button" class="pill-button${onLeague ? '' : ' pill-button--solid'}" data-close>${force ? '닫기' : '확인'}</button></div></div>`;
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('is-open'));
  if (motion) {
    rollNumber(node.querySelector('[data-rank]'), last.of, last.rank, { duration: ms(900), format: v => `${Math.round(v)}` });
    rollNumber(node.querySelector('[data-score]'), 0, last.score, { duration: ms(900), format: v => `${Math.round(v)}` });
    // The move plays once the numbers land.
    setTimeout(() => { if (node.isConnected) play(); }, ms(1000));
  } else play();
  function play() {
    node.classList.add('is-played');
    if (!force && up) { sound.levelUp?.(last.toId === 'champion' ? 3 : 2); haptic([20, 40, 20, 40, 80]); }
    else if (!force && down) haptic(40);
    else if (!force) sound.tick?.();
  }
  const close = () => { node.classList.remove('is-open'); setTimeout(() => node.remove(), 400); removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  node.querySelector('[data-close]').addEventListener('click', close);
  node.querySelector('[data-league]')?.addEventListener('click', () => { close(); onLeague(); });
  node.querySelector('.moment-actions button').focus({ preventScroll: true });
  return true;
}
