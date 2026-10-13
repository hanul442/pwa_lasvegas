// VEGAS client: floor navigation, lobby, rankings, profile, and mounting live tables.
import { api, sessionToken, clearSession } from './js/api.js';
import { openSignIn } from './js/auth.js';
import { renderAdmin } from './js/admin.js';
import { formatCH, formatFull, rollNumber, isMuted, setMuted, sound, el, flyFrom } from './js/fx.js';
import { music } from './js/music.js';
import { voice, OPENS_WITH_BETS } from './js/voice.js';
import { createCard, flipCard } from './js/cards.js';
import { TIERS, FIRST_TIER, createChip } from './js/chips.js';
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
import { mountHorses } from './js/games/horses.js';
import { settings, onSettings } from './js/settings.js';
import { renderSettings, attachQuickSettings } from './js/settings-panel.js';
import { renderDuels } from './js/social.js';
import { renderLounge, maybeOpenDaily, dailyButton, dailyDue, celebrateFloors, gameName, chipsToWallet } from './js/lounge.js';
import { startNotifications, maybeAsk, forgetDevice } from './js/notify.js';
import { mountInstallButton } from './js/install.js';
import { startNews, stopNews } from './js/news.js';
import { maybeBust } from './js/bust.js';
import { renderBank, supportButtons } from './js/bank.js';
import { renderLedger } from './js/ledger.js';
import { errorToast, watchConnection } from './js/notice.js';
import { hotStatus, clock, pct } from './js/hot.js';
import { renderShop, applyCosmetics, luxuryIcon, luxuryItem, openPlayerSheet, showShopTab, nameFrame } from './js/shop.js';
import { rememberTable, recentTables, lastTier, openTableSwitcher } from './js/table-nav.js';
import { ensureTerms } from './js/terms.js';
import { startPlaytime } from './js/playtime.js';

document.documentElement.dataset.vegasUi = 'live-tables';

const GAMES = [
  { id: 'blackjack', name: '블랙잭', tag: '21에 가깝게, 블랙잭은 3 대 2', blurb: '21에 가깝게. 블랙잭은 3 대 2로 받아요.', mount: mountBlackjack },
  { id: 'roulette', name: '룰렛', tag: '싱글 제로 휠, 숫자 하나에 35배', blurb: '싱글 제로 유럽식 휠. 숫자 하나에 걸면 35배.', mount: mountRoulette },
  { id: 'baccarat', name: '바카라', tag: '플레이어냐 뱅커냐', blurb: '플레이어와 뱅커 중 한쪽에. 카드는 천천히 열려요.', mount: mountBaccarat },
  { id: 'dice', name: '식보', tag: '주사위 세 개의 합', blurb: '주사위 세 개의 합을 맞혀요.', mount: mountDice },
  { id: 'matgo', name: '맞고', tag: '둘이서 치는 고스톱', blurb: '둘이서 치는 고스톱. AI보다 먼저 7점을 내세요.', mount: mountMatgo },
  { id: 'gostop', name: '고스톱', tag: 'AI 둘과 셋이서 고·스톱', blurb: '셋이서 치는 고스톱. AI 둘과 3점부터 고·스톱.', mount: mountGostop },
  { id: 'seotda', name: '섯다', tag: '두 장으로 겨루는 족보 싸움', blurb: '화투 두 장의 족보 싸움. 땡잡이와 암행어사까지.', mount: mountSeotda },
  { id: 'poker', name: '홀덤', tag: 'AI들과 텍사스 홀덤', blurb: 'AI 플레이어들과 텍사스 홀덤. 칩으로 바이인하고 앉아요.', mount: mountHoldem },
  { id: 'slots', name: '슬롯', tag: '별 세 개면 잭팟', blurb: '레버를 당겨요. 별 세 개면 모두가 키운 잭팟이 터져요.', mount: mountSlots },
  { id: 'horses', name: '경마', tag: '여섯 마리, 1200m 단거리', blurb: '여섯 마리 중 1등을 맞혀요. 단승은 1착, 연승은 2착 안에만 들면 돼요.', mount: mountHorses },
  // Event tables (lib/events.mjs): one runs each week, reached from the 이벤트 tab.
  { id: 'royale', event: 'royale', guide: 'poker', name: 'Casino Royale', blurb: '007 체험 이벤트. 하이롤러 다섯 명과 홀덤 토너먼트, 마지막 한 사람이 판돈을 전부 가져가요.', mount: ctx => mountHoldem(ctx, { royale: true }) },
  { id: 'tazza', event: 'tazza', guide: 'gostop', name: '타짜 나이트', blurb: '아귀와 고광렬이 앉는 고스톱. 모든 판이 묻고 더블 ×2로 시작해요.', mount: ctx => mountGostop(ctx, { event: 'tazza' }) },
  { id: 'oceans', event: 'oceans', guide: 'blackjack', name: "Ocean's Heist", blurb: '대니의 크루와 블랙잭. 다섯 판 연속으로 이기면 금고가 열려요.', mount: ctx => mountBlackjack(ctx, { event: 'oceans' }) },
  { id: 'rounders', event: 'rounders', guide: 'poker', name: 'Rounders', blurb: '홀덤 1대1 보스전. 이기면 다음 보스로, 마지막은 KGB 테디.', mount: ctx => mountHoldem(ctx, { tourney: 'rounders' }) },
  { id: 'casablanca', event: 'casablanca', guide: 'roulette', name: 'Casablanca', blurb: '릭의 카페 뒷방 룰렛. 세 번 연속으로 이기면 릭의 보너스.', mount: ctx => mountRoulette(ctx, { event: 'casablanca' }) },
  { id: 'godofgamblers', event: 'godofgamblers', guide: 'dice', name: 'God of Gamblers', blurb: '도신의 홍콩 식보. 네 번 연속으로 맞히면 도신 보너스.', mount: ctx => mountDice(ctx, { event: 'godofgamblers' }) },
  { id: 'whale', event: 'whale', guide: 'poker', name: 'The Whale Room', blurb: '최상위 부자 전용 홀덤 토너먼트. 바이인 1천억, 우승하면 ×10.', mount: ctx => mountHoldem(ctx, { tourney: 'whale' }) },
  { id: 'montecarlo', event: 'montecarlo', guide: 'baccarat', name: 'Monte Carlo Gala', blurb: '갈라 나이트 바카라. 세 판 연속으로 이기면 갈라 보너스.', mount: ctx => mountBaccarat(ctx, { event: 'montecarlo' }) }
];
const eventOf = g => (g.event ? state?.events?.find(e => e.id === g.event) || null : null);
const playable = g => !g.event || Boolean(eventOf(g));

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
  if (name === 'events') renderEventTab();
  if (name === 'lobby' && state) { celebrateFloors(state); maybeOpenDaily(state, applyState); setTimeout(() => maybeAsk(), 1200); }
  if (name === 'profile') renderProfile();
  if (name === 'bank') renderBank(document.querySelector('[data-bank]'), state, applyState);
  if (name === 'shop') renderShop(document.querySelector('[data-shop]'), state, applyState);
  if (name === 'settings') openSettings(); else closeSettings();
  syncWakeLock();
  if (focus) { const heading = target.querySelector('h1'); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); }
}

