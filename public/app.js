// VEGAS client: floor navigation, lobby, rankings, profile, and mounting live tables.
import { api, errorMessage, playerId } from './js/api.js';
import { formatCH, formatFull, rollNumber, isMuted, setMuted, sound, el, flyFrom } from './js/fx.js';
import { music } from './js/music.js';
import { createCard, flipCard } from './js/cards.js';
import { TIERS, createChip } from './js/chips.js';
import { mountBlackjack } from './js/games/blackjack.js';
import { mountBaccarat } from './js/games/baccarat.js';
import { mountRoulette } from './js/games/roulette.js';
import { mountDice } from './js/games/dice.js';
import { mountMatgo } from './js/games/matgo.js';
import { mountSeotda } from './js/games/seotda.js';
import { attachGuide } from './js/guide.js';

document.documentElement.dataset.vegasUi = 'live-tables';

const GAMES = [
  { id: 'blackjack', name: 'Blackjack', blurb: '21에 가깝게. 블랙잭은 3 대 2로 받아요.', mount: mountBlackjack },
  { id: 'roulette', name: 'Roulette', blurb: '싱글 제로 유럽식 휠. 숫자 하나에 걸면 35배.', mount: mountRoulette },
  { id: 'baccarat', name: 'Baccarat', blurb: '플레이어와 뱅커 중 한쪽에. 카드는 천천히 열려요.', mount: mountBaccarat },
  { id: 'dice', name: 'Sic Bo', blurb: '주사위 세 개의 합을 맞혀요.', mount: mountDice },
  { id: 'matgo', name: '맞고', blurb: '둘이서 치는 고스톱. AI보다 먼저 7점을 내세요.', mount: mountMatgo },
  { id: 'seotda', name: '섯다', blurb: '화투 두 장의 족보 싸움. 땡잡이와 암행어사까지.', mount: mountSeotda },
  { id: 'poker', name: "Hold'em", blurb: '친구와 같은 테이블에서 겨뤄요. 곧 열려요.', soon: true }
];

const surfaces = [...document.querySelectorAll('[data-surface]')];
const navItems = [...document.querySelectorAll('[data-nav]')];
const walletEl = document.querySelector('[data-wallet]');
const tableMount = document.querySelector('[data-table-mount]');
let state = null;
let lastLobbyTrigger = null;
let selectedGame = null;
let activeTable = null;
let shownWallet = null;

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
  document.querySelector('#tiers-title').textContent = game.name;
  document.querySelector('#tier-game-name').textContent = `${game.blurb} 앉을 테이블을 골라 주세요.`;
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
  attachGuide(activeTable, selectedGame.id);
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
  // Show the balance as is on first load; only later changes roll.
  if (shownWallet === null || shownWallet === available) walletEl.textContent = formatCH(available);
  else rollNumber(walletEl, shownWallet, available, { format: formatCH });
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
function gameRow(g) {
  const li = el('li');
  const b = el('button', `game-row${g.soon ? ' is-soon' : ''}`);
  b.type = 'button';
  b.dataset.game = g.id;
  if (g.soon) b.setAttribute('aria-disabled', 'true');
  b.innerHTML = `<span class="game-row-name">${g.name}</span><span class="game-row-stake">${g.soon ? '준비 중' : `${formatCH(TIERS.low.min)}부터`}</span><span class="game-row-desc">${g.blurb}</span>`;
  b.addEventListener('click', () => chooseGame(b));
  li.append(b);
  return li;
}

function renderLobby() {
  document.querySelector('[data-game-grid]').replaceChildren(...GAMES.map(gameRow));
  document.querySelector('[data-floor-list]').replaceChildren(...GAMES.map(gameRow));
  const vignette = document.querySelector('[data-vignette]');
  vignette.addEventListener('click', () => chooseGame(vignette));
}

// The lobby's one orchestrated moment: a hand is dealt under the lamp.
async function dealVignette() {
  const hand = document.querySelector('[data-vignette-hand]');
  const chips = document.querySelector('[data-vignette-chips]');
  const shoe = { left: innerWidth, top: -120, width: 0, height: 0 };
  [500_000, 250_000, 250_000, 100_000, 100_000].forEach((v, i) => {
    const c = createChip(v); c.style.setProperty('--i', i); c.style.setProperty('--jx', `${(i % 2) - 0.5}px`); chips.append(c);
  });
  for (const t of ['A♠', 'K♥']) {
    const card = createCard(t, { faceUp: false });
    hand.append(card);
    await flyFrom(card, shoe, { duration: 620, spin: -30, scale: .8, lift: 20 });
    await flipCard(card, t, { duration: 420 });
  }
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
    const b = el('button', `tier-card tier-card--${tier.slug}${locked ? ' is-locked' : ''}`);
    b.setAttribute('role', 'listitem');
    b.type = 'button';
    b.dataset.tier = tier.slug;
    b.dataset.min = tier.min;
    b.disabled = locked || broke;
    const chips = el('span', 'tier-chips');
    tier.chips.forEach((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); chips.append(c); });
    const status = locked ? `${tier.floorName} 층이 열리면 앉을 수 있어요 (${Math.round((floor?.progress || 0) * 100)}%)` : broke ? '칩이 부족해요' : `${tier.floorName} 층`;
    b.innerHTML = `<strong>${tier.name}</strong><span>${formatCH(tier.min)} – ${formatCH(tier.max)} CH</span><small>${status}</small>`;
    chips.setAttribute('aria-hidden', 'true');
    b.append(chips);
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
    li.innerHTML = `<span class="rank-no">${r.rank}</span><span class="rank-name">${r.nickname}${r.id === me ? ' <small>나</small>' : ''}</span><span class="rank-value">${formatCH(r.value)}</span>`;
    return li;
  }));
}

