// VEGAS client: floor navigation, lobby, rankings, profile, and mounting live tables.
import { api, errorMessage, sessionToken, clearSession } from './js/api.js';
import { openSignIn } from './js/auth.js';
import { renderAdmin } from './js/admin.js';
import { formatCH, formatFull, rollNumber, isMuted, setMuted, sound, el, flyFrom } from './js/fx.js';
import { music } from './js/music.js';
import { voice, OPENS_WITH_BETS } from './js/voice.js';
import { createCard, flipCard } from './js/cards.js';
import { TIERS, createChip } from './js/chips.js';
import { mountBlackjack } from './js/games/blackjack.js';
import { mountBaccarat } from './js/games/baccarat.js';
import { mountRoulette } from './js/games/roulette.js';
import { mountDice } from './js/games/dice.js';
import { mountMatgo } from './js/games/matgo.js';
import { mountGostop } from './js/games/gostop.js';
import { mountSeotda } from './js/games/seotda.js';
import { attachGuide } from './js/guide.js';
import { mountHoldem } from './js/games/holdem.js';
import { mountSlots } from './js/games/slots.js';
import { settings, onSettings } from './js/settings.js';
import { renderSettings, attachQuickSettings } from './js/settings-panel.js';
import { renderDuels } from './js/social.js';
import { renderLounge, maybeOpenDaily, dailyButton, celebrateFloors, gameName } from './js/lounge.js';
import { startNotifications, maybeAsk, forgetDevice } from './js/notify.js';
import { startNews, stopNews } from './js/news.js';

document.documentElement.dataset.vegasUi = 'live-tables';

const GAMES = [
  { id: 'blackjack', name: 'Blackjack', blurb: '21에 가깝게. 블랙잭은 3 대 2로 받아요.', mount: mountBlackjack },
  { id: 'roulette', name: 'Roulette', blurb: '싱글 제로 유럽식 휠. 숫자 하나에 걸면 35배.', mount: mountRoulette },
  { id: 'baccarat', name: 'Baccarat', blurb: '플레이어와 뱅커 중 한쪽에. 카드는 천천히 열려요.', mount: mountBaccarat },
  { id: 'dice', name: 'Sic Bo', blurb: '주사위 세 개의 합을 맞혀요.', mount: mountDice },
  { id: 'matgo', name: '맞고', blurb: '둘이서 치는 고스톱. AI보다 먼저 7점을 내세요.', mount: mountMatgo },
  { id: 'gostop', name: '고스톱', blurb: '셋이서 치는 고스톱. AI 둘과 3점부터 고·스톱.', mount: mountGostop },
  { id: 'seotda', name: '섯다', blurb: '화투 두 장의 족보 싸움. 땡잡이와 암행어사까지.', mount: mountSeotda },
  { id: 'poker', name: "Hold'em", blurb: 'AI 플레이어들과 텍사스 홀덤. 칩으로 바이인하고 앉아요.', mount: mountHoldem },
  { id: 'slots', name: 'Slots', blurb: '레버를 당겨요. 별 세 개면 모두가 키운 잭팟이 터져요.', mount: mountSlots }
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
  if (name === 'lobby' && state) { celebrateFloors(state); maybeOpenDaily(state, applyState); setTimeout(() => maybeAsk(), 1200); }
  if (name === 'profile') renderProfile();
  if (name === 'settings') openSettings(); else closeSettings();
  syncWakeLock();
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
  try { localStorage.setItem(LAST_TABLE_KEY, JSON.stringify({ game: selectedGame.id, tier })); } catch {}
  history.pushState({ vegasSurface: 'table' }, '', `#table-${selectedGame.id}-${tier}`);
  showSurface('table');
  closeTable();
  voice.preload(selectedGame.id);
  activeTable = await selectedGame.mount({ mount: tableMount, tier, state, onLeave: () => leaveTable() });
  attachGuide(activeTable, selectedGame.id);
  attachQuickSettings(activeTable);
  if (OPENS_WITH_BETS.has(selectedGame.id) && !activeTable.locked) voice.say('place-bets');
  activeTable.root.querySelector('.table-back')?.focus({ preventScroll: true });
}

function closeTable() {
  if (!activeTable) return;
  voice.hush();
  const closing = activeTable.destroy();
  activeTable = null;
  tableMount.replaceChildren();
  Promise.resolve(closing).finally(refresh);
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
  let next;
  if (!sessionToken()) return;
  try { next = await api.state(); } catch (e) { if (e.code !== 'AUTH_REQUIRED') walletEl.textContent = '오프라인'; return; }
  applyState(next);
}

