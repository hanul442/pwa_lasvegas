// VEGAS client: floor navigation, lobby, rankings, profile, and mounting live tables.
import { api, errorMessage, playerId } from './js/api.js';
import { formatCH, formatFull, rollNumber, isMuted, setMuted, sound, el } from './js/fx.js';
import { TIERS, createChip } from './js/chips.js';
import { mountBlackjack } from './js/games/blackjack.js';
import { mountBaccarat } from './js/games/baccarat.js';
import { mountRoulette } from './js/games/roulette.js';
import { mountDice } from './js/games/dice.js';

document.documentElement.dataset.vegasUi = 'live-tables';

const GAMES = [
  { id: 'blackjack', name: 'BLACKJACK', kicker: 'CARD TABLE', blurb: '21에 가깝게. 딜러를 이기면 2배, 블랙잭은 3:2.', mount: mountBlackjack, hero: true },
  { id: 'roulette', name: 'ROULETTE', kicker: 'WHEEL', blurb: '유럽식 싱글 제로. 숫자 하나에 걸면 35배.', mount: mountRoulette },
  { id: 'baccarat', name: 'BACCARAT', kicker: 'CARD TABLE', blurb: '플레이어냐 뱅커냐. 카드를 쪼아보는 맛.', mount: mountBaccarat },
  { id: 'dice', name: 'SIC BO', kicker: 'DICE', blurb: '주사위 세 개. 크게, 작게, 혹은 트리플.', mount: mountDice },
  { id: 'poker', name: "HOLD'EM", kicker: 'WITH FRIENDS', blurb: '친구와 같은 테이블에서. 곧 열려요.', soon: true }
];

const surfaces = [...document.querySelectorAll('[data-surface]')];
const navItems = [...document.querySelectorAll('[data-nav]')];
const walletEl = document.querySelector('[data-wallet]');
const tableMount = document.querySelector('[data-table-mount]');
let state = null;
let lastLobbyTrigger = null;
let selectedGame = null;
let activeTable = null;
let shownWallet = 0;

// ---------- navigation ----------
function showSurface(name, { focus = false } = {}) {
  const target = surfaces.find(s => s.dataset.surface === name);
  if (!target) return;
  surfaces.forEach(s => s.classList.toggle('is-active', s === target));
  navItems.forEach(item => item.classList.toggle('is-active', item.dataset.nav === name));
  document.body.classList.toggle('game-mode', name === 'table');
  document.body.classList.toggle('tier-mode', name === 'tiers');
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (name !== 'table') closeTable();
  if (name === 'ranking') renderRanking();
  if (name === 'profile') renderProfile();
  if (focus) { const heading = target.querySelector('h1'); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); }
}

navItems.forEach(item => item.addEventListener('click', () => showSurface(item.dataset.nav, { focus: true })));

function chooseGame(button) {
  const game = GAMES.find(g => g.id === button.dataset.game);
  if (!game || game.soon) return;
  lastLobbyTrigger = button;
  selectedGame = game;
  document.querySelector('#tier-game-name').textContent = `${game.name} · ${game.blurb}`;
  renderTiers();
  history.pushState({ vegasSurface: 'tiers' }, '', `#tiers-${game.id}`);
  showSurface('tiers', { focus: true });
}

async function openTable(tier) {
  if (!selectedGame) return;
  history.pushState({ vegasSurface: 'table' }, '', `#table-${selectedGame.id}-${tier}`);
  showSurface('table');
  closeTable();
  activeTable = await selectedGame.mount({ mount: tableMount, tier, state, onLeave: () => leaveTable() });
  activeTable.root.querySelector('.table-back')?.focus({ preventScroll: true });
}

function closeTable() {
  if (!activeTable) return;
  activeTable.destroy();
  activeTable = null;
  tableMount.replaceChildren();
  refresh();
}

function restoreTrigger() { lastLobbyTrigger?.focus({ preventScroll: true }); }
function leaveTable({ useHistory = true } = {}) {
  const inGame = document.body.classList.contains('game-mode') || document.body.classList.contains('tier-mode');
  if (!inGame) return;
  if (useHistory && (history.state?.vegasSurface === 'table' || history.state?.vegasSurface === 'tiers')) { history.back(); return; }
  showSurface('games'); restoreTrigger();
}

document.querySelector('[data-tier-back]').addEventListener('click', () => leaveTable());
window.addEventListener('popstate', event => {
  if (event.state?.vegasSurface === 'tiers') { showSurface('tiers', { focus: true }); return; }
  if (event.state?.vegasSurface === 'table') { showSurface('tiers'); return; }
  if (document.body.classList.contains('game-mode') || document.body.classList.contains('tier-mode')) { showSurface('games'); restoreTrigger(); }
});
window.addEventListener('keydown', event => { if (event.key === 'Escape') leaveTable(); });