navItems.forEach(item => item.addEventListener('click', () => showSurface(item.dataset.nav, { focus: true })));

// Where the tier picker and a table go back to: the screen the game was picked on.
let returnSurface = 'games';
const BACK_TO = { lobby: '로비', games: '게임 목록', events: '이벤트' };
function setReturn(from) {
  returnSurface = BACK_TO[from] ? from : 'lobby';
  document.querySelector('[data-tier-back]').textContent = BACK_TO[returnSurface];
}
function setTierHeader(game) {
  document.querySelector('#tiers-title').textContent = game.name;
  document.querySelector('#tier-game-name').textContent = `${game.blurb} 앉을 테이블을 골라 주세요.`;
}

// Tables this player can sit at right now, by the tier picker's rules.
function sittableTiers(game) {
  const available = state?.user?.account?.available ?? 0;
  if (game.event) { const e = eventEntry(eventOf(game)); return e?.open ? [e.tier.slug] : []; }
  return Object.values(TIERS).filter(t => {
    const f = state?.floors?.find(x => x.slug === t.floor);
    return (f ? f.open : t === FIRST_TIER) && available >= t.min;
  }).map(t => t.slug);
}
// Straight to a table: the one last used for this game while it is still open, else the only open one.
function quickTier(game) {
  if (!state) return null;
  const open = sittableTiers(game);
  const last = lastTier(game.id);
  if (last && open.includes(last)) return last;
  return open.length === 1 ? open[0] : null;
}

function chooseGame(button) {
  const game = GAMES.find(g => g.id === button.dataset.game);
  if (!game || game.soon) return;
  lastLobbyTrigger = button;
  setReturn(button.closest('[data-surface]')?.dataset.surface);
  selectedGame = game;
  setTierHeader(game);
  renderTiers();
  const quick = quickTier(game);
  if (quick) { openTable(quick); return; }
  history.pushState({ vegasSurface: 'tiers' }, '', `#tiers-${game.id}`);
  showSurface('tiers', { focus: true });
}

// From a table: the tier picker for the game now selected.
function toTierPicker() {
  setTierHeader(selectedGame);
  renderTiers();
  if (history.state?.vegasSurface === 'table' && tableOverTiers) { history.back(); return; }
  history.replaceState({ vegasSurface: 'tiers' }, '', `#tiers-${selectedGame.id}`);
  showSurface('tiers', { focus: true });
}

// The table name opens a sheet to move to another table or game without leaving.
function openSwitcher() {
  if (!selectedGame || !activeTable) return;
  openTableSwitcher({
    games: GAMES.filter(g => !g.event),
    current: selectedGame,
    currentTier: activeTier,
    tierFor: quickTier,
    tiersOf: game => {
      const open = sittableTiers(game);
      return Object.values(TIERS).filter(t => open.includes(t.slug) || t.slug === activeTier).map(t => ({ ...t, open: open.includes(t.slug) }));
    },
    onTier: slug => openTable(slug),
    onAllTiers: toTierPicker,
    onGame: game => {
      selectedGame = game;
      const quick = quickTier(game);
      if (quick) openTable(quick); else toTierPicker();
    }
  });
}

// A floor this player has outgrown (net worth above 100× its minimum) stays shut; only a seat they
// already hold in a room there can bring them back.
const outgrownTier = slug => Boolean(state?.floors?.find(f => f.slug === TIERS[slug]?.floor)?.outgrown);

// Whether the table's history entry sits on the tier picker's (so ← lands there), and which table is open.
let tableOverTiers = false;
let activeTier = null;
async function openTable(tier, { seated = false } = {}) {
  if (!selectedGame) return;
  if (!seated && outgrownTier(tier)) { setTierHeader(selectedGame); renderTiers(); showSurface('tiers', { focus: true }); return; }
  rememberTable(selectedGame.id, tier);
  activeTier = tier;
  // Moving between tables replaces the table entry, so ← still goes back where the player came from.
  if (history.state?.vegasSurface === 'table') history.replaceState({ vegasSurface: 'table' }, '', `#table-${selectedGame.id}-${tier}`);
  else {
    tableOverTiers = history.state?.vegasSurface === 'tiers';
    history.pushState({ vegasSurface: 'table' }, '', `#table-${selectedGame.id}-${tier}`);
  }
  showSurface('table');
  closeTable();
  voice.preload(selectedGame.guide || selectedGame.id);
  // Event tables play the tense 'noir' cue; every other game has its own band.
  music.theme(selectedGame.event ? 'noir' : selectedGame.id);
  const backLabel = tableOverTiers ? '테이블 고르기로 나가기' : `${BACK_TO[returnSurface]}${returnSurface === 'lobby' ? '로' : '으로'} 나가기`;
  activeTable = await selectedGame.mount({ mount: tableMount, tier, state, backLabel, onSwitch: openSwitcher, onLeave: () => leaveTable() });
  attachGuide(activeTable, selectedGame.guide || selectedGame.id);
  attachQuickSettings(activeTable);
  if (OPENS_WITH_BETS.has(selectedGame.id) && !activeTable.locked) voice.say('place-bets');
  activeTable.root.querySelector('.table-back')?.focus({ preventScroll: true });
}

function closeTable() {
  if (!activeTable) return;
  voice.hush();
  music.theme('lounge');
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
  showSurface(returnSurface); restoreTrigger();
}