const isActive = name => document.querySelector(`[data-surface="${name}"]`).classList.contains('is-active');

// Every fresh server state lands here: wallet, lobby lounge, ranking and profile.
function applyState(next) {
  state = next;
  const available = state.user.account.available;
  // Show the balance as is on first load; only later changes roll.
  if (shownWallet === null || shownWallet === available) walletEl.textContent = formatCH(available);
  else rollNumber(walletEl, shownWallet, available, { format: formatCH });
  shownWallet = available;
  renderRecharge();
  renderLounge(document.querySelector('[data-lounge]'), state, applyState);
  if (isActive('ranking')) renderRanking();
  if (isActive('profile')) renderProfile();
  if (isActive('lobby')) { celebrateFloors(state); maybeOpenDaily(state, applyState); }
}

// The lobby offers to sit back down at the last table played on this device.
const LAST_TABLE_KEY = 'vegas:last-table';
function lastTable() {
  try {
    const t = JSON.parse(localStorage.getItem(LAST_TABLE_KEY) || 'null');
    return t && GAMES.some(g => g.id === t.game) && TIERS[t.tier] ? t : null;
  } catch { return null; }
}

function renderRecharge() {
  const slot = document.querySelector('[data-recharge-slot]');
  const r = state?.recharge;
  slot.replaceChildren();
  const daily = dailyButton(state, applyState);
  if (daily) slot.append(daily);
  const last = lastTable();
  if (last) {
    const game = GAMES.find(g => g.id === last.game), tier = TIERS[last.tier];
    const short = (state?.user?.account?.available ?? Infinity) < tier.min;
    const b = el('button', 'pill-button pill-button--solid', `${game.name} ${tier.name}에 다시 앉기`);
    b.type = 'button';
    b.disabled = short;
    if (short) b.title = '칩이 부족해요';
    b.addEventListener('click', () => {
      lastLobbyTrigger = b;
      selectedGame = game;
      history.pushState({ vegasSurface: 'tiers' }, '', `#tiers-${game.id}`);
      renderTiers();
      document.querySelector('#tiers-title').textContent = game.name;
      document.querySelector('#tier-game-name').textContent = `${game.blurb} 앉을 테이블을 골라 주세요.`;
      openTable(tier.slug);
    });
    slot.append(b);
  }
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
    b.innerHTML = `<strong>${tier.name}</strong><span>${formatCH(tier.min)} – ${formatCH(tier.max)}원</span><small>${status}</small>`;
    chips.setAttribute('aria-hidden', 'true');
    b.append(chips);
    b.addEventListener('click', () => openTable(tier.slug));
    return b;
  }));
}

// ---------- ranking ----------
// "이번 주" is the weekly season (resets Monday 00:00 KST, top three get prizes); "전체" is all time.
const RANK_TABS = {
  season: [['profit', '수익'], ['wins', '승리'], ['highRoller', '베팅량']],
  allTime: [['wealth', '자산'], ['profit', '수익'], ['highRoller', '베팅량']]
};
let rankPeriod = 'season';
let rankTab = 'profit';
function timeLeft(iso) {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60;
  return d > 0 ? `${d}일 ${h}시간` : h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}
function renderRanking() {
  const season = state?.rankings?.season;
  if (!season) rankPeriod = 'allTime';
  const period = document.querySelector('[data-rank-period]');
  period.replaceChildren(...[['season', '이번 주'], ['allTime', '전체']].map(([key, label]) => {
    const b = el('button', 'segment', label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(key === rankPeriod));
    b.disabled = key === 'season' && !season;
    b.addEventListener('click', () => { rankPeriod = key; rankTab = RANK_TABS[key][0][0]; renderRanking(); });
    return b;
  }));
  const head = document.querySelector('[data-season-head]');
  head.replaceChildren();
  if (rankPeriod === 'season' && season) {
    const last = state.engagement?.lastSeason;
    head.innerHTML = `<div class="season-card"><div><strong>${season.name}</strong><small>${timeLeft(season.endsAt)} 남음 · 월요일 0시에 새로 시작</small></div><ol class="season-prizes"><li><b>1위</b> 5천만</li><li><b>2위</b> 3천만</li><li><b>3위</b> 1,500만</li></ol></div>`
      + (last?.podium?.length ? `<p class="season-last">지난 시즌 ${last.podium.map(p => `${p.rank}위 ${p.nickname}`).join(' · ')}</p>` : '');
  }
  if (!RANK_TABS[rankPeriod].some(([k]) => k === rankTab)) rankTab = RANK_TABS[rankPeriod][0][0];
  const tabs = document.querySelector('[data-rank-tabs]');
  tabs.replaceChildren(...RANK_TABS[rankPeriod].map(([key, label]) => {
    const b = el('button', `tab${key === rankTab ? ' is-active' : ''}`, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === rankTab));
    b.addEventListener('click', () => { rankTab = key; renderRanking(); });
    return b;
  }));
  const rows = (rankPeriod === 'season' ? season?.[rankTab] : state?.rankings?.allTime?.[rankTab]) || [];
  const me = state?.user?.id;
  const value = r => rankTab === 'wins' ? `${r.value}승` : `${rankPeriod === 'season' && rankTab === 'profit' && r.value > 0 ? '+' : ''}${formatCH(r.value)}`;
  document.querySelector('[data-rank-list]').replaceChildren(...rows.map(r => {
    const li = el('li', `rank-row${r.id === me ? ' is-me' : ''}${r.rank <= 3 ? ` is-top is-top-${r.rank}` : ''}`);
    li.innerHTML = `<span class="rank-no">${r.rank}</span><span class="rank-name">${r.nickname}${r.id === me ? ' <small>나</small>' : ''}</span><span class="rank-value">${value(r)}</span>`;
    return li;
  }));
  renderDuels(document.querySelector('[data-duels]'), state, applyState);
}