// ---------- state ----------
async function refresh() {
  try { state = await api.state(); } catch (e) { walletEl.textContent = '오프라인'; return; }
  const available = state.user.account.available;
  rollNumber(walletEl, shownWallet, available, { format: formatCH });
  shownWallet = available;
  renderRecharge();
  if (document.querySelector('[data-surface="ranking"]').classList.contains('is-active')) renderRanking();
  if (document.querySelector('[data-surface="profile"]').classList.contains('is-active')) renderProfile();
}

function renderRecharge() {
  const slot = document.querySelector('[data-recharge-slot]');
  const r = state?.recharge;
  slot.replaceChildren();
  if (r?.eligible) {
    const b = el('button', 'pill-button', `칩 충전 · +${formatCH(r.amount)}`);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await api.recharge(); sound.chips(6); } catch (e) { alert(errorMessage(e)); }
      refresh();
    });
    slot.append(b);
  }
}

// ---------- lobby ----------
function preview(id) {
  if (id === 'blackjack') return '<div class="pv pv-cards"><i data-c="A♠"></i><i data-c="K♥" class="red"></i></div>';
  if (id === 'roulette') return '<div class="pv pv-wheel"><i></i></div>';
  if (id === 'baccarat') return '<div class="pv pv-cards pv-cards--bac"><i data-c="9♦" class="red"></i><i data-c="8♣"></i></div>';
  if (id === 'dice') return '<div class="pv pv-dice"><i>⚄</i><i>⚂</i><i>⚅</i></div>';
  return '<div class="pv pv-cards pv-cards--fan"><i data-c="A♠"></i><i data-c="A♥" class="red"></i><i data-c="K♠"></i></div>';
}

function renderLobby() {
  const grid = document.querySelector('[data-game-grid]');
  grid.replaceChildren(...GAMES.map(g => {
    const b = el('button', `game-card deco game-card--${g.id}${g.hero ? ' game-card--hero' : ''}${g.soon ? ' is-soon' : ''}`);
    b.type = 'button';
    b.dataset.game = g.id;
    if (g.soon) b.setAttribute('aria-disabled', 'true');
    b.innerHTML = `${preview(g.id)}<span class="game-kicker">${g.kicker}</span><strong>${g.name}</strong><small>${g.soon ? '친구 테이블 · 준비 중' : '테이블 고르기 →'}</small>`;
    b.addEventListener('click', () => chooseGame(b));
    tilt(b);
    return b;
  }));
  const list = document.querySelector('[data-floor-list]');
  list.replaceChildren(...GAMES.map(g => {
    const b = el('button', `floor-game${g.soon ? ' is-soon' : ''}`);
    b.type = 'button';
    b.dataset.game = g.id;
    if (g.soon) b.setAttribute('aria-disabled', 'true');
    b.innerHTML = `<span><strong>${g.name}</strong><small>${g.blurb}</small></span><span class="floor-game-tag">${g.soon ? 'SOON' : g.kicker}</span>`;
    b.addEventListener('click', () => chooseGame(b));
    return b;
  }));
}