document.querySelector('[data-tier-back]').addEventListener('click', () => leaveTable());
window.addEventListener('popstate', event => {
  if (event.state?.vegasSurface === 'tiers') { if (selectedGame) { setTierHeader(selectedGame); renderTiers(); } showSurface('tiers', { focus: true }); return; }
  if (event.state?.vegasSurface === 'table') { showSurface('tiers'); return; }
  if (document.body.classList.contains('game-mode') || document.body.classList.contains('tier-mode')) { showSurface(returnSurface); restoreTrigger(); }
});
window.addEventListener('keydown', event => { if (event.key === 'Escape') leaveTable(); });
// A room screen sends someone back to the table where they still hold a seat.
addEventListener('vegas:open-table', event => {
  const game = GAMES.find(g => g.id === event.detail?.game);
  if (!game) return;
  selectedGame = game;
  if (!document.body.classList.contains('game-mode')) setReturn(document.querySelector('.surface.is-active')?.dataset.surface);
  openTable(TIERS[event.detail.tier] ? event.detail.tier : Object.keys(TIERS)[0], { seated: true });
});

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
  applyCosmetics(state);
  renderRecharge();
  renderGameLists();
  maybeBust(state);
  renderLounge(document.querySelector('[data-lounge]'), state, applyState, openPassShop);
  if (isActive('ranking')) renderRanking();
  if (isActive('profile')) renderProfile();
  if (isActive('bank')) renderBank(document.querySelector('[data-bank]'), state, applyState);
  if (isActive('shop')) renderShop(document.querySelector('[data-shop]'), state, applyState);
  if (isActive('tiers')) renderTiers();
  if (isActive('lobby')) { celebrateFloors(state); maybeOpenDaily(state, applyState); }
}

// The lobby's way back in: a round still holding chips, then the last three tables played.
function sitAt(game, tier, trigger, { seated = false } = {}) {
  lastLobbyTrigger = trigger;
  setReturn('lobby');
  selectedGame = game;
  setTierHeader(game);
  renderTiers();
  openTable(tier, { seated });
}
// An event table only while that event runs, at its own table.
function tableStillThere(game, tier) {
  if (!game || !playable(game) || !TIERS[tier]) return false;
  return !game.event || eventEntry(eventOf(game))?.tier.slug === tier;
}
function renderResume() {
  const slot = document.querySelector('[data-resume]');
  const open = (state?.openRounds || []).map(r => ({ r, game: GAMES.find(g => g.id === r.game) })).filter(x => x.game && playable(x.game));
  slot.hidden = !open.length;
  if (!open.length) { slot.replaceChildren(); return; }
  const { r, game } = open[0];
  const tier = TIERS[r.floor] ? r.floor : (lastTier(game.id) || FIRST_TIER.slug);
  const locked = r.locked || state.user.account.locked || 0;
  const b = el('button', 'resume-button');
  b.type = 'button';
  b.innerHTML = `<span class="resume-text"><strong>진행 중인 판이 있어요 · 이어하기</strong><small>${game.name} · ${TIERS[tier].name}${r.room ? ` · 친구 방 ${r.room}` : ''}${locked ? ` · ${formatCH(locked)} 걸려 있어요` : ''}${open.length > 1 ? ` · 외 ${open.length - 1}판` : ''}</small></span><span class="resume-go" aria-hidden="true">→</span>`;
  b.addEventListener('click', () => sitAt(game, tier, b, { seated: true }));
  slot.replaceChildren(b);
}
function renderRecent() {
  const slot = document.querySelector('[data-recent]');
  const available = state?.user?.account?.available ?? 0;
  const items = recentTables().map(x => ({ ...x, game: GAMES.find(g => g.id === x.game) })).filter(x => tableStillThere(x.game, x.tier) && !outgrownTier(x.tier)).slice(0, 3);
  slot.hidden = !items.length;
  if (!items.length) { slot.replaceChildren(); return; }
  const list = el('ul', 'recent-list');
  for (const { game, tier: slug } of items) {
    const tier = TIERS[slug];
    const short = available < tier.min;
    const li = el('li');
    const b = el('button', 'recent-table');
    b.type = 'button';
    b.innerHTML = `${icon(game.guide || game.id)}<span class="recent-name">${game.name}</span><span class="recent-tier">${tier.name} · ${formatCH(tier.min)}–${formatCH(tier.max)}${short ? ' · 칩이 부족해요' : ''}</span>`;
    b.setAttribute('aria-label', `${game.name} ${tier.name}에 다시 앉기${short ? ', 칩이 부족해요' : ''}`);
    b.disabled = short;
    b.addEventListener('click', () => sitAt(game, slug, b));
    li.append(b);
    list.append(li);
  }
  slot.replaceChildren(el('h2', 'recent-head', '<span id="recent-title">최근 테이블</span>'), list);
}

function renderRecharge() {
  const slot = document.querySelector('[data-recharge-slot]');
  const r = state?.recharge;
  slot.replaceChildren();
  renderResume();
  renderRecent();
  // Short of the cheapest table: the free chips lead as solid buttons (pay first, then recharge,
  // then 구제금융 or 정부 지원금; two at most) and the bank loan follows, outlined, as the
  // secondary way back in.
  const broke = Boolean(state?.bank && state.user.account.available < state.bank.base);
  const note = document.querySelector('[data-vignette-note]');
  if (note) note.textContent = broke ? '무료 칩을 받고 바로 앉아요' : '지금 바로 앉을 수 있어요';
  const daily = dailyButton(state, applyState, { solid: broke });
  if (broke) {
    const free = [daily, r?.eligible ? rechargeButton(r, true) : null, ...supportButtons(state, applyState)].filter(Boolean);
    slot.append(...free.slice(0, 2));
    const b = el('button', 'pill-button', '은행에서 빌리기');
    b.type = 'button';
    b.addEventListener('click', () => showSurface('bank', { focus: true }));
    slot.append(b);
    return;
  }
  if (daily) slot.append(daily);
  if (r?.eligible) slot.append(rechargeButton(r, false));
}

// The server grants a recharge at most once per cooldown, so a retry after a dropped
// connection can't pay twice.
function rechargeButton(r, solid) {
  const b = el('button', `pill-button${solid ? ' pill-button--solid' : ''}`, `칩 충전 +${formatCH(r.amount)}`);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api.recharge(); sound.chips(6); } catch (e) { b.disabled = false; errorToast(e, () => b.click()); }
    refresh();
  });
  return b;
}