// ---------- profile ----------
const LEDGER_LABEL = { INITIAL_GRANT: '시작 칩', GAME_WIN: '승리', GAME_LOSS: '패배', GAME_PUSH: '무승부', BET_LOCK: '베팅', BET_SETTLE: '정산', AUTO_RECHARGE: '충전', BANKRUPTCY: '파산', ADMIN_GRANT: '지급', ADMIN_DEDUCT: '회수', DAILY_BONUS: '출석 보너스', MISSION_REWARD: '미션 보상', SEASON_REWARD: '시즌 보상', RESCUE_GRANT: '럭키 카드', JACKPOT_WIN: '잭팟' };
function renderProfile() {
  const root = document.querySelector('[data-profile]');
  if (!state) { root.textContent = '불러오는 중…'; return; }
  const u = state.user, a = u.account;
  const floors = state.floors.map(f => `<li class="floor-row${f.unlocked ? ' is-open' : ''}"><span>${f.name}</span><span class="floor-bar"><i style="width:${Math.round(f.progress * 100)}%"></i></span></li>`).join('');
  // One line per finished round: chip locks are skipped and a round shows its win or loss, not the chips handed back.
  const ledger = state.ledger.filter(x => x.type !== 'BET_LOCK').slice(0, 15).map(x => {
    const amount = x.type.startsWith('GAME_') && Number.isFinite(x.rawPnlDelta) ? x.rawPnlDelta : x.amount;
    return `<li><span>${LEDGER_LABEL[x.type] || x.type}${x.metadata?.game ? ` · ${gameName(x.metadata.game)}` : ''}</span><b class="${amount > 0 ? 'pos' : amount < 0 ? 'neg' : ''}">${amount > 0 ? '+' : ''}${formatCH(amount)}</b></li>`;
  }).join('');
  const eng = state.engagement || {};
  const badges = (eng.badges || []).map(b => `<li class="badge badge--${b.rank}"><span class="badge-star" aria-hidden="true"></span><b>${b.rank}위</b><small>${b.name}</small></li>`).join('');
  // Per-game record: win rate, biggest win and net, most played first.
  const games = Object.entries(u.stats || {}).sort((x, y) => y[1].rounds - x[1].rounds).map(([g, s]) => {
    const rate = s.rounds ? Math.round((s.wins / s.rounds) * 100) : 0;
    return `<tr><th scope="row">${gameName(g)}</th><td>${s.rounds}</td><td>${rate}%</td><td>${formatCH(s.biggestWin)}</td><td class="${s.pnl > 0 ? 'pos' : s.pnl < 0 ? 'neg' : ''}">${s.pnl > 0 ? '+' : ''}${formatCH(s.pnl)}</td></tr>`;
  }).join('');
  const totals = Object.values(u.stats || {}).reduce((t, s) => ({ rounds: t.rounds + s.rounds, wins: t.wins + s.wins, best: Math.max(t.best, s.biggestWin) }), { rounds: 0, wins: 0, best: 0 });
  root.innerHTML = `
    <div class="profile-card">
      <div><strong>${u.nickname}</strong><small>보유 ${formatFull(a.available)}원</small></div>
    </div>
    <dl class="stat-grid">
      <div><dt>총 손익</dt><dd class="${a.qualifiedPnl >= 0 ? 'pos' : 'neg'}">${a.qualifiedPnl >= 0 ? '+' : ''}${formatCH(a.qualifiedPnl)}</dd></div>
      <div><dt>총 베팅</dt><dd>${formatCH(a.totalWagered)}</dd></div>
      <div><dt>최고 자산</dt><dd>${formatCH(a.peakBankroll)}</dd></div>
      <div><dt>승률</dt><dd>${totals.rounds ? Math.round((totals.wins / totals.rounds) * 100) : 0}%</dd></div>
      <div><dt>최대 승리</dt><dd>${formatCH(totals.best)}</dd></div>
      <div><dt>최장 연승</dt><dd>${eng.streak?.best || 0}연승${eng.streak?.current > 1 ? ` <small>지금 ${eng.streak.current}</small>` : ''}</dd></div>
    </dl>
    ${badges ? `<h2 class="sub-head">시즌 배지</h2><ul class="badge-list">${badges}</ul>` : ''}
    <h2 class="sub-head">게임별 기록</h2>
    ${games ? `<div class="game-stats-wrap"><table class="game-stats"><thead><tr><th scope="col">게임</th><th scope="col">판</th><th scope="col">승률</th><th scope="col">최대 승리</th><th scope="col">손익</th></tr></thead><tbody>${games}</tbody></table></div>` : '<p class="lounge-note">아직 플레이한 게임이 없어요.</p>'}
    <h2 class="sub-head">층</h2><ul class="floor-rows">${floors}</ul>
    <h2 class="sub-head">최근 기록</h2><ul class="ledger">${ledger || '<li><span>아직 기록이 없어요</span></li>'}</ul>
    <h2 class="sub-head">계정</h2>
    <div class="account-row"><span>${state.username ? `<b>${state.username}</b> 계정으로 로그인 중` : '로그인 중'}</span><button type="button" class="pill-button" data-sign-out>로그아웃</button></div>`;
  renderAdmin(root, state, applyState);
  root.querySelector('[data-sign-out]').addEventListener('click', async () => {
    await forgetDevice();
    await api.logout().catch(() => {});
    signedOut();
  });
}