// Cards lean toward the pointer like a physical card being picked up.
function tilt(node) {
  if (matchMedia('(hover: none)').matches) return;
  node.addEventListener('pointermove', e => {
    const r = node.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    node.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
    node.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
    node.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(0)}%`);
  });
  node.addEventListener('pointerleave', () => { node.style.removeProperty('--rx'); node.style.removeProperty('--ry'); });
}

// ---------- tiers ----------
function renderTiers() {
  const grid = document.querySelector('[data-tier-grid]');
  const floors = state?.floors || [];
  const available = state?.user?.account?.available ?? 0;
  grid.replaceChildren(...Object.values(TIERS).map(tier => {
    const floor = floors.find(f => f.slug === tier.floor);
    const locked = floor ? !floor.unlocked : false;
    const broke = available < tier.min;
    const b = el('button', `tier-card deco tier-card--${tier.slug}${locked ? ' is-locked' : ''}`);
    b.type = 'button';
    b.dataset.tier = tier.slug;
    b.dataset.min = tier.min;
    b.disabled = locked || broke;
    const chips = el('span', 'tier-chips');
    tier.chips.forEach((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); chips.append(c); });
    const status = locked ? `🔒 ${tier.floorName} · ${Math.round((floor?.progress || 0) * 100)}%` : broke ? '칩이 부족해요' : tier.floorName;
    b.innerHTML = `<strong>${tier.name}</strong><span>${formatCH(tier.min)}–${formatCH(tier.max)} CH</span><small>${status}</small>`;
    b.prepend(chips);
    b.addEventListener('click', () => openTable(tier.slug));
    return b;
  }));
}

// ---------- ranking ----------
const RANK_TABS = [['wealth', '자산'], ['profit', '수익'], ['highRoller', '베팅량']];
let rankTab = 'wealth';
function renderRanking() {
  const tabs = document.querySelector('[data-rank-tabs]');
  tabs.replaceChildren(...RANK_TABS.map(([key, label]) => {
    const b = el('button', `tab${key === rankTab ? ' is-active' : ''}`, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === rankTab));
    b.addEventListener('click', () => { rankTab = key; renderRanking(); });
    return b;
  }));
  const rows = state?.rankings?.allTime?.[rankTab] || [];
  const me = playerId();
  document.querySelector('[data-rank-list]').replaceChildren(...rows.map(r => {
    const li = el('li', `rank-row${r.id === me ? ' is-me' : ''}${r.rank <= 3 ? ` is-top is-top-${r.rank}` : ''}`);
    li.innerHTML = `<span class="rank-no">${r.rank}</span><span class="rank-avatar">${r.accent || '♠'}</span><span class="rank-name">${r.nickname}${r.id === me ? ' <small>나</small>' : ''}</span><span class="rank-value">${formatCH(r.value)}</span>`;
    return li;
  }));
}

// ---------- profile ----------
const LEDGER_LABEL = { INITIAL_GRANT: '시작 칩', GAME_WIN: '승리', GAME_LOSS: '패배', GAME_PUSH: '무승부', BET_LOCK: '베팅', BET_SETTLE: '정산', AUTO_RECHARGE: '충전', BANKRUPTCY: '파산', ADMIN_GRANT: '지급' };
function renderProfile() {
  const root = document.querySelector('[data-profile]');
  if (!state) { root.textContent = '불러오는 중…'; return; }
  const u = state.user, a = u.account;
  const floors = state.floors.map(f => `<li class="floor-row${f.unlocked ? ' is-open' : ''}"><span>${f.unlocked ? '◆' : '🔒'} ${f.name}</span><span class="floor-bar"><i style="width:${Math.round(f.progress * 100)}%"></i></span></li>`).join('');
  const ledger = state.ledger.slice(0, 15).map(x => `<li><span>${LEDGER_LABEL[x.type] || x.type}${x.metadata?.game ? ` · ${x.metadata.game}` : ''}</span><b class="${x.amount > 0 ? 'pos' : x.amount < 0 ? 'neg' : ''}">${x.amount > 0 ? '+' : ''}${formatCH(x.amount)}</b></li>`).join('');
  root.innerHTML = `
    <div class="profile-card deco">
      <span class="profile-avatar">${u.accent}</span>
      <div><strong>${u.nickname}</strong><small>보유 ${formatFull(a.available)} CH</small></div>
    </div>
    <dl class="stat-grid">
      <div><dt>총 손익</dt><dd class="${a.qualifiedPnl >= 0 ? 'pos' : 'neg'}">${a.qualifiedPnl >= 0 ? '+' : ''}${formatCH(a.qualifiedPnl)}</dd></div>
      <div><dt>총 베팅</dt><dd>${formatCH(a.totalWagered)}</dd></div>
      <div><dt>최고 자산</dt><dd>${formatCH(a.peakBankroll)}</dd></div>
    </dl>
    <h2 class="sub-head">Floors</h2><ul class="floor-rows">${floors}</ul>
    <h2 class="sub-head">최근 기록</h2><ul class="ledger">${ledger || '<li><span>아직 기록이 없어요</span></li>'}</ul>
    <h2 class="sub-head">플레이어 바꾸기 <small>데모</small></h2>
    <div class="player-switch">${state.users.map(p => `<button type="button" class="pill-button${p.id === u.id ? ' is-active' : ''}" data-player="${p.id}">${p.accent} ${p.nickname}</button>`).join('')}</div>`;
  root.querySelectorAll('[data-player]').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem('vegas:player', b.dataset.player); } catch {}
    shownWallet = 0;
    refresh();
  }));
}

// ---------- sound toggle ----------
const soundBtn = document.querySelector('[data-sound]');
function paintSound() { soundBtn.setAttribute('aria-pressed', String(!isMuted())); soundBtn.setAttribute('aria-label', isMuted() ? '소리 켜기' : '소리 끄기'); soundBtn.classList.toggle('is-muted', isMuted()); }
soundBtn.addEventListener('click', () => { setMuted(!isMuted()); paintSound(); if (!isMuted()) sound.chip(); });
paintSound();

// ---------- marquee sign bulbs ----------
// Bulbs run around the sign's perimeter so the chase reads like a real marquee.
const bulbs = document.querySelector('[data-bulbs]');
if (bulbs) {
  const top = 13, side = 4, pts = [];
  for (let i = 0; i < top; i++) pts.push([4 + (92 * i) / (top - 1), 3.5]);
  for (let i = 1; i <= side; i++) pts.push([97, 3.5 + (93 * i) / (side + 1)]);
  for (let i = top - 1; i >= 0; i--) pts.push([4 + (92 * i) / (top - 1), 96.5]);
  for (let i = side; i >= 1; i--) pts.push([3, 3.5 + (93 * i) / (side + 1)]);
  bulbs.append(...pts.map(([x, y], i) => { const b = el('i'); b.style.cssText = `left:${x}%;top:${y}%;--i:${i}`; return b; }));
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});

renderLobby();
showSurface('lobby');
history.replaceState({ vegasSurface: 'lobby' }, '', location.pathname);
refresh().then(() => renderTiers());