// ---------- lobby ----------
// Every table and event has its own key art (scripts/art.mjs draws them): a still life under the lamp.
const art = (id, cls) => `<img class="${cls}" src="art/${id}.svg" alt="" width="480" height="360" loading="lazy" decoding="async">`;

function gameRow(g) {
  const li = el('li');
  const b = el('button', `game-row${g.soon ? ' is-soon' : ''}`);
  b.type = 'button';
  b.dataset.game = g.id;
  if (g.soon) b.setAttribute('aria-disabled', 'true');
  if (g.event) b.classList.add('is-event');
  // 핫 딜러 타임 (lib/hot-table.mjs): the hot game wears a badge and counts down in place of its tagline.
  const hot = !g.event && hotStatus(state).live;
  if (hot && hot.game === g.id) {
    b.classList.add('is-hot');
    b.innerHTML = `${art(g.event || g.id, 'game-row-art')}<span class="game-row-name">${g.name}<span class="hot-badge">HOT ${pct(hot)}</span></span><span class="game-row-desc">핫 딜러 타임 · 이기면 ${pct(hot)} · <span data-hot-left>${clock(Date.parse(hot.endsAt) - hotStatus(state).now)}</span> 남음</span>`;
    b.setAttribute('aria-label', `${g.name}, 핫 테이블, 이기면 순수익 ${pct(hot)}`);
  } else {
    b.innerHTML = `${art(g.event || g.id, 'game-row-art')}<span class="game-row-name">${g.name}</span><span class="game-row-desc">${g.tag || g.blurb}</span>`;
  }
  b.addEventListener('click', () => chooseGame(b));
  li.append(b);
  return li;
}

// Each game is marked by its own table object drawn in a fine ivory line, like an engraved
// menu: no colour, no glow. Colour stays on the felt.
const ICON = {
  blackjack: '<rect x="9" y="10" width="19" height="27" rx="2.5" transform="rotate(-10 18 24)"/><rect x="20" y="11" width="19" height="27" rx="2.5" transform="rotate(8 30 24)"/><path d="M27 29.5l2.6-8 2.6 8M28 27h3.4"/>',
  roulette: '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="3"/><path d="M24 9v5M24 34v5M9 24h5M34 24h5M13.4 13.4l3.5 3.5M31.1 31.1l3.5 3.5M13.4 34.6l3.5-3.5M31.1 16.9l3.5-3.5"/><circle cx="30.5" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
  baccarat: '<rect x="7" y="13" width="17" height="24" rx="2.5"/><rect x="24" y="13" width="17" height="24" rx="2.5"/><path d="M12.5 21.5c0-2 1.4-3 3-3s3 1 3 3-1.4 3.2-3 3.2-3-1.1-3-3.2zM18.5 21.5v4c0 2-1.4 3-3 3s-2.6-.8-2.9-2"/><path d="M29 18.5h6.5l-4.5 11"/>',
  dice: '<path d="M24 8l13 7.5v15L24 38l-13-7.5v-15z"/><path d="M11 15.5L24 23l13-7.5M24 23v15"/><circle cx="24" cy="15.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="27" r="1.3" fill="currentColor" stroke="none"/><circle cx="31" cy="25" r="1.3" fill="currentColor" stroke="none"/><circle cx="31" cy="31" r="1.3" fill="currentColor" stroke="none"/>',
  matgo: '<rect x="14" y="8" width="20" height="32" rx="2"/><circle cx="24" cy="19" r="5.5"/><path d="M14 31c4-3.5 7-4.5 10-4.5s6 1 10 4.5"/>',
  gostop: '<rect x="8" y="11" width="17" height="27" rx="2" transform="rotate(-9 16 24)"/><rect x="23" y="11" width="17" height="27" rx="2" transform="rotate(9 32 24)"/><circle cx="32" cy="20" r="4"/><path d="M11 27.5c2.5-1.5 5-2 8-1"/>',
  seotda: '<rect x="8" y="10" width="15" height="28" rx="2"/><rect x="25" y="10" width="15" height="28" rx="2"/><circle cx="15.5" cy="19" r="3.6"/><circle cx="32.5" cy="19" r="3.6"/><path d="M11 30h9M28 30h9"/>',
  poker: '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="8.5"/><path d="M24 9v5M24 34v5M9 24h5M34 24h5M13.4 13.4l3.5 3.5M31.1 31.1l3.5 3.5M13.4 34.6l3.5-3.5M31.1 16.9l3.5-3.5"/>',
  horses: '<path d="M15 40c1-7 3-12 7-16l-4-2c-1.4-.7-1.6-2.6-.3-3.5l9-6.5c1.6-4 4.6-6.4 8.3-7l-1 3.4c3.6 1.6 5.5 5.6 5.5 10.6 0 6.4-2.4 13.4-3.7 21"/><path d="M26.6 12.4l3.4-5.4M21.8 18.7l1.6.3"/><circle cx="27.8" cy="15.6" r="1.1" fill="currentColor" stroke="none"/>',
  slots: '<rect x="7" y="12" width="34" height="24" rx="3"/><path d="M18.3 12v24M29.7 12v24"/><path d="M12.6 21l1.1 2.3 2.5.3-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.3zM24 21l1.1 2.3 2.5.3-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.3zM35.4 21l1.1 2.3 2.5.3-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.3z"/>'
};
const icon = id => `<svg class="game-row-icon" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICON[id] || ICON.poker}</svg>`;
// The smallest table this player can sit at right now: the lowest floor that is open to them.
function entryMin() {
  const open = Object.values(TIERS).filter(t => {
    const f = state?.floors?.find(x => x.slug === t.floor);
    return f ? f.open : t === FIRST_TIER;
  });
  return (open.length ? Math.min(...open.map(t => t.min)) : FIRST_TIER.min);
}
const GROUPS = [['카지노', ['blackjack', 'roulette', 'baccarat', 'dice', 'poker', 'slots', 'horses']], ['화투', ['matgo', 'gostop', 'seotda']]];
const groupHead = (text, aside = '') => {
  const li = el('li', 'game-group');
  li.setAttribute('role', 'presentation');
  li.innerHTML = `<span>${text}</span>${aside ? `<small>${aside}</small>` : ''}`;
  return li;
};