// The notification sheet only interrupts the menus, never a hand in progress.
const inMenus = () => !document.body.classList.contains('game-mode') && !document.body.classList.contains('tier-mode');

// ---------- account ----------
function signedIn(next) {
  shownWallet = null;
  applyState(next);
  startNotifications(inMenus);
  startNews();
  renderTiers();
  showSurface('lobby');
}
function signedOut(notice) {
  stopNews();
  clearSession();
  if (document.body.classList.contains('game-mode') || document.body.classList.contains('tier-mode')) showSurface('lobby');
  state = null;
  shownWallet = null;
  walletEl.textContent = '—';
  openSignIn(signedIn, { notice });
}
// The API saw a missing or expired session.
addEventListener('vegas:signed-out', () => signedOut('로그인이 끝났어요. 다시 로그인해 주세요.'));

// ---------- settings ----------
let settingsCleanup = null;
function openSettings() {
  settingsCleanup?.();
  settingsCleanup = renderSettings(document.querySelector('[data-settings]'));
  paintSound();
}
function closeSettings() { settingsCleanup?.(); settingsCleanup = null; }

// "화면 켜두기": hold a screen wake lock while sitting at a table.
let wakeLock = null;
async function syncWakeLock() {
  const want = settings.get('awake') && document.body.classList.contains('game-mode') && !document.hidden;
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { wakeLock = null; }
  } else if (!want && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', syncWakeLock);
onSettings(key => { if (key === 'awake' || key === null) syncWakeLock(); if (key === 'music' || key === null) syncMusic(); });

// ---------- sound and music ----------
// One toggle (in the top bar and on every table) silences both effects and music.
let audioUnlocked = false;
function syncMusic() {
  if (audioUnlocked && !isMuted() && !document.hidden) music.start();
  else music.stop();
}
function paintSound() {
  document.querySelectorAll('[data-sound]').forEach(btn => {
    btn.setAttribute(btn.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(!isMuted()));
    btn.setAttribute('aria-label', isMuted() ? '소리 켜기' : '소리 끄기');
    btn.classList.toggle('is-muted', isMuted());
  });
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-sound]')) return;
  setMuted(!isMuted());
  paintSound();
  syncMusic();
  if (isMuted()) voice.hush();
  else sound.chip();
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
if (sessionToken()) refresh().then(() => { renderTiers(); if (state) { startNotifications(inMenus); startNews(); } });
else openSignIn(signedIn);
dealVignette();