// ---------- profile ----------
const LEDGER_LABEL = { INITIAL_GRANT: '시작 칩', GAME_WIN: '승리', GAME_LOSS: '패배', GAME_PUSH: '무승부', BET_LOCK: '베팅', BET_SETTLE: '정산', AUTO_RECHARGE: '충전', BANKRUPTCY: '파산', ADMIN_GRANT: '지급' };
function renderProfile() {
  const root = document.querySelector('[data-profile]');
  if (!state) { root.textContent = '불러오는 중…'; return; }
  const u = state.user, a = u.account;
  const floors = state.floors.map(f => `<li class="floor-row${f.unlocked ? ' is-open' : ''}"><span>${f.name}</span><span class="floor-bar"><i style="width:${Math.round(f.progress * 100)}%"></i></span></li>`).join('');
  const ledger = state.ledger.slice(0, 15).map(x => `<li><span>${LEDGER_LABEL[x.type] || x.type}${x.metadata?.game ? ` · ${x.metadata.game}` : ''}</span><b class="${x.amount > 0 ? 'pos' : x.amount < 0 ? 'neg' : ''}">${x.amount > 0 ? '+' : ''}${formatCH(x.amount)}</b></li>`).join('');
  root.innerHTML = `
    <div class="profile-card">
      <div><strong>${u.nickname}</strong><small>보유 ${formatFull(a.available)} CH</small></div>
    </div>
    <dl class="stat-grid">
      <div><dt>총 손익</dt><dd class="${a.qualifiedPnl >= 0 ? 'pos' : 'neg'}">${a.qualifiedPnl >= 0 ? '+' : ''}${formatCH(a.qualifiedPnl)}</dd></div>
      <div><dt>총 베팅</dt><dd>${formatCH(a.totalWagered)}</dd></div>
      <div><dt>최고 자산</dt><dd>${formatCH(a.peakBankroll)}</dd></div>
    </dl>
    <h2 class="sub-head">층</h2><ul class="floor-rows">${floors}</ul>
    <h2 class="sub-head">최근 기록</h2><ul class="ledger">${ledger || '<li><span>아직 기록이 없어요</span></li>'}</ul>
    <h2 class="sub-head">플레이어 바꾸기 <small>데모</small></h2>
    <div class="player-switch">${state.users.map(p => `<button type="button" class="pill-button${p.id === u.id ? ' is-active' : ''}" data-player="${p.id}">${p.nickname}</button>`).join('')}</div>`;
  root.querySelectorAll('[data-player]').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem('vegas:player', b.dataset.player); } catch {}
    shownWallet = null;
    refresh();
  }));
}

// ---------- sound and music ----------
// One toggle (in the top bar and on every table) silences both effects and music.
let audioUnlocked = false;
function syncMusic() {
  if (audioUnlocked && !isMuted() && !document.hidden) music.start();
  else music.stop();
}
function paintSound() {
  document.querySelectorAll('[data-sound]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(!isMuted()));
    btn.setAttribute('aria-label', isMuted() ? '소리 켜기' : '소리 끄기');
    btn.classList.toggle('is-muted', isMuted());
  });
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-sound]')) return;
  setMuted(!isMuted());
  paintSound();
  syncMusic();
  if (!isMuted()) sound.chip();
});
// Browsers only let audio start after a tap or key press, so the music begins with the first one.
for (const type of ['pointerdown', 'keydown']) {
  addEventListener(type, () => { audioUnlocked = true; syncMusic(); }, { once: true, capture: true });
}
document.addEventListener('visibilitychange', syncMusic);
new MutationObserver(paintSound).observe(document.querySelector('[data-surface="table"]') || document.body, { childList: true, subtree: true });
paintSound();

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

renderLobby();
showSurface('lobby');
history.replaceState({ vegasSurface: 'lobby' }, '', location.pathname);
refresh().then(() => renderTiers());
dealVignette();
