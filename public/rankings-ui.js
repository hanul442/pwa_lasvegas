let rankingView = 'allTime';

const BOARD_META = {
  wealth: { label: 'WEALTH', signed: false },
  profit: { label: 'QUALIFIED PROFIT', signed: true },
  highRoller: { label: 'HIGH ROLLER', signed: false },
  wins: { label: 'WINS', signed: false }
};

const RECORD_META = {
  wealth: 'WEALTH',
  profit: 'QUALIFIED PROFIT',
  highRoller: 'HIGH ROLLER',
  peakBankroll: 'PEAK BANKROLL'
};

export function rankingSurfaceModel(rankings, requestedView = 'allTime') {
  const allTime = rankings?.allTime ?? {
    wealth: rankings?.wealth ?? [],
    profit: rankings?.profit ?? [],
    highRoller: rankings?.highRoller ?? []
  };
  const season = rankings?.season ?? null;
  const vip = rankings?.records?.vip ?? null;
  const view = requestedView === 'season' && !season ? 'allTime' : requestedView;
  return {
    view,
    allTime,
    season,
    vip,
    seasonAvailable: Boolean(season),
    vipAvailable: Boolean(vip)
  };
}

function fmt(n, sign = false) {
  n = Number(n || 0);
  const neg = n < 0;
  const x = Math.abs(n);
  const e = Math.floor(x / 1e8);
  const m = Math.floor((x % 1e8) / 1e4);
  const r = Math.floor(x % 1e4);
  let out = e ? `${e.toLocaleString()}억` : '';
  if (m) out += `${out ? ' ' : ''}${m.toLocaleString()}만`;
  if (!out && r) out = r.toLocaleString();
  if (!out) out = '0';
  return `${neg ? '-' : sign && n > 0 ? '+' : ''}${out}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function board(key, rows, currentUserId, valueSuffix = 'CH') {
  const meta = BOARD_META[key] ?? { label: key.toUpperCase(), signed: false };
  return `<article class="card ranking-board"><div class="section-title"><h2>${meta.label}</h2></div><table><tbody>${(rows ?? []).map(row => `<tr class="${row.id === currentUserId ? 'me' : ''}"><td>#${row.rank}</td><td>${esc(row.nickname)}</td><td>${key === 'wins' ? Number(row.value || 0).toLocaleString() : `${fmt(row.value, meta.signed)} ${valueSuffix}`}</td></tr>`).join('')}</tbody></table></article>`;
}

function allTimeSurface(model, currentUserId) {
  return `<div class="ranking-grid">${board('wealth', model.allTime.wealth, currentUserId)}${board('profit', model.allTime.profit, currentUserId)}${board('highRoller', model.allTime.highRoller, currentUserId)}</div>`;
}

function seasonSurface(model, currentUserId) {
  if (!model.season) return '<article class="card ranking-empty"><b>SEASON COMING SOON</b><p>Canonical season data is not active yet. Bankroll is never reset or synthesized for this view.</p></article>';
  const s = model.season;
  return `<article class="card ranking-season-head"><span>HYBRID SEASON</span><h2>${esc(s.name)}</h2><p>Bankroll carries over · season performance resets</p></article><div class="ranking-grid">${board('profit', s.profit, currentUserId)}${board('highRoller', s.highRoller, currentUserId)}${board('wins', s.wins, currentUserId, '')}</div>`;
}

function vipSurface(model) {
  if (!model.vip) return '<article class="card ranking-empty"><b>VIP RECORDS LOCKED</b><p>No player has a canonical top-floor record yet.</p></article>';
  return `<div class="vip-record-grid">${Object.entries(RECORD_META).map(([key, label]) => {
    const record = model.vip[key];
    if (!record) return '';
    const signed = key === 'profit';
    return `<article class="card vip-record"><span>${label}</span><h2>${esc(record.nickname)}</h2><b>${fmt(record.value, signed)} CH</b><small>TOP-FLOOR RECORD</small></article>`;
  }).join('')}</div>`;
}

function surfaceHtml(state) {
  const model = rankingSurfaceModel(state.rankings, rankingView);
  rankingView = model.view;
  const content = model.view === 'season'
    ? seasonSurface(model, state.user.id)
    : model.view === 'vip'
      ? vipSurface(model)
      : allTimeSurface(model, state.user.id);
  return `<section id="ranking-surfaces" class="ranking-surfaces"><div class="ranking-tabs" role="tablist" aria-label="Ranking view"><button type="button" data-ranking-view="allTime" class="${model.view === 'allTime' ? 'active' : ''}">ALL-TIME</button><button type="button" data-ranking-view="season" class="${model.view === 'season' ? 'active' : ''}" ${model.seasonAvailable ? '' : 'disabled'}>SEASON${model.seasonAvailable ? '' : ' · SOON'}</button><button type="button" data-ranking-view="vip" class="${model.view === 'vip' ? 'active' : ''}">VIP RECORDS</button></div>${content}<p class="ranking-disclaimer">CH is fictional game currency. It has no cash value and cannot be deposited, withdrawn, or cashed out.</p></section>`;
}

async function fetchState() {
  const playerId = localStorage.getItem('sv-player') || 'hanseo';
  const response = await fetch('/api/state', { headers: { 'x-player-id': playerId } });
  if (!response.ok) throw new Error('RANKING_STATE_FAILED');
  return response.json();
}

let decorating = false;
async function decorateRankings() {
  if (decorating) return;
  const content = document.querySelector('.content');
  const heading = content?.querySelector('.head h1');
  if (!content || heading?.textContent?.trim() !== 'Rankings') return;
  decorating = true;
  try {
    const state = await fetchState();
    content.querySelectorAll(':scope > article.card.block').forEach(node => node.classList.add('ranking-legacy-hidden'));
    let root = content.querySelector('#ranking-surfaces');
    const html = surfaceHtml(state);
    if (!root) {
      content.querySelector('.head')?.insertAdjacentHTML('afterend', html);
      root = content.querySelector('#ranking-surfaces');
    } else {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      root.replaceWith(wrapper.firstElementChild);
      root = content.querySelector('#ranking-surfaces');
    }
    root?.querySelectorAll('[data-ranking-view]').forEach(button => button.addEventListener('click', () => {
      if (button.disabled) return;
      rankingView = button.dataset.rankingView;
      decorateRankings();
    }));
  } catch {
    // Rankings enhancement is read-only. Leave the legacy ranking tables visible if API state is unavailable.
    content.querySelectorAll('.ranking-legacy-hidden').forEach(node => node.classList.remove('ranking-legacy-hidden'));
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
      await decorateRankings();
    });
  };
  addEventListener('DOMContentLoaded', schedule, { once: true });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
}
