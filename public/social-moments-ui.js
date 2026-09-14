function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function fmtChips(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '0';
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  const rest = Math.floor(n % 10_000);
  let out = eok ? `${eok.toLocaleString()}억` : '';
  if (man) out += `${out ? ' ' : ''}${man.toLocaleString()}만`;
  if (!out && rest) out = rest.toLocaleString();
  return out || '0';
}

function validMoment(moment) {
  if (!moment || typeof moment !== 'object') return false;
  if (!['MAJOR_WIN', 'BANKRUPTCY'].includes(moment.type)) return false;
  if (typeof moment.id !== 'string' || typeof moment.game !== 'string') return false;
  if (!moment.actor || typeof moment.actor.nickname !== 'string') return false;
  if (typeof moment.occurredAt !== 'string' || !Number.isFinite(Date.parse(moment.occurredAt))) return false;
  if (moment.type === 'MAJOR_WIN') return Number.isSafeInteger(moment.chips) && moment.chips >= 0;
  return Number.isSafeInteger(moment.chipsLost) && moment.chipsLost >= 0;
}

function safeComparisonCard(moment) {
  const card = moment?.comparisonCard;
  if (!moment?.comparisonCardAvailable || !card || card.kind !== 'ILLUSTRATIVE_SCALE') return null;
  if (!Array.isArray(card.items) || card.items.length === 0) return null;
  const items = card.items
    .filter(item => item && typeof item.slug === 'string' && typeof item.name === 'string' && typeof item.emoji === 'string')
    .map(item => ({ slug: item.slug, name: item.name, emoji: item.emoji }))
    .slice(0, 4);
  if (!items.length) return null;
  return { kind: 'ILLUSTRATIVE_SCALE', items };
}

export function socialMomentsSurfaceModel(snapshot) {
  const policy = snapshot?.policy;
  const policySafe = snapshot?.mode === 'READ_ONLY'
    && policy?.cashEquivalent === false
    && policy?.exchangeRate === false
    && policy?.redeemable === false;

  if (!policySafe) return { enabled: false, moments: [] };

  const moments = Array.isArray(snapshot.moments)
    ? snapshot.moments.filter(validMoment).slice(0, 12).map(moment => ({
      id: moment.id,
      type: moment.type,
      actor: {
        id: typeof moment.actor.id === 'string' ? moment.actor.id : '',
        nickname: moment.actor.nickname,
        accent: typeof moment.actor.accent === 'string' ? moment.actor.accent : '•'
      },
      game: moment.game,
      occurredAt: moment.occurredAt,
      ...(moment.type === 'MAJOR_WIN' ? { chips: moment.chips } : { chipsLost: moment.chipsLost }),
      ...(moment.type === 'BANKRUPTCY' && safeComparisonCard(moment) ? { comparisonCard: safeComparisonCard(moment) } : {})
    }))
    : [];

  return { enabled: true, moments };
}

function ago(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}초 전`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}

function comparisonHtml(card) {
  if (!card) return '';
  return `<div class="moment-comparison"><small>ILLUSTRATIVE SCALE · 환율/현금가치 아님</small><div>${card.items.map(item => `<span title="${esc(item.slug)}">${esc(item.emoji)} ${esc(item.name)}</span>`).join('')}</div></div>`;
}

function momentHtml(moment) {
  const win = moment.type === 'MAJOR_WIN';
  return `<article class="social-moment ${win ? 'major-win' : 'bankruptcy'}">
    <div class="moment-top"><span class="moment-avatar">${esc(moment.actor.accent)}</span><div><b>${esc(moment.actor.nickname)}</b><small>${esc(moment.game)} · ${ago(moment.occurredAt)}</small></div><i>${win ? 'MAJOR WIN' : 'BANKRUPTCY'}</i></div>
    <strong>${win ? '+' : '-'}${fmtChips(win ? moment.chips : moment.chipsLost)} CH</strong>
    ${comparisonHtml(moment.comparisonCard)}
  </article>`;
}

function surfaceHtml(model) {
  if (!model.enabled) return '';
  return `<section id="social-moments-surface" class="social-moments-surface" aria-label="Major social moments">
    <div class="section-title"><div><small>SOCIAL MOMENTS</small><h2>Big wins & busts</h2></div><span>READ ONLY</span></div>
    ${model.moments.length ? `<div class="social-moments-grid">${model.moments.map(momentHtml).join('')}</div>` : '<article class="card social-moments-empty"><b>No major moments yet.</b><p>Major wins and bankruptcies will appear here from canonical game records.</p></article>'}
    <p class="social-moments-disclaimer">CH는 오직 가상 게임 칩입니다. 현금 가치·환율·입금·출금·환전·cash-out 기능이 없습니다.</p>
  </section>`;
}

async function fetchState() {
  const playerId = localStorage.getItem('sv-player') || 'hanseo';
  const response = await fetch('/api/state', { headers: { 'x-player-id': playerId } });
  if (!response.ok) throw new Error('SOCIAL_MOMENTS_STATE_FAILED');
  return response.json();
}

let decorating = false;
async function decorateHomeMoments() {
  if (decorating) return;
  const content = document.querySelector('.content');
  const heading = content?.querySelector('.head h1');
  if (!content || !heading?.textContent?.includes('welcome back')) return;
  if (content.querySelector('#social-moments-surface')) return;

  decorating = true;
  try {
    const state = await fetchState();
    const model = socialMomentsSurfaceModel(state?.socialCompetition?.socialMoments);
    const html = surfaceHtml(model);
    if (!html) return;
    const anchor = content.querySelector('.progress-card') || content.querySelector('.metrics');
    anchor?.insertAdjacentHTML('afterend', html);
  } catch {
    // Read-only enhancement only. The existing home UI remains untouched if state is unavailable.
  } finally {
    decorating = false;
  }
}

if (typeof document !== 'undefined') {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(async () => {
      scheduled = false;
      await decorateHomeMoments();
    });
  };
  addEventListener('DOMContentLoaded', schedule, { once: true });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
}