// Both lists show the everyday tables (events live in the 이벤트 tab); the 게임 tab groups them.
function renderGameLists() {
  const games = GAMES.filter(g => !g.event);
  const byId = id => games.find(g => g.id === id);
  const stake = `최소 ${formatCH(entryMin())}원부터 앉을 수 있어요`;
  document.querySelector('[data-game-grid]').replaceChildren(groupHead('테이블', stake), ...games.map(gameRow));
  document.querySelector('[data-floor-list]').replaceChildren(...GROUPS.flatMap(([name, ids], i) => [groupHead(name, i ? '' : stake), ...ids.map(byId).filter(Boolean).map(gameRow)]));
  renderEvents();
}

// The hot badge follows the clock: the countdown ticks, and the lists redraw when a window opens or closes.
let shownHot = null;
setInterval(() => {
  if (!state) return;
  const { live, now } = hotStatus(state);
  const key = live ? `${live.game}:${live.startsAt}` : '';
  if (key !== shownHot) { shownHot = key; renderGameLists(); return; }
  if (live) document.querySelectorAll('[data-hot-left]').forEach(n => { n.textContent = clock(Date.parse(live.endsAt) - now); });
}, 1000);
// The lounge's hot table block sends players straight to that game's tables.
addEventListener('vegas:choose-game', event => {
  const row = document.querySelector(`.surface.is-active .game-row[data-game="${event.detail?.game}"]`) || document.querySelector(`.game-row[data-game="${event.detail?.game}"]`);
  if (row) chooseGame(row);
});

// The lobby carries one slim teaser for this week's event; the 이벤트 tab has the rest.
function renderEvents() {
  const slot = document.querySelector('[data-events]');
  const g = GAMES.find(x => x.event && eventOf(x) && !eventOf(x).always);
  const ev = g && eventOf(g);
  slot.hidden = !ev;
  if (!ev) { slot.replaceChildren(); return; }
  const b = el('button', `event-banner event-banner--teaser event-banner--${g.id}`);
  b.type = 'button';
  b.innerHTML = `${art(ev.id, 'event-art')}<span class="event-kicker">이번 주 이벤트 · ${timeLeft(ev.until)} 남음</span><strong class="event-title">${ev.title}</strong><span class="event-cta">이벤트 보기</span>`;
  b.addEventListener('click', () => showSurface('events', { focus: true }));
  slot.replaceChildren(b);
  if (document.querySelector('[data-surface="events"]').classList.contains('is-active')) renderEventTab();
}

const dayLabel = iso => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });
function eventCard(ev, { now = false } = {}) {
  const g = GAMES.find(x => x.event === ev.id);
  const card = el('article', `event-banner event-card event-banner--${ev.id}${now ? '' : ' is-upcoming'}`);
  const when = ev.always ? '언제나 열려 있어요' : now ? `${timeLeft(ev.until)} 남음` : `${dayLabel(ev.from)} 시작`;
  card.innerHTML = `${art(ev.id, 'event-art')}<span class="event-kicker">${ev.kicker} · ${when}</span><strong class="event-title">${ev.title}</strong><span class="event-blurb">${ev.blurb}</span><ul class="event-rules">${ev.rules.map(r => `<li>${r}</li>`).join('')}</ul>${entryLine(ev)}`;
  if (now && g) {
    // Entry not met: show what it takes, disabled, rather than a way into an empty tier page.
    const e = eventEntry(ev);
    const locked = Boolean(e && !e.open);
    const go = el('button', `event-cta${locked ? ' is-locked' : ''}`, locked ? `보유 ${formatCH(state?.user?.account?.available ?? 0)} / ${formatCH(e.entry)} 필요` : '테이블에 앉기');
    go.type = 'button';
    go.dataset.game = g.id;
    if (locked) { go.disabled = true; go.setAttribute('aria-label', `입장하려면 보유 칩 ${formatCH(e.entry)} 이상이 필요해요`); }
    else go.addEventListener('click', () => chooseGame(go));
    card.append(go);
  }
  return card;
}
// Events seat only big players: one fixed table, and a minimum holding to sit down.
// Each event names its own table and entry (The Whale Room sits one floor up); older servers
// sent one entry for every event.
function eventEntry(ev) {
  const e = ev?.floor && ev?.entry ? { floor: ev.floor, entry: ev.entry } : state?.eventEntry;
  const tier = e && Object.values(TIERS).find(t => t.floor === e.floor);
  return e && tier ? { ...e, tier, open: (state?.user?.account?.available ?? 0) >= e.entry } : null;
}
function entryLine(ev) {
  const e = eventEntry(ev);
  if (!e) return '';
  return `<p class="event-entry${e.open ? ' is-open' : ''}">입장 · 보유 칩 ${formatCH(e.entry)} 이상 · ${e.tier.name} ${formatCH(e.tier.min)}–${formatCH(e.tier.max)}원${e.open ? '' : ' · 아직 입장할 수 없어요'}</p>`;
}
function renderEventTab() {
  const [now, next, ...later] = state?.eventSchedule || [];
  const live = now && eventOf({ event: now.id }) ? now : null;
  document.querySelector('[data-event-now]').replaceChildren(live ? eventCard(live, { now: true }) : el('p', 'lede', '이번 주에는 열린 이벤트가 없어요.'));
  document.querySelector('[data-event-next]').replaceChildren(...(next ? [eventCard(next)] : []));
  document.querySelector('[data-event-always]').replaceChildren(...(state?.eventsAlways || []).map(ev => eventCard(ev, { now: true })));
  document.querySelector('[data-event-schedule]').replaceChildren(...later.map(ev => {
    const li = el('li', `event-schedule-row event-banner--${ev.id}`);
    li.innerHTML = `<span>${dayLabel(ev.from)}</span><b>${ev.title}</b><small>${ev.kicker}</small>`;
    return li;
  }));
}

function renderLobby() {
  renderGameLists();
  const vignette = document.querySelector('[data-vignette]');
  vignette.addEventListener('click', () => chooseGame(vignette));
}

// The lobby's one orchestrated moment: a hand is dealt under the lamp.
async function dealVignette() {
  const hand = document.querySelector('[data-vignette-hand]');
  const chips = document.querySelector('[data-vignette-chips]');
  const shoe = { left: innerWidth, top: -120, width: 0, height: 0 };
  [50_000_000, 20_000_000, 20_000_000, 10_000_000, 10_000_000].forEach((v, i) => {
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
  // Floors a player has outgrown fold away behind one line; the next locked floor shows what it takes.
  const entry = selectedGame?.event && eventEntry(eventOf(selectedGame));
  if (entry) return renderEventTier(grid, entry);
  const all = Object.values(TIERS).map(tier => ({ tier, floor: floors.find(f => f.slug === tier.floor) }));
  const outgrown = all.filter(x => x.floor?.outgrown);
  const firstLocked = all.findIndex(x => x.floor && !x.floor.unlocked);
  const shown = all.filter((x, i) => !x.floor?.outgrown && (firstLocked < 0 || i <= firstLocked + 1));
  const note = outgrown.length ? [el('p', 'tier-outgrown', `${outgrown.map(x => x.tier.name).join(' · ')}은 졸업했어요. 순자산이 최소 베팅의 100배를 넘으면 그 층에는 앉지 않아요.`)] : [];
  grid.replaceChildren(...note, ...shown.map(({ tier, floor }) => {
    const locked = floor ? !floor.unlocked : false;
    // Reached by net worth but its pass (one of the floor's skins, 상점 꾸미기) not bought yet.
    const needsPass = Boolean(floor && floor.unlocked && !floor.passed);
    const broke = available < tier.min;
    const b = el('button', `tier-card tier-card--${tier.slug}${locked || needsPass ? ' is-locked' : ''}${needsPass ? ' needs-pass' : ''}`);
    b.setAttribute('role', 'listitem');
    b.type = 'button';
    b.dataset.tier = tier.slug;
    b.dataset.min = tier.min;
    b.disabled = locked || (broke && !needsPass);
    const chips = el('span', 'tier-chips');
    tier.chips.forEach((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); chips.append(c); });
    const status = locked ? `순자산 ${formatCH(floor?.threshold || 0)}원${floor?.passed ? '' : ' + 입장 꾸미기'}로 열려요 (${Math.round((floor?.progress || 0) * 100)}%)` : needsPass ? `입장하려면 이 층 꾸미기를 하나 사 주세요 · ${formatCH(floor.minBet * 2)}원부터` : broke ? '칩이 부족해요 · 은행에서 빌릴 수 있어요' : floor?.ceiling ? `순자산 ${formatCH(floor.ceiling)}원을 넘으면 졸업` : '끝없는 층';
    const stars = `<em class="tier-stars" aria-label="난이도 ${tier.stars}/5">${'★'.repeat(tier.stars)}${'☆'.repeat(5 - tier.stars)}</em>`;
    b.innerHTML = `<strong>${tier.name}${stars}</strong><span>${formatCH(tier.min)} – ${formatCH(tier.max)}원</span><small>${status}</small>`;
    chips.setAttribute('aria-hidden', 'true');
    b.append(chips);
    b.addEventListener('click', () => needsPass ? openPassShop(floor.slug) : openTable(tier.slug));
    return b;
  }));
}

// The shop's 꾸미기 tab, scrolled to the skins that open `floor`.
function openPassShop(floor) {
  showShopTab('cosmetics', floor);
  showSurface('shop', { focus: true });
}

// An event plays at one table only, open to players holding the event entry.
function renderEventTier(grid, { tier, entry, open }) {
  const b = el('button', `tier-card tier-card--${tier.slug}${open ? '' : ' is-locked'}`);
  b.setAttribute('role', 'listitem');
  b.type = 'button';
  b.dataset.tier = tier.slug;
  b.dataset.min = tier.min;
  b.disabled = !open;
  const chips = el('span', 'tier-chips');
  tier.chips.forEach((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); chips.append(c); });
  chips.setAttribute('aria-hidden', 'true');
  b.innerHTML = `<strong>${tier.name}</strong><span>${formatCH(tier.min)} – ${formatCH(tier.max)}원</span><small>${open ? `이벤트 전용 테이블 · 보유 ${formatCH(entry)} 이상 입장` : `보유 칩 ${formatCH(entry)} 이상만 입장할 수 있어요`}</small>`;
  b.append(chips);
  b.addEventListener('click', () => openTable(tier.slug));
  grid.replaceChildren(b);
}

// ---------- ranking ----------
// "이번 주" is the weekly season (resets Monday 00:00 KST, top three get prizes); "전체" is all time.
const RANK_TABS = {
  season: [['profit', '수익'], ['wins', '승리'], ['highRoller', '베팅량']],
  allTime: [['wealth', '순자산'], ['profit', '수익'], ['highRoller', '베팅량']]
};
let rankPeriod = 'season';
let rankTab = 'profit';
function timeLeft(iso) {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60;
  return d > 0 ? `${d}일 ${h}시간` : h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}
// Rank changes since this device last looked at a board: the ranks seen then are kept per board,
// read once a session (so the arrows stay put while you flip tabs) and saved with every look.
const RANK_SEEN_KEY = 'vegas:rank-seen';
let rankSeen = null;
let rankBoardShown = '';
function rankMoves(board, rows) {
  if (!rankSeen) { try { rankSeen = JSON.parse(localStorage.getItem(RANK_SEEN_KEY) || '{}') || {}; } catch { rankSeen = {}; } }
  const before = rankSeen[board]?.ranks;
  const moves = new Map();
  if (before) for (const r of rows) moves.set(r.id, before[r.id] == null ? 'new' : before[r.id] - r.rank);
  try {
    const saved = JSON.parse(localStorage.getItem(RANK_SEEN_KEY) || '{}') || {};
    saved[board] = { at: Date.now(), ranks: Object.fromEntries(rows.map(r => [r.id, r.rank])) };
    for (const k in saved) if (Date.now() - (saved[k]?.at || 0) > 30 * 86_400_000) delete saved[k];
    localStorage.setItem(RANK_SEEN_KEY, JSON.stringify(saved));
  } catch {}
  return moves;
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
    head.innerHTML = `<div class="season-card"><div><strong>${season.name}</strong><small>${timeLeft(season.endsAt)} 남음 · 월요일 0시에 새로 시작</small></div><ol class="season-prizes" aria-label="상금은 각자 앉는 가장 낮은 테이블 최소 베팅의 배수"><li><b>1위</b> ×300</li><li><b>2위</b> ×200</li><li><b>3위</b> ×100</li></ol></div>`
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
  // Each row wears the player's three dearest luxury pieces (lib/shop.mjs); a tap opens their collection.
  const showcase = r => (r.showcase || []).map(id => luxuryItem(state, id)).filter(Boolean).map(x => luxuryIcon(x.icon, 'rank-lux')).join('');
  const board = rankPeriod === 'season' ? `season:${season.id}:${rankTab}` : `allTime:${rankTab}`;
  const move = rankMoves(board, rows);
  const moveTag = r => {
    const m = move.get(r.id);
    if (m == null) return '';
    if (m === 'new') return '<span class="rank-move rank-move--new">NEW</span>';
    return m > 0 ? `<span class="rank-move rank-move--up" aria-label="${m}계단 올라감">▲${m}</span>` : m < 0 ? `<span class="rank-move rank-move--down" aria-label="${-m}계단 내려감">▼${-m}</span>` : '';
  };
  const open = (node, r) => {
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `${r.rank}위 ${r.nickname}, 컬렉션 보기`);
    node.addEventListener('click', () => openPlayerSheet(state, r));
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerSheet(state, r); } });
  };
  // The top three stand on a podium: 2nd, 1st, 3rd, the winner raised in the middle.
  const top = rows.filter(r => r.rank <= 3);
  const podium = document.querySelector('[data-rank-podium]');
  // The podium rises only when a board first shows, not on every chip update after.
  podium.classList.toggle('is-fresh', board !== rankBoardShown);
  rankBoardShown = board;
  podium.replaceChildren(...[2, 1, 3].map(n => top.find(r => r.rank === n)).filter(Boolean).map(r => {
    const li = el('li', `podium-spot podium-spot--${r.rank}${r.id === me ? ' is-me' : ''}`);
    const lux = showcase(r);
    li.innerHTML = `<span class="podium-medal">${r.rank}</span><span class="podium-name">${nameFrame(state, r.id, r.nickname)}${r.id === me ? ' <small>나</small>' : ''}</span>${moveTag(r)}<span class="podium-value">${value(r)}</span>${lux ? `<span class="rank-showcase">${lux}</span>` : ''}<span class="podium-step" aria-hidden="true"></span>`;
    open(li, r);
    return li;
  }));
  // Where I stand: the gap to the next rank up, or how far ahead I am at the top.
  const mine = rows.find(r => r.id === me);
  const meBox = document.querySelector('[data-rank-me]');
  meBox.replaceChildren();
  if (mine) {
    const above = rows.find(r => r.rank === mine.rank - 1);
    const below = rows.find(r => r.rank === mine.rank + 1);
    const gap = (a, b) => rankTab === 'wins' ? `${a.value - b.value}승` : formatCH(a.value - b.value);
    const line = mine.rank === 1
      ? (below ? `1위 지키는 중 · 2위 ${below.nickname}보다 ${gap(mine, below)} 앞서요` : '1위예요')
      : above ? `${above.nickname}(${above.rank}위)까지 ${gap(above, mine)} 남았어요` : '';
    meBox.innerHTML = `<span class="rank-me-no">${mine.rank}<small>위</small></span><span class="rank-me-text"><b>나 ${moveTag(mine)}</b><small>${line}</small></span><span class="rank-me-value">${value(mine)}</span>`;
  }
  const rest = rows.filter(r => r.rank > 3);
  document.querySelector('[data-rank-list]').replaceChildren(...rest.map(r => {
    const li = el('li', `rank-row${r.id === me ? ' is-me' : ''}`);
    const lux = showcase(r);
    li.innerHTML = `<span class="rank-no">${r.rank}</span><span class="rank-name">${nameFrame(state, r.id, r.nickname)}${r.id === me ? ' <small>나</small>' : ''}${moveTag(r)}${lux ? `<span class="rank-showcase">${lux}</span>` : ''}</span><span class="rank-value">${value(r)}</span>`;
    open(li, r);
    return li;
  }));
  if (!rows.length) document.querySelector('[data-rank-list]').innerHTML = '<li class="rank-empty">아직 이 순위에 오른 사람이 없어요. 한 판 하고 첫 이름을 올려 보세요.</li>';
  renderDuels(document.querySelector('[data-duels]'), state, applyState);
}

// ---------- profile ----------
function renderProfile() {
  const root = document.querySelector('[data-profile]');
  if (!state) { root.textContent = '불러오는 중…'; return; }
  const u = state.user, a = u.account;
  const floors = state.floors.map(f => `<li class="floor-row${f.open ? ' is-open' : ''}${f.outgrown ? ' is-outgrown' : ''}"><span>${f.name}${f.outgrown ? ' <small>졸업</small>' : f.unlocked && !f.passed ? ' <small>입장 꾸미기 필요</small>' : ''}</span><span class="floor-bar"><i style="width:${Math.round(f.progress * 100)}%"></i></span></li>`).join('');
  const eng = state.engagement || {};
  const badges = (eng.badges || []).map(b => `<li class="badge badge--${b.rank}"><span class="badge-star" aria-hidden="true"></span><b>${b.rank}위</b><small>${b.name}</small></li>`).join('');
  // Per-game record: win rate, biggest win and net, most played first.
  const games = Object.entries(u.stats || {}).sort((x, y) => y[1].rounds - x[1].rounds).map(([g, s]) => {
    const rate = s.rounds ? Math.round((s.wins / s.rounds) * 100) : 0;
    return `<tr><th scope="row">${gameName(g)}</th><td>${s.rounds}</td><td>${rate}%</td><td>${formatCH(s.biggestWin)}</td><td class="${s.pnl > 0 ? 'pos' : s.pnl < 0 ? 'neg' : ''}">${s.pnl > 0 ? '+' : ''}${formatCH(s.pnl)}</td></tr>`;
  }).join('');
  // 자산: the luxury on show (lib/shop.mjs), dearest first. Trophies only; floors run on chips.
  const owned = (u.luxury || []).map(x => ({ ...x, item: luxuryItem(state, x.id) })).filter(x => x.item).sort((p, q) => q.price - p.price);
  const assets = u.assets ?? state.shop?.assets ?? 0;
  const showcase = owned.length
    ? `<ul class="showcase-list showcase-list--profile">${owned.map(x => `<li>${luxuryIcon(x.item.icon)}<span>${x.item.name}</span><small>${formatCH(x.price)}</small></li>`).join('')}</ul>`
    : '<p class="lounge-note">아직 산 사치품이 없어요. 상점에서 시계부터 섬까지 살 수 있어요.</p>';
  const totals = Object.values(u.stats || {}).reduce((t, s) => ({ rounds: t.rounds + s.rounds, wins: t.wins + s.wins, best: Math.max(t.best, s.biggestWin) }), { rounds: 0, wins: 0, best: 0 });
  root.innerHTML = `
    <div class="profile-card">
      <div><strong>${nameFrame(state, u.id, u.nickname)}</strong><small>보유 ${formatFull(a.available)}원${assets ? ` · 자산 ${formatFull(assets)}원` : ''}${state.bank?.debt ? ` · 빚 ${formatFull(state.bank.debt)}원 · 신용 ${state.bank.credit.grade}등급` : ''}</small></div>
    </div>
    <dl class="stat-grid">
      <div><dt>총 손익</dt><dd class="${a.qualifiedPnl >= 0 ? 'pos' : 'neg'}">${a.qualifiedPnl >= 0 ? '+' : ''}${formatCH(a.qualifiedPnl)}</dd></div>
      <div><dt>총 베팅</dt><dd>${formatCH(a.totalWagered)}</dd></div>
      <div><dt>최고 자산</dt><dd>${formatCH(a.peakBankroll)}</dd></div>
      <div><dt>승률</dt><dd>${totals.rounds ? Math.round((totals.wins / totals.rounds) * 100) : 0}%</dd></div>
      <div><dt>최대 승리</dt><dd>${formatCH(totals.best)}</dd></div>
      <div><dt>최장 연승</dt><dd>${eng.streak?.best || 0}연승${eng.streak?.current > 1 ? ` <small>지금 ${eng.streak.current}</small>` : ''}</dd></div>
    </dl>
    <h2 class="sub-head">자산 <small>${formatCH(assets)}원 · 사치품 ${owned.length}점</small></h2>
    ${showcase}
    <button type="button" class="pill-button profile-shop" data-go-shop>상점 가기</button>
    ${badges ? `<h2 class="sub-head">시즌 배지</h2><ul class="badge-list">${badges}</ul>` : ''}
    <h2 class="sub-head">업적 <small>${(state.achievements || []).filter(x => x.claimed).length} / ${(state.achievements || []).length}</small></h2><div data-achievements></div>
    <h2 class="sub-head">게임별 기록</h2>
    ${games ? `<div class="game-stats-wrap"><table class="game-stats"><thead><tr><th scope="col">게임</th><th scope="col">판</th><th scope="col">승률</th><th scope="col">최대 승리</th><th scope="col">손익</th></tr></thead><tbody>${games}</tbody></table></div>` : '<p class="lounge-note">아직 플레이한 게임이 없어요.</p>'}
    <h2 class="sub-head">층</h2><ul class="floor-rows">${floors}</ul>
    <div data-ledger></div>
    <h2 class="sub-head">계정</h2>
    <div class="account-row"><span>${state.username ? `<b>${state.username}</b> 계정으로 로그인 중` : '로그인 중'}</span><button type="button" class="pill-button" data-sign-out>로그아웃</button></div>`;
  renderAchievements(root.querySelector('[data-achievements]'));
  root.querySelector('[data-go-shop]').addEventListener('click', () => showSurface('shop', { focus: true }));
  renderLedger(root.querySelector('[data-ledger]'), state);
  renderAdmin(root, state, applyState);
  root.querySelector('[data-sign-out]').addEventListener('click', async () => {
    await forgetDevice();
    await api.logout().catch(() => {});
    signedOut();
  });
}

// Achievements: ready-to-claim ones first, then the rest by group; finished ones fold to a line.
function renderAchievements(box) {
  const list = state.achievements || [];
  const ready = list.filter(a => a.done && !a.claimed);
  const open = list.filter(a => !a.done);
  const done = list.filter(a => a.claimed);
  const row = a => {
    const li = el('li', `mission${a.done ? ' is-done' : ''}${a.claimed ? ' is-claimed' : ''}`);
    li.innerHTML = `<div class="mission-text"><span>${a.label} <small class="ach-group">${a.group}</small></span><small>${a.desc} · ${Math.min(a.progress, a.target).toLocaleString('ko-KR')} / ${a.target.toLocaleString('ko-KR')} · 보상 ${formatCH(a.reward)}</small><span class="mission-bar"><i style="width:${Math.round((Math.min(a.progress, a.target) / a.target) * 100)}%"></i></span></div>`;
    if (a.done && !a.claimed) {
      const b = el('button', 'pill-button pill-button--solid mission-claim', '받기');
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { const out = await api.achievementClaim(a.id); await chipsToWallet(b, out.claim.amount); applyState(out.state); }
        catch (e) { b.disabled = false; errorToast(e, () => b.click()); }
      });
      li.append(b);
    }
    return li;
  };
  const ul = el('ul', 'mission-list');
  ul.append(...ready.map(row), ...open.slice(0, ready.length ? 4 : 6).map(row));
  const more = el('details', 'ach-more');
  more.innerHTML = `<summary>모든 업적 보기</summary>`;
  const all = el('ul', 'mission-list');
  all.append(...[...open.slice(ready.length ? 4 : 6), ...done].map(row));
  more.append(all);
  box.replaceChildren(ul, more);
}

// The notification sheet only interrupts the menus, never a hand in progress.
const inMenus = () => !document.body.classList.contains('game-mode') && !document.body.classList.contains('tier-mode');
// …and only once the player has finished a round and today's pay sheet is out of the way, so a
// new player's first screen is the free chips, not a permission prompt.
const askReady = () => Boolean(state) && !dailyDue(state) && Object.values(state.user?.stats || {}).some(s => s.rounds > 0);

// ---------- account ----------
function signedIn(next) {
  shownWallet = null;
  applyState(next);
  startNotifications(inMenus, askReady);
  startNews();
  renderTiers();
  showSurface('lobby');
  ensureTerms();
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

mountInstallButton(document.querySelector('[data-install]'));
watchConnection(refresh);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

renderLobby();
showSurface('lobby');
history.replaceState({ vegasSurface: 'lobby' }, '', location.pathname);
if (sessionToken()) refresh().then(() => { renderTiers(); if (state) { startNotifications(inMenus, askReady); startNews(); ensureTerms(); } });
else openSignIn(signedIn);
dealVignette();
startPlaytime({ isInTable: () => document.body.classList.contains('game-mode') });
