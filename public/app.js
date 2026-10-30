// VEGAS client: floor navigation, lobby, rankings, profile, and mounting live tables.
import { api, sessionToken, clearSession } from './js/api.js';
import { openSignIn } from './js/auth.js';
import { renderAdmin } from './js/admin.js';
import { renderAccountTools, forgetShownCode } from './js/account.js';
import { formatCH, formatMoney, rollNumber, isMuted, setMuted, sound, preloadSounds, el, setTableUnits, inTableUnits } from './js/fx.js';
import { moneyOf } from './js/money.js';
import { buyInSheet, cashOutQuiet } from './js/cashier.js';
import { music } from './js/music.js';
import { voice, OPENS_WITH_BETS } from './js/voice.js';
import { TIERS, FIRST_TIER, createChip } from './js/chips.js';
import { settings, onSettings } from './js/settings.js';
import { renderSettings, attachQuickSettings } from './js/settings-panel.js';
import { renderDuels, watchBlock } from './js/social.js';
import { renderLounge, openDailySheet, dailyDue, celebrateFloors, gameName, chipsToWallet, missionsBlock, feedBlock } from './js/lounge.js';
import { startNotifications, maybeAsk, forgetDevice } from './js/notify.js';
import { mountInstallButton } from './js/install.js';
import { startNews, stopNews } from './js/news.js';
import { maybeBust } from './js/bust.js';
import { renderBank, claimSupport } from './js/bank.js';
import { dayBlock } from './js/day-sheet.js';
import { errorToast, watchConnection, toast } from './js/notice.js';
import { mountNightly } from './js/nightly.js';
import { hotStatus, clock, pct, startTime } from './js/hot.js';
import { renderShop, applyCosmetics, openPlayerSheet, showShopTab, nameFrame, openSheet } from './js/shop.js';
import { rememberTable, recentTables, lastTier, openTableSwitcher } from './js/table-nav.js';
import { ensureTerms } from './js/terms.js';
import { startPlaytime } from './js/playtime.js';
import { capturePendingJoin, pendingJoin, dropPendingJoin, setPendingJoin } from './js/invite.js';
import { showFriends } from './js/friends.js';
import { onGuestState, openNameSheet, guestCard, renderInviteCard } from './js/guest.js';
import { isNewcomer, isSettlingIn, firstDayCard } from './js/first-day.js';
import { noteRpChange } from './js/rp-pop.js';
import { watchErrors } from './js/error-report.js';
import { openWrapped, wrappedBlock } from './js/wrapped.js';
import { startShine } from './js/shine.js';
import { setBragName, bragButton } from './js/share.js';
import { handBookBlock, watchHandBook } from './js/hand-book.js';
import { replayBlock, loadReplays } from './js/replay.js';
import { bragRank, bragTier } from './js/brags.js';
import { remember } from './js/seen.js';
import { tierHeroHtml, promoHtml, rpCardHtml, leagueHtml, tierStepsHtml, tierPastHtml, friendRecordHtml, myMonthRank } from './js/rank-tab.js';
import { tierEmblem, tierName, rankBadges, celebrateTier, maybeSeasonMoment, maybeSeasonWarning, seasonEndBlock, seasonEnding, seasonLeft, seasonClock, watchSeasonEnd } from './js/rank.js';

watchErrors();
startShine();
watchHandBook();

document.documentElement.dataset.vegasUi = 'live-tables';

// Each game's code (and what only it needs: cards, hwatu, the table kit) loads the first time a table opens,
// so the home screen downloads and parses only the lobby. warmGame() fetches one ahead of time when idle.
const GAME_FILES = {
  blackjack: () => import('./js/games/blackjack.js'),
  baccarat: () => import('./js/games/baccarat.js'),
  roulette: () => import('./js/games/roulette.js'),
  dice: () => import('./js/games/dice.js'),
  matgo: () => import('./js/games/matgo.js'),
  gostop: () => import('./js/games/gostop.js'),
  seotda: () => import('./js/games/seotda.js'),
  holdem: () => import('./js/games/holdem.js'),
  sevenpoker: () => import('./js/games/sevenpoker.js'),
  slots: () => import('./js/games/slots.js'),
  horses: () => import('./js/games/horses.js')
};
const loadGuide = () => import('./js/guide.js');
function lazyGame(file, fn, opts) {
  const mount = ctx => GAME_FILES[file]().then(mod => mod[fn](ctx, opts));
  mount.load = () => Promise.all([GAME_FILES[file](), loadGuide()]);
  return mount;
}

const warmGame = game => game?.mount?.load?.().catch(() => {});
// A finger on a game card is a few hundred ms ahead of the table opening: start fetching then.
addEventListener('pointerdown', event => warmGame(GAMES.find(g => g.id === event.target.closest?.('[data-game]')?.dataset.game)), { capture: true, passive: true });

const GAMES = [
  { id: 'blackjack', name: '블랙잭', tag: '21에 가깝게, 블랙잭은 3 대 2', blurb: '21에 가깝게. 블랙잭은 3 대 2로 받아요.', mount: lazyGame('blackjack', 'mountBlackjack') },
  { id: 'roulette', name: '룰렛', tag: '싱글 제로 휠, 숫자 하나에 35배', blurb: '싱글 제로 유럽식 휠. 숫자 하나에 걸면 35배.', mount: lazyGame('roulette', 'mountRoulette') },
  { id: 'baccarat', name: '바카라', tag: '플레이어냐 뱅커냐', blurb: '플레이어와 뱅커 중 한쪽에. 카드는 천천히 열려요.', mount: lazyGame('baccarat', 'mountBaccarat') },
  { id: 'dice', name: '식보', tag: '주사위 세 개의 합', blurb: '주사위 세 개의 합을 맞혀요.', mount: lazyGame('dice', 'mountDice') },
  { id: 'matgo', name: '맞고', tag: '둘이서 치는 고스톱', blurb: '둘이서 치는 고스톱. AI보다 먼저 7점을 내세요.', mount: lazyGame('matgo', 'mountMatgo') },
  { id: 'gostop', name: '고스톱', tag: 'AI 둘과 셋이서 고·스톱', blurb: '셋이서 치는 고스톱. AI 둘과 3점부터 고·스톱.', mount: lazyGame('gostop', 'mountGostop') },
  { id: 'seotda', name: '섯다', tag: '두 장으로 겨루는 족보 싸움', blurb: '화투 두 장의 족보 싸움. 땡잡이와 암행어사까지.', mount: lazyGame('seotda', 'mountSeotda') },
  { id: 'poker', name: '홀덤', tag: 'AI들과 텍사스 홀덤', blurb: 'AI 플레이어들과 텍사스 홀덤. 칩으로 바이인하고 앉아요.', mount: lazyGame('holdem', 'mountHoldem') },
  { id: 'sevenpoker', name: '7포커', tag: '석 장 받고 한 장 오픈, 히든까지', blurb: 'AI들과 한국식 7포커. 석 장 중 한 장을 오픈하고 히든까지 일곱 장, 삥·따당·하프로 겨뤄요.', mount: lazyGame('sevenpoker', 'mountSevenPoker') },
  { id: 'slots', name: '슬롯', tag: '별 세 개면 잭팟', blurb: '레버를 당겨요. 별 세 개면 모두가 키운 잭팟이 터져요.', mount: lazyGame('slots', 'mountSlots') },
  { id: 'horses', name: '경마', tag: '여섯 마리, 1200m 단거리', blurb: '여섯 마리 중 1등을 맞혀요. 단승은 1착, 연승은 2착 안에만 들면 돼요.', mount: lazyGame('horses', 'mountHorses') },
  // Event tables (lib/events.mjs): one runs each week, reached from the 이벤트 tab.
  { id: 'royale', event: 'royale', guide: 'poker', name: 'Casino Royale', blurb: '007 체험 이벤트. 하이롤러 다섯 명과 홀덤 토너먼트, 마지막 한 사람이 판돈을 전부 가져가요.', mount: lazyGame('holdem', 'mountHoldem', { royale: true }) },
  { id: 'tazza', event: 'tazza', guide: 'gostop', name: '타짜 나이트', blurb: '아귀와 고광렬이 앉는 고스톱. 모든 판이 묻고 더블 ×2로 시작해요.', mount: lazyGame('gostop', 'mountGostop', { event: 'tazza' }) },
  { id: 'oceans', event: 'oceans', guide: 'blackjack', name: "Ocean's Heist", blurb: '대니의 크루와 블랙잭. 다섯 판 연속으로 이기면 금고가 열려요.', mount: lazyGame('blackjack', 'mountBlackjack', { event: 'oceans' }) },
  { id: 'rounders', event: 'rounders', guide: 'poker', name: 'Rounders', blurb: '홀덤 1대1 보스전. 이기면 다음 보스로, 마지막은 KGB 테디.', mount: lazyGame('holdem', 'mountHoldem', { tourney: 'rounders' }) },
  { id: 'casablanca', event: 'casablanca', guide: 'roulette', name: 'Casablanca', blurb: '릭의 카페 뒷방 룰렛. 세 번 연속으로 이기면 릭의 보너스.', mount: lazyGame('roulette', 'mountRoulette', { event: 'casablanca' }) },
  { id: 'godofgamblers', event: 'godofgamblers', guide: 'dice', name: 'God of Gamblers', blurb: '도신의 홍콩 식보. 네 번 연속으로 맞히면 도신 보너스.', mount: lazyGame('dice', 'mountDice', { event: 'godofgamblers' }) },
  { id: 'whale', event: 'whale', guide: 'poker', name: 'The Whale Room', blurb: '최상위 부자 전용 홀덤 토너먼트. 바이인 1천억, 우승하면 ×10.', mount: lazyGame('holdem', 'mountHoldem', { tourney: 'whale' }) },
  { id: 'montecarlo', event: 'montecarlo', guide: 'baccarat', name: 'Monte Carlo Gala', blurb: '갈라 나이트 바카라. 세 판 연속으로 이기면 갈라 보너스.', mount: lazyGame('baccarat', 'mountBaccarat', { event: 'montecarlo' }) }
];
const eventOf = g => (g.event ? state?.events?.find(e => e.id === g.event) || null : null);
const playable = g => !g.event || Boolean(eventOf(g));

const surfaces = [...document.querySelectorAll('[data-surface]')];
const navItems = [...document.querySelectorAll('[data-nav]')];
const walletEl = document.querySelector('[data-wallet]');
const walletHeld = document.querySelector('[data-wallet-held]');
const tableMount = document.querySelector('[data-table-mount]');
let state = null;
let lastLobbyTrigger = null;
let selectedGame = null;
let activeTable = null;
let shownWallet = null;

// ---------- navigation ----------
const NAV_GROUP = { shop: 'bank', settings: 'profile' };
function showSurface(name, { focus = false } = {}) {
  const target = surfaces.find(s => s.dataset.surface === name);
  if (!target) return;
  if (name !== 'table' && name !== 'tiers') setTimeout(offerUpdate, 800);
  surfaces.forEach(s => s.classList.toggle('is-active', s === target));
  // The bottom menu has six places; 지갑 holds 지갑 and 상점, 내 정보 holds 프로필 and 설정,
  // each switched by the small tabs at the top of the page.
  const group = NAV_GROUP[name] || name;
  navItems.forEach(item => {
    const sub = item.classList.contains('subtab');
    const on = sub ? item.dataset.nav === name : item.classList.contains('nav-item') && item.dataset.nav === group;
    item.classList.toggle('is-active', on);
    if (sub) item.setAttribute('aria-selected', String(on));
  });
  document.body.classList.toggle('game-mode', name === 'table');
  document.body.classList.toggle('tier-mode', name === 'tiers');
  // At a table amounts are counted in chips (js/money.js), everywhere else in 원.
  setTableUnits(name === 'table');
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (name !== 'table') closeTable();
  if (name === 'ranking') renderRanking();
  if (name === 'events') renderEventTab();
  // A newcomer's first hands come without popups (js/first-day.js).
  if (name === 'lobby' && state && !isSettlingIn(state)) { celebrateFloors(state); celebrateTier(state); setTimeout(() => maybeAsk(), 1200); }
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
function sittableTiers(game, st = state) {
  // At a table, its chips; in the lobby, everything a buy-in can be paid from.
  const available = document.body.classList.contains('game-mode') && st?.cashier?.on ? st?.user?.account?.available ?? 0 : moneyOf(st);
  if (game.event) { const e = eventEntry(eventOf(game)); return e?.open ? [e.tier.slug] : []; }
  return Object.values(TIERS).filter(t => {
    const f = st?.floors?.find(x => x.slug === t.floor);
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

// After a round, a table the player can no longer sit at gives way to one they can, with a card
// saying so: after losses below its smallest bet, down to the highest table they can afford; after
// outgrowing its floor, up to the next open one. The same check runs on sitting down. Event tables
// and friends' rooms stay put, and so does poker, played from a buy-in on the table. With nowhere
// to go (chips under the cheapest table) the bust and 구제금융 screens take over.
const BUY_IN_GAMES = new Set(['poker', 'sevenpoker']);
function tableAfterRound(st) {
  const t = activeTable, cur = TIERS[activeTier];
  if (!st?.user || !t || !cur || !selectedGame || selectedGame.event || BUY_IN_GAMES.has(selectedGame.id) || t.root.classList.contains('is-room')) return;
  // 캐셔: the stack ran under this table's smallest bet with money still in the wallet. Not a bust
  // and no move downstairs: offer more chips right at this seat (or getting up).
  if (st.cashier?.on && st.user.account.available < cur.min && (st.cashier.floors?.[cur.slug]?.max ?? 0) >= cur.min) { buyMore('rebuy', st); return; }
  const open = sittableTiers(selectedGame, st);
  if (open.includes(cur.slug)) return;
  const tiers = Object.values(TIERS).filter(x => open.includes(x.slug));
  if (!tiers.length) return;
  const up = Boolean(st.floors?.find(f => f.slug === cur.floor)?.outgrown);
  const to = up ? tiers.find(x => x.min > cur.min) || tiers.at(-1) : [...tiers].reverse().find(x => x.min < cur.min) || tiers[0];
  const reason = up
    ? (st.rp?.floors ? `티어가 올라 ${cur.name}을 졸업하고 위층으로 올라왔어요.` : `자산이 커져서 ${cur.name}을 졸업하고 위층으로 올라왔어요.`)
    : `칩이 ${cur.name} 최소 베팅 ${formatMoney(cur.min)}보다 적어서 옮겼어요.`;
  applyState(st);
  openTable(to.slug).then(() => activeTable?.moved?.(`${to.name} · ${formatCH(to.min)}–${formatCH(to.max)}`, reason));
}

// A floor this player has outgrown (net worth above 100× its minimum) stays shut; only a seat they
// already hold in a room there can bring them back.
const outgrownTier = slug => Boolean(state?.floors?.find(f => f.slug === TIERS[slug]?.floor)?.outgrown);

// Whether the table's history entry sits on the tier picker's (so ← lands there), and which table is open.
let tableOverTiers = false;
let activeTier = null;
let tableSeq = 0;
async function openTable(tier, { seated = false, firstBet = false } = {}) {
  if (!selectedGame) return;
  if (!seated && outgrownTier(tier)) { setTierHeader(selectedGame); renderTiers(); showSurface('tiers', { focus: true }); return; }
  // 캐셔 (js/cashier.js): not seated yet (chips held without a seat go back to the wallet), or
  // short of this table's smallest bet (an event: its entry) in hand: buy chips with money first.
  const eventNeed = selectedGame.event ? [...(state?.events || []), ...(state?.eventsAlways || [])].find(e => e.id === selectedGame.event)?.entry || 0 : 0;
  if (!seated && state?.cashier?.on && TIERS[tier] && (!state.cashier.seat || state.user.account.available < Math.max(TIERS[tier].min, eventNeed))) {
    const bought = await buyInSheet(state, TIERS[tier], { event: selectedGame.event || null });
    if (!bought) return;
    applyState(bought);
  }
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
  // The first visit to a game fetches its code. Say so if that takes a moment, and give up quietly if the
  // player left (or picked another table) before it arrived.
  const game = selectedGame;
  const seq = ++tableSeq;
  const slow = setTimeout(() => { if (seq === tableSeq) { const note = el('p', 'table-loading', '테이블 준비 중…'); note.setAttribute('role', 'status'); tableMount.replaceChildren(note); } }, 150);
  let guide;
  try { [, guide] = await game.mount.load(); } catch (err) {
    clearTimeout(slow);
    if (seq !== tableSeq) return;
    tableMount.replaceChildren();
    toast(navigator.onLine ? '테이블을 열지 못했어요. 다시 눌러 주세요.' : '연결이 끊겨 테이블을 열지 못했어요. 다시 눌러 주세요.');
    leaveTable();
    return;
  }
  clearTimeout(slow);
  if (seq !== tableSeq || !document.body.classList.contains('game-mode')) return;
  tableMount.replaceChildren();
  activeTable = await game.mount({ mount: tableMount, tier, state, backLabel, onSwitch: openSwitcher, onLeave: () => leaveTable() });
  // Also on sitting down: a table picked from 최근 테이블 may no longer fit the player's chips.
  activeTable.onIdle = st => tableAfterRound(st || state);
  if (!seated) { activeTable.idleDue = true; setTimeout(() => activeTable?.maybeIdle?.(), 0); }
  guide.attachGuide(activeTable, selectedGame.guide || selectedGame.id);
  attachQuickSettings(activeTable);
  // The first-hand button on home: the table minimum is already on box 2, so 딜 is the only tap left.
  if (firstBet && !activeTable.locked && !activeTable.total) activeTable.addChip('b2', activeTable.tier.min, activeTable.tray?.getBoundingClientRect());
  if (OPENS_WITH_BETS.has(selectedGame.id) && !activeTable.locked) voice.say('place-bets');
  activeTable.root.querySelector('.table-back')?.focus({ preventScroll: true });
}

function closeTable() {
  tableSeq++;
  if (!activeTable) return;
  voice.hush();
  music.theme('lounge');
  const closing = activeTable.destroy();
  activeTable = null;
  tableMount.replaceChildren();
  // Getting up from the table (not moving to another one) cashes the chips in hand back in.
  Promise.resolve(closing).finally(async () => {
    if (!document.body.classList.contains('game-mode')) { const next = await cashOutQuiet(state); if (next) applyState(next); }
    refresh();
  });
}

function restoreTrigger() { lastLobbyTrigger?.focus({ preventScroll: true }); }
function leaveTable({ useHistory = true } = {}) {
  const inGame = document.body.classList.contains('game-mode') || document.body.classList.contains('tier-mode');
  if (!inGame) return;
  if (useHistory && (history.state?.vegasSurface === 'table' || history.state?.vegasSurface === 'tiers')) { history.back(); return; }
  showSurface(returnSurface); restoreTrigger();
}

document.querySelector('[data-tier-back]').addEventListener('click', () => leaveTable());
// "바이인" on a 칩이 모자라요 notice (js/notice.js): buy more chips for the table I'm at.
// The table's + and the rebuy after a round use it too: chips are bought right at the seat.
// The table keeps the newest state from its rounds (table.js setServerState); the menus' copy can lag.
async function buyMore(mode, st = activeTable?.serverState || state) {
  const tier = TIERS[activeTier];
  if (!tier || !st) return;
  if (!mode) mode = st.user.account.available < tier.min ? 'rebuy' : 'topup';
  // At a friend's room opened from an invite: its floor's chips whatever the RP tier.
  const room = inviteRoom?.tier === activeTier ? inviteRoom.code : null;
  const next = await buyInSheet(st, tier, { mode, event: selectedGame?.event || null, room, onLeave: () => leaveTable() });
  if (!next) return;
  applyState(next);
  const t = activeTable;
  if (!t) return;
  t.setServerState?.(next);
  // The new chips roll into the table's chip count.
  t.catchChips?.();
}
document.addEventListener('vegas:buyin', () => buyMore());
window.addEventListener('popstate', event => {
  if (event.state?.vegasSurface === 'tiers') { if (selectedGame) { setTierHeader(selectedGame); renderTiers(); } showSurface('tiers', { focus: true }); return; }
  if (event.state?.vegasSurface === 'table') { showSurface('tiers'); return; }
  if (document.body.classList.contains('game-mode') || document.body.classList.contains('tier-mode')) { showSurface(returnSurface); restoreTrigger(); }
});
window.addEventListener('keydown', event => { if (event.key === 'Escape') leaveTable(); });
// The table's wallet pill: leave the table (as ← does) and land on 지갑.
addEventListener('vegas:open-wallet', () => {
  if (!document.body.classList.contains('game-mode')) { showSurface('bank', { focus: true }); return; }
  // With the cashier the + buys more chips from the seat instead (js/cashier.js).
  if (state?.cashier?.on && TIERS[activeTier] && !selectedGame?.event && !activeTable?.root?.classList.contains('is-room')) { buyMore(); return; }
  returnSurface = 'bank';
  if (history.state?.vegasSurface === 'table') history.go(tableOverTiers ? -2 : -1);
  else showSurface('bank', { focus: true });
});
// The bust screen's "오늘은 여기까지": leave the table the same way and land on a menu.
addEventListener('vegas:leave-to', event => {
  const surface = event.detail?.surface || 'lobby';
  if (!document.body.classList.contains('game-mode')) { showSurface(surface, { focus: true }); return; }
  returnSurface = surface;
  if (history.state?.vegasSurface === 'table') history.go(tableOverTiers ? -2 : -1);
  else showSurface(surface, { focus: true });
});
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

// A warm dot on a tab that has money waiting: free pay or support in 지갑, an achievement reward
// in 프로필. The tab's spoken name says so too.
function paintNavDots(st) {
  const eng = st.engagement || {}, sup = eng.support || {};
  const bank = Boolean((eng.daily && !eng.daily.claimed) || (sup.grant && !sup.grant.claimed) || (sup.welfare?.qualified && !sup.welfare.claimed));
  const ach = (st.achievements || []).filter(a => a.done && !a.claimed).length;
  for (const [name, on, note] of [['bank', bank, '받을 돈 있음'], ['profile', ach > 0, `받을 업적 보상 ${ach}개`]]) {
    const dot = document.querySelector(`[data-dot="${name}"]`);
    if (!dot) continue;
    dot.hidden = !on;
    const label = dot.parentElement.querySelector('.nav-label').textContent;
    if (on) dot.parentElement.setAttribute('aria-label', `${label}, ${note}`); else dot.parentElement.removeAttribute('aria-label');
  }
}

// Every fresh server state lands here: wallet, lobby lounge, ranking and profile. The menus behind
// a table are drawn in 원 even while the table counts in chips.
function applyState(next) {
  const units = inTableUnits();
  setTableUnits(false);
  try { paintState(next); } finally { setTableUnits(units); }
}
function paintState(next) {
  state = next;
  setBragName(state.user?.nickname);
  // The top bar is all the player's money (chips in hand and the wallet, lib/cashier.mjs).
  const available = moneyOf(state);
  // Show the balance as is on first load; only later changes roll.
  if (shownWallet === null || shownWallet === available) walletEl.textContent = formatCH(available);
  else rollNumber(walletEl, shownWallet, available, { format: formatCH });
  shownWallet = available;
  // The top bar is the wallet; chips still on a table get their own small line so 0원 never
  // reads as "everything is gone" while the bank counts them.
  const held = state.user.account.locked;
  walletHeld.hidden = !(held > 0);
  walletHeld.textContent = held > 0 ? `테이블 ${formatCH(held)}` : '';
  applyCosmetics(state);
  paintNavDots(state);
  document.querySelector('[data-avatar]').textContent = state.user.guest ? '나' : [...(state.user.nickname || '나')].slice(0, 2).join('');
  onGuestState(state, applyState);
  renderResume();
  for (const card of nightlyCards) card.update(state);
  renderGameLists();
  maybeBust(state);
  noteLuxuryRefund(state);
  renderLounge(document.querySelector('[data-lounge]'), state, applyState, openPassShop, openRankBoard);
  if (isActive('ranking')) renderRanking();
  if (isActive('profile')) renderProfile();
  if (isActive('bank')) renderBank(document.querySelector('[data-bank]'), state, applyState);
  if (isActive('shop')) renderShop(document.querySelector('[data-shop]'), state, applyState);
  if (isActive('tiers')) renderTiers();
  document.body.classList.toggle('is-settling', isSettlingIn(state));
  noteRpChange(state, { quiet: isSettlingIn(state) });
  if (isActive('lobby') && !isSettlingIn(state)) { maybeSeasonMoment(state, { onWrapped: showWrapped }); maybeSeasonWarning(state, openSeasonEnd); celebrateFloors(state); celebrateTier(state); }
  sheetPaint?.();
}

// 매일 밤 9시 홀덤 토너먼트: the card on 홈 and in 이벤트. Its button takes a registered player to
// their seat: the Hold'em screen picks up the tournament table they sit at (friends.resume).
const NIGHTLY_TIER = 'salon-prive';
function openNightlyTable() {
  dispatchEvent(new CustomEvent('vegas:open-table', { detail: { game: 'poker', tier: NIGHTLY_TIER } }));
}
const nightlyCards = [document.querySelector('[data-home-nightly]'), document.querySelector('[data-event-nightly]')]
  .map(slot => mountNightly(slot, { getState: () => state, applyState: next => next && applyState(next), openTable: openNightlyTable, toast }));
// The push's link (./?nightly=1): straight to the seat while it runs, otherwise the card on 홈.
function openNightlyFromLink() {
  const params = new URLSearchParams(location.search);
  if (!params.has('nightly')) return;
  params.delete('nightly');
  history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  if (state?.nightly?.me?.seated) openNightlyTable();
  else document.querySelector('[data-home-nightly]')?.scrollIntoView({ block: 'center' });
}

// The lobby's way back in: a round still holding chips, then the last three tables played.
function sitAt(game, tier, trigger, { seated = false, firstBet = false } = {}) {
  lastLobbyTrigger = trigger;
  setReturn('lobby');
  selectedGame = game;
  setTierHeader(game);
  renderTiers();
  openTable(tier, { seated, firstBet });
}
// An event table only while that event runs, at its own table.
function tableStillThere(game, tier) {
  if (!game || !playable(game) || !TIERS[tier]) return false;
  return !game.event || eventEntry(eventOf(game))?.tier.slug === tier;
}
const resumeTier = (r, game) => (TIERS[r.floor] ? r.floor : (lastTier(game.id) || FIRST_TIER.slug));
// The bank's "테이블로 가기": back to the first open round, as the lobby's 이어하기 does.
document.addEventListener('vegas:resume', e => {
  const r = (state?.openRounds || []).find(x => !x.left);
  const game = r && GAMES.find(g => g.id === r.game);
  if (game && playable(game)) sitAt(game, resumeTier(r, game), e.detail?.trigger, { seated: true });
});
function renderResume() {
  const slot = document.querySelector('[data-resume]');
  const open = (state?.openRounds || []).filter(r => !r.left).map(r => ({ r, game: GAMES.find(g => g.id === r.game) })).filter(x => x.game && playable(x.game));
  slot.hidden = !open.length;
  if (!open.length) { slot.replaceChildren(); return; }
  const { r, game } = open[0];
  const tier = resumeTier(r, game);
  const locked = r.locked || state.user.account.locked || 0;
  const b = el('button', 'resume-button');
  b.type = 'button';
  b.innerHTML = `<span class="resume-text"><strong>진행 중인 판이 있어요 · 이어하기</strong><small>${game.name} · ${TIERS[tier].name}${r.room ? ` · 친구 방 ${r.room}` : ''}${locked ? ` · ${formatCH(locked)} 걸려 있어요` : ''}${open.length > 1 ? ` · 외 ${open.length - 1}판` : ''}</small></span><span class="resume-go" aria-hidden="true">→</span>`;
  b.addEventListener('click', () => sitAt(game, tier, b, { seated: true }));
  slot.replaceChildren(b);
}
// The server grants a recharge at most once per cooldown, so a retry after a dropped
// connection can't pay twice.
async function rechargeClaim(b) {
  b.disabled = true;
  try { await api.recharge(); sound.chips(6); } catch (e) { b.disabled = false; errorToast(e, () => rechargeClaim(b)); }
  refresh();
}

// ---------- lobby ----------
// Every table and event has its own key art (scripts/art.mjs draws them): a still life under the lamp.
const art = (id, cls) => `<img class="${cls}" src="art/${id}.webp" alt="" width="480" height="360" loading="lazy" decoding="async">`;

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
  sevenpoker: '<rect x="6" y="13" width="14" height="22" rx="2"/><rect x="13" y="12" width="14" height="22" rx="2"/><rect x="20" y="13" width="14" height="22" rx="2"/><rect x="27" y="14" width="15" height="22" rx="2" fill="currentColor" fill-opacity=".12"/><path d="M31.5 20.5h6l-3.6 9.5"/>',
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
// Three kinds of tables, as the home cards and the 게임 tab's filter split them.
const KINDS = [['casino', '카지노', ['blackjack', 'roulette', 'baccarat', 'dice', 'slots', 'horses']], ['poker', '포커', ['poker', 'sevenpoker']], ['hwatu', '화투', ['matgo', 'gostop', 'seotda']]];
const POPULAR = ['blackjack', 'poker', 'seotda', 'roulette', 'matgo', 'baccarat', 'gostop', 'sevenpoker', 'dice', 'slots', 'horses'];
let homeKind = 'all';
let gamesKind = 'all';
const groupHead = (text, aside = '') => {
  const li = el('li', 'game-group');
  li.setAttribute('role', 'presentation');
  li.innerHTML = `<span>${text}</span>${aside ? `<small>${aside}</small>` : ''}`;
  return li;
};
// 전체 · 카지노 · 포커 · 화투: built once, then only the selection moves so focus stays put.
function filterTabs(root, current, onPick) {
  if (!root.childElementCount) {
    for (const [id, name] of [['all', '전체'], ...KINDS]) {
      const b = el('button', 'filter-tab', name);
      b.type = 'button';
      b.dataset.kind = id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => onPick(id));
      root.append(b);
    }
  }
  root.querySelectorAll('[data-kind]').forEach(b => { const on = b.dataset.kind === current; b.classList.toggle('is-active', on); b.setAttribute('aria-checked', String(on)); });
}

// The home row: tall picture cards to flick through.
function popCard(g) {
  const li = el('li');
  const b = el('button', 'pop-card');
  b.type = 'button';
  b.dataset.game = g.id;
  const hot = hotStatus(state).live;
  const isHot = hot && hot.game === g.id;
  if (isHot) b.classList.add('is-hot');
  b.innerHTML = `${art(g.id, 'pop-art')}${isHot ? `<span class="hot-badge">HOT ${pct(hot)}</span>` : ''}<span class="pop-text"><b>${g.name}</b><small>${g.tag}</small></span>`;
  b.addEventListener('click', () => chooseGame(b));
  li.append(b);
  return li;
}

// Home shows the popular row (filtered by kind); the 게임 tab lists every everyday table by kind.
// Events live in the 이벤트 tab.
function renderGameLists() {
  const games = GAMES.filter(g => !g.event);
  const byId = id => games.find(g => g.id === id);
  const stake = `최소 ${formatCH(entryMin())}원부터 앉을 수 있어요`;
  const homeIds = homeKind === 'all' ? POPULAR : KINDS.find(k => k[0] === homeKind)[2];
  document.querySelector('[data-game-grid]').replaceChildren(...homeIds.map(byId).filter(Boolean).map(popCard));
  filterTabs(document.querySelector('[data-home-filter]'), homeKind, k => { homeKind = k; renderGameLists(); });
  const kinds = gamesKind === 'all' ? KINDS : KINDS.filter(k => k[0] === gamesKind);
  document.querySelector('[data-floor-list]').replaceChildren(...kinds.flatMap(([, name, ids], i) => [groupHead(name, i ? '' : stake), ...ids.map(byId).filter(Boolean).map(gameRow)]));
  filterTabs(document.querySelector('[data-games-filter]'), gamesKind, k => { gamesKind = k; renderGameLists(); });
  renderHome();
}

// The hot badge follows the clock: the countdown ticks, and the lists redraw when a window opens or closes.
let shownHot = null;
setInterval(() => {
  if (!state) return;
  const { live, now } = hotStatus(state);
  const key = live ? `${live.game}:${live.startsAt}` : '';
  if (key !== shownHot) { shownHot = key; renderGameLists(); return; }
  if (live) document.querySelectorAll('[data-hot-left]').forEach(n => { n.textContent = clock(Date.parse(live.endsAt) - now); });
  const next = !live && hotStatus(state).next;
  if (next) document.querySelectorAll('[data-hot-next]').forEach(n => { n.textContent = clock(Date.parse(next.startsAt) - now); });
}, 1000);
// The lounge's hot table block sends players straight to that game's tables.
addEventListener('vegas:choose-game', event => {
  const id = event.detail?.game;
  if (!GAMES.some(g => g.id === id)) return;
  let row = document.querySelector(`.surface.is-active [data-game="${id}"]`);
  if (!row) { row = el('button'); row.dataset.game = id; }
  chooseGame(row);
});

// ---------- home ----------
// Home is four things: this week's event as one big banner, the three kinds of tables plus events
// as four cards, a strip of today's small things (pay, missions, season, hot table), and the
// popular games row. Everything else lives in its tab.
const weekGame = () => GAMES.find(x => x.event && eventOf(x) && !eventOf(x).always);
function renderHome() {
  renderFirstDay();
  renderHero();
  renderCats();
  renderToday();
  if (isActive('events')) renderEventTab();
}

// The first three hands (js/first-day.js): home is my chips, today's 손익 and one button. The very
// first tap sits at blackjack with the minimum already bet; after that it goes back to the last table.
function renderFirstDay() {
  const slot = document.querySelector('[data-home-first]');
  const on = isSettlingIn(state);
  document.body.classList.toggle('is-first-day', on);
  slot.hidden = !on;
  if (!on) { slot.replaceChildren(); return; }
  const bj = GAMES.find(g => g.id === 'blackjack');
  const recent = recentTables().map(x => ({ ...x, game: GAMES.find(g => g.id === x.game) })).find(x => tableStillThere(x.game, x.tier) && !outgrownTier(x.tier) && moneyOf(state) >= TIERS[x.tier].min);
  slot.replaceChildren(firstDayCard(state, {
    again: recent?.game.name,
    onPlay: (b, { first }) => (first || !recent ? sitAt(bj, FIRST_TIER.slug, b, { firstBet: first }) : sitAt(recent.game, recent.tier, b)),
    onBrowse: () => showSurface('games', { focus: true })
  }));
}

function heroButton(text, cls, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}
function renderHero() {
  const slot = document.querySelector('[data-home-hero]');
  const g = weekGame();
  const ev = g && eventOf(g);
  const card = el('div', 'home-hero-card');
  const actions = el('div', 'home-actions');
  const goEvents = () => showSurface('events', { focus: true });
  if (ev) {
    const e = eventEntry(ev);
    card.style.setProperty('--hero-art', `url(art/${ev.id}.webp)`);
    card.innerHTML = `<span class="home-kicker">이번 주 이벤트 · ${timeLeft(ev.until)} 남음</span><h2 class="home-title">${ev.title}</h2><p class="home-lede">${ev.blurb}</p>`;
    if (e?.open) {
      const go = heroButton('입장하기', 'home-cta', b => chooseGame(b));
      go.dataset.game = g.id;
      actions.append(go, heroButton('자세히', 'home-ghost', goEvents));
    } else {
      actions.append(heroButton('이벤트 보기', 'home-cta', goEvents));
      if (e) actions.append(el('span', 'home-note', `입장 · 보유 칩 ${formatCH(e.entry)} 이상`));
    }
  } else {
    const bj = GAMES[0];
    card.style.setProperty('--hero-art', `url(art/${bj.id}.webp)`);
    card.innerHTML = `<span class="home-kicker">지금 바로</span><h2 class="home-title">${bj.name}</h2><p class="home-lede">${bj.blurb}</p>`;
    const go = heroButton('바로 앉기', 'home-cta', b => chooseGame(b));
    go.dataset.game = bj.id;
    actions.append(go);
  }
  card.append(actions);
  slot.replaceChildren(card);
}

function renderCats() {
  const slot = document.querySelector('[data-home-cats]');
  const name = id => GAMES.find(g => g.id === id)?.name;
  const ev = weekGame() && eventOf(weekGame());
  const list = (ids, n = 3) => ids.slice(0, n).map(name).join(' · ') + (ids.length > n ? ` 외 ${ids.length - n}` : '');
  const cards = [
    ...KINDS.map(([id, label, ids]) => ({ id, label, sub: list(ids), art: ids[0] === 'blackjack' ? 'blackjack' : ids[0], go: () => { gamesKind = id; renderGameLists(); showSurface('games', { focus: true }); } })),
    { id: 'event', label: '이벤트', sub: ev ? ev.title : '매주 바뀌는 테이블', art: ev?.id || 'royale', go: () => showSurface('events', { focus: true }) }
  ];
  slot.replaceChildren(...cards.map(c => {
    const b = el('button', `home-cat home-cat--${c.id}`, `<span class="home-cat-text"><b>${c.label}</b><small>${c.sub}</small></span><span class="home-cat-go">${c.id === 'event' ? '입장' : '플레이'}</span>`);
    b.type = 'button';
    b.style.setProperty('--cat-art', `url(art/${c.art}.webp)`);
    b.addEventListener('click', c.go);
    return b;
  }));
}

// A sheet holding one lounge block (missions, tables to watch); it repaints with every new state.
let sheetPaint = null;
function openBlockSheet(make) {
  sheetPaint?.close();
  const scrim = el('div', 'lounge-scrim');
  const sheet = el('section', 'lounge-sheet lounge-sheet--block');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  const shut = el('button', 'sheet-close', '닫기');
  shut.type = 'button';
  const body = el('div', 'lounge-sheet-body');
  sheet.append(shut, body);
  const paint = () => {
    const node = make();
    if (!node) { close(); return; }
    body.replaceChildren(node);
    sheet.setAttribute('aria-label', node.querySelector('h2')?.textContent || '');
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    if (sheetPaint !== paint) return;
    sheetPaint = null;
    removeEventListener('keydown', onKey, true);
    scrim.classList.remove('is-open'); sheet.classList.remove('is-open');
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 320);
  }
  paint.close = close;
  sheetPaint = paint;
  paint();
  document.body.append(scrim, sheet);
  addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', close);
  shut.addEventListener('click', close);
  requestAnimationFrame(() => { scrim.classList.add('is-open'); sheet.classList.add('is-open'); shut.focus({ preventScroll: true }); });
}

function todayChip({ mark, title, sub, hot = false, disabled = false, label, tone = '', onClick }) {
  const b = el('button', `today-chip${hot ? ' is-hot' : ''}${tone ? ` is-${tone}` : ''}`);
  b.type = 'button';
  b.disabled = disabled;
  b.innerHTML = `<span class="today-mark" aria-hidden="true">${mark}</span><span class="today-text"><b>${title}</b><small>${sub}</small></span>`;
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', () => onClick(b));
  return b;
}
const MARK = {
  pay: '<svg viewBox="0 0 24 24"><path d="M5 7.5h14v10H5zM9 12.5h6M12 10v5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.1-5M5 4v4h4"/></svg>',
  mission: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>',
  hot: '<svg viewBox="0 0 24 24"><path d="M12 4c.5 3.4 4.5 5.2 4.5 9.5a4.5 4.5 0 0 1-9 0c0-2.2 1.2-3.6 2-4.5.3 1.6 1.2 2.4 2 2.6C11 9.4 11.2 6.6 12 4z"/></svg>',
  watch: '<svg viewBox="0 0 24 24"><path d="M3 12s3.3-5.5 9-5.5S21 12 21 12s-3.3 5.5-9 5.5S3 12 3 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  daily: '<svg viewBox="0 0 24 24"><path d="M6.5 5.5h8v13h-8zM14.5 8l3 .8-2.6 9.8-3.6-1"/><path d="M10.5 10l1.2 2-1.2 2-1.2-2z"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><path d="M3.5 9 12 4.5 20.5 9M5 9.5v8M9.7 9.5v8M14.3 9.5v8M19 9.5v8M3.5 20h17"/></svg>',
  ledger: '<svg viewBox="0 0 24 24"><path d="M4 6l5 5 4-3 7 8M15 16h5v-5"/></svg>'
};
function renderToday() {
  const slot = document.querySelector('[data-home-today]');
  if (!state?.user) { slot.replaceChildren(); return; }
  const chips = [];
  const eng = state.engagement || {}, sup = eng.support || {}, r = state.recharge;
  const available = moneyOf(state);
  const broke = Boolean(state.bank && available < state.bank.base);
  // Free money first: pay, then 구제금융·정부 지원금 and the recharge. Short of every table with
  // nothing free left, the bank.
  const daily = eng.daily;
  if (daily && !daily.claimed) {
    const kind = daily.pay.monthly ? '월급' : daily.pay.weekly ? '주급' : '일급';
    chips.push(todayChip({ mark: MARK.pay, title: `오늘 ${kind} +${formatCH(daily.reward)}`, sub: '눌러서 받기', hot: true, onClick: () => openDailySheet(state, applyState) }));
  }
  for (const [kind, name] of [['welfare', '구제금융'], ['grant', '정부 지원금']]) {
    const s = sup[kind];
    const ready = kind === 'welfare' ? s?.qualified && !s.claimed : s && !s.claimed;
    if (ready) chips.push(todayChip({ mark: MARK.pay, title: `${name} +${formatCH(s.amount)}`, sub: '갚지 않아도 돼요', hot: true, onClick: b => claimSupport(kind, b, applyState) }));
  }
  if (r?.eligible) chips.push(todayChip({ mark: MARK.pay, title: `칩 충전 +${formatCH(r.amount)}`, sub: '무료', hot: broke, onClick: rechargeClaim }));
  if (broke && !chips.length && !state.bank?.closed) chips.push(todayChip({ mark: MARK.bank, title: '은행에서 빌리기', sub: '칩이 모자라요', hot: true, onClick: () => showSurface('bank', { focus: true }) }));
  // 오늘의 손익 (lib/loss-tally.mjs): won and lost at the tables since midnight, losses in red,
  // first in the strip (한서 2026-10-27: "얼마 잃었는지 보여주는 게 많았으면").
  const day = state.user.today;
  if (day?.rounds > 0) {
    const sign = day.net < 0 ? '-' : day.net > 0 ? '+' : '';
    chips.unshift(todayChip({ mark: MARK.ledger, title: `오늘 ${sign}${formatCH(Math.abs(day.net))}`, sub: `${day.rounds}판 · 잃은 돈 ${formatCH(day.lost)}${day.busts ? ` · 파산 ${day.busts}번` : ''}`, label: `오늘 손익 ${sign}${formatCH(Math.abs(day.net))}원, ${day.rounds}판, 잃은 돈 ${formatCH(day.lost)}원`, tone: day.net < 0 ? 'down' : day.net > 0 ? 'up' : '', onClick: () => openBlockSheet(() => dayBlock(state)) }));
  }
  // 오늘의 한 판: the same ten blackjack deals for everyone today.
  const db = state.dailyBj;
  if (db) chips.push(todayChip({ mark: MARK.daily, title: db.played ? `오늘의 한 판 ${db.score.toLocaleString('ko-KR')}점` : `오늘의 한 판 #${db.no}`, sub: db.played ? '순위 보고 자랑하기' : db.playing ? '이어서 치기' : `${db.players ? `${db.players}명 참가 · ` : ''}모두 같은 10판`, hot: !db.played, onClick: showDaily }));
  // The last table played, if it is still there for this player.
  const recent = recentTables().map(x => ({ ...x, game: GAMES.find(g => g.id === x.game) })).find(x => tableStillThere(x.game, x.tier) && !outgrownTier(x.tier));
  if (recent) {
    const tier = TIERS[recent.tier];
    const short = available < tier.min;
    chips.push(todayChip({ mark: MARK.back, title: `다시 앉기 · ${recent.game.name}`, sub: short ? '칩이 부족해요' : `${tier.name} · ${formatCH(tier.min)}–${formatCH(tier.max)}`, disabled: short, label: `${recent.game.name} ${tier.name}에 다시 앉기${short ? ', 칩이 부족해요' : ''}`, onClick: b => sitAt(recent.game, recent.tier, b) }));
  }
  const { live, next, now } = hotStatus(state);
  const hotGo = game => () => dispatchEvent(new CustomEvent('vegas:choose-game', { detail: { game } }));
  if (live) chips.push(todayChip({ mark: MARK.hot, title: `지금 핫 · ${live.label}`, sub: `이기면 +${pct(live)} · <span data-hot-left>${clock(Date.parse(live.endsAt) - now)}</span> 남음`, hot: true, onClick: hotGo(live.game) }));
  const ms = eng.missions;
  if (ms?.items?.length) {
    const ready = ms.items.filter(i => i.done && !i.claimed).length;
    const done = ms.items.filter(i => i.done).length;
    const run = ms.streak?.count ? ` · ${ms.streak.count}일 연속` : '';
    const sub = ready ? `보상 ${ready}개 받기` : ms.swept || done === ms.items.length ? `오늘은 모두 끝냈어요${run}` : `모두 하면 보너스 +${formatCH(ms.sweepBonus + (ms.streak?.next?.inDays === 0 ? ms.streak.next.bonus : 0))}${run}`;
    chips.push(todayChip({ mark: MARK.mission, title: `오늘의 미션 ${done}/${ms.items.length}`, sub, hot: ready > 0, onClick: () => openBlockSheet(() => state?.engagement?.missions && missionsBlock(state, applyState)) }));
  }
  const rs = state.rankSeason;
  // The season's last week: the countdown sits up front, next to the money.
  if (rs && seasonEnding(rs)) {
    const left = seasonLeft(rs), d = Math.ceil(left / 86_400_000);
    chips.splice(Math.min(chips.length, 1), 0, todayChip({ mark: tierEmblem(rs.tier, { size: 26, label: false }), title: left <= 86_400_000 ? '오늘 자정 시즌 초기화' : `시즌 초기화 D-${d}`, sub: `<span data-season-clock data-ends="${rs.season.endsAt}">${seasonClock(left)}</span> · 지금 ${tierName(rs.tier, rs.division)}`, hot: true, label: `시즌 초기화까지 ${seasonClock(left)}, 지금 ${tierName(rs.tier, rs.division)}`, onClick: openSeasonEnd }));
  } else if (rs) chips.push(todayChip({ mark: tierEmblem(rs.tier, { size: 26, label: false }), title: `시즌 ${tierName(rs.tier, rs.division)}`, sub: rs.next ? `${tierName(rs.next.id, rs.next.division)}까지 ${rs.mode === 'rp' ? `${rs.next.need} RP` : formatCH(rs.next.need)}` : '최고 티어예요', onClick: openRankBoard }));
  if (!live && next) chips.push(todayChip({ mark: MARK.hot, title: `${startTime(next)} 핫 테이블`, sub: `${next.label} · <span data-hot-next>${clock(Date.parse(next.startsAt) - now)}</span> 뒤`, onClick: hotGo(next.game) }));
  const watching = watchBlock(state);
  if (watching) chips.push(todayChip({ mark: MARK.watch, title: '지금 플레이 중', sub: `${watching.querySelectorAll('li').length}개 테이블 구경하기`, onClick: () => openBlockSheet(() => watchBlock(state)) }));
  slot.replaceChildren(...chips);
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
    const go = el('button', `event-cta${locked ? ' is-locked' : ''}`, locked ? `보유 ${formatCH(moneyOf(state))} / ${formatCH(e.entry)} 필요` : '테이블에 앉기');
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
  return e && tier ? { ...e, tier, open: moneyOf(state) >= e.entry } : null;
}
function entryLine(ev) {
  const e = eventEntry(ev);
  if (!e) return '';
  // 이벤트 입장료 (lib/event-fee.mjs): paid with the first bet, once a week (rotating) or a day (상시).
  const fee = state?.eventFees?.[ev?.id];
  const feeText = fee ? ` · 입장료 ${formatCH(fee.fee)}원${fee.paid ? ` (${fee.per === 'day' ? '오늘' : '이번 주'} 냈어요)` : ` (${fee.per === 'day' ? '하루' : '한 주'} 한 번)`}` : '';
  return `<p class="event-entry${e.open ? ' is-open' : ''}">입장 · 보유 칩 ${formatCH(e.entry)} 이상${feeText} · ${e.tier.name} ${formatCH(e.tier.min)}–${formatCH(e.tier.max)}원${e.open ? '' : ' · 아직 입장할 수 없어요'}</p>`;
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
  document.querySelector('[data-event-feed]').replaceChildren(...(state?.engagement ? [feedBlock(state, applyState)] : []));
}

// ---------- tiers ----------
function renderTiers() {
  const grid = document.querySelector('[data-tier-grid]');
  const floors = state?.floors || [];
  const available = moneyOf(state);
  // Floors a player has outgrown fold away behind one line; the next locked floor shows what it takes.
  const entry = selectedGame?.event && eventEntry(eventOf(selectedGame));
  if (entry) return renderEventTier(grid, entry);
  const all = Object.values(TIERS).map(tier => ({ tier, floor: floors.find(f => f.slug === tier.floor) }));
  const outgrown = all.filter(x => x.floor?.outgrown);
  const firstLocked = all.findIndex(x => x.floor && !x.floor.unlocked);
  const shown = all.filter((x, i) => !x.floor?.outgrown && (firstLocked < 0 || i <= firstLocked + 1));
  const note = outgrown.length ? [el('p', 'tier-outgrown', `${outgrown.map(x => x.tier.name).join(' · ')}은 졸업했어요. ${state?.rp?.floors ? '티어가 오르면 아래층은 잠겨요. 칩과 지갑을 합쳐 내 층 최소 베팅의 20배가 안 되면 다시 열려요.' : '순자산이 최소 베팅의 100배를 넘으면 그 층에는 앉지 않아요.'}`)] : [];
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
    const rpMode = floor?.rpNeed != null;
    const status = locked ? (rpMode ? `RP ${floor.rpNeed}이면 열려요 · ${floor.rpRemaining} 남음` : `순자산 ${formatCH(floor?.threshold || 0)}원${floor?.passed ? '' : ' + 입장 꾸미기'}로 열려요 (${Math.round((floor?.progress || 0) * 100)}%)`) : needsPass ? `이번 달 입장권이 필요해요 · 이 층 꾸미기를 사거나 갱신 · ${formatCH(floor.minBet)}원부터` : broke ? (state?.bank?.closed ? '돈이 부족해요 · 일급·구제금융으로 채워요' : '칩이 부족해요 · 은행에서 빌릴 수 있어요') : rpMode ? (floor.rpNeed ? `RP ${floor.rpNeed} 층` : '모두에게 열린 층') : floor?.ceiling ? `순자산 ${formatCH(floor.ceiling)}원을 넘으면 졸업` : '끝없는 층';
    const stars = `<em class="tier-stars" aria-label="난이도 ${tier.stars}/5">${'★'.repeat(tier.stars)}${'☆'.repeat(5 - tier.stars)}</em>`;
    // 디비전별 베팅 상한: the floor my tier just opened shows the top bet my division allows now.
    const cap = !locked && state?.rp?.betCaps?.[tier.slug] < tier.max ? state.rp.betCaps[tier.slug] : 0;
    b.innerHTML = `<strong>${tier.name}${stars}</strong><span>${formatCH(tier.min)} – ${formatCH(cap || tier.max)}원${cap ? ` <em class="tier-cap">${tierName(state.rp.tier, state.rp.division)} 상한</em>` : ''}</span><small>${status}</small>`;
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
  tier: [['tier', '이번 시즌 최고 순자산']],
  rp: [['rp', 'RP 베타']],
  season: [['profit', '수익'], ['wins', '승리'], ['highRoller', '베팅량']],
  allTime: [['wealth', '순자산'], ['profit', '수익'], ['highRoller', '베팅량']]
};
let rankPeriod = 'tier';
let rankTab = 'tier';
// The ranking tab has four views: 티어 (my tier and the ladder), 리그 (this week's group), 순위 (the boards), 친구.
const RANK_VIEWS = [['tier', '티어'], ['league', '리그'], ['board', '순위'], ['friends', '친구']];
const RANK_VIEW_KEY = 'vegas:rank-view';
let rankView = (() => { try { const v = localStorage.getItem(RANK_VIEW_KEY); return RANK_VIEWS.some(([k]) => k === v) ? v : 'tier'; } catch { return 'tier'; } })();
function setRankView(v) { rankView = v; try { localStorage.setItem(RANK_VIEW_KEY, v); } catch {} renderRanking(); }
// The lobby's season card opens my tier; the season-end sheet opens the month's board.
function openRankBoard({ board = false } = {}) { rankView = board ? 'board' : 'tier'; rankPeriod = 'tier'; rankTab = 'tier'; showSurface('ranking', { focus: true }); }
// The season-end warning (js/rank.js): what resets at midnight and what stays.
function openSeasonEnd() {
  openBlockSheet(() => state?.rankSeason && seasonEndBlock(state, {
    onShop: () => { sheetPaint?.close(); showSurface('shop', { focus: true }); },
    onBoard: () => { sheetPaint?.close(); openRankBoard({ board: true }); },
    onWrapped: w => { sheetPaint?.close(); showWrapped(w); }
  }));
}
// VEGAS 랩드: a month in story cards (js/wrapped.js).
function showWrapped(w) { openWrapped(w, { nickname: state?.user?.nickname || '' }); }
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
  const views = document.querySelector('[data-rank-view]');
  views.replaceChildren(...RANK_VIEWS.map(([key, label]) => {
    const b = el('button', 'segment', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === rankView));
    b.setAttribute('aria-checked', String(key === rankView));
    b.addEventListener('click', () => { if (key !== rankView) setRankView(key); });
    return b;
  }));
  document.querySelectorAll('[data-rank-pane]').forEach(p => { p.hidden = p.dataset.rankPane !== rankView; });
  if (rankView === 'tier') renderTierPane();
  else if (rankView === 'friends') renderFriendPane();
  else if (rankView === 'league') document.querySelector('[data-league]').innerHTML = leagueHtml(state, (id, n) => nameFrame(state, id, n));
  else renderBoards();
}
// 승급전 참가비: what it costs, what it takes, then the fee from the wallet.
function openPromoSheet() {
  const o = state?.promo?.offer;
  if (!o) return;
  const short = moneyOf(state) < o.fee;
  openSheet({
    eyebrow: '승급전', title: `${tierName(o.target)} 승급전`,
    body: `<p class="lounge-note">참가비 <b>${formatCH(o.fee)}원</b>을 내고 도전해요. ${formatCH(o.minStake)}원 이상 건 판만 세고, 먼저 ${o.wins}번 이기면 바로 ${tierName(o.target, 'IV')}로 올라가요. ${o.losses}번 지면 끝나고 참가비는 돌려받지 못해요. RP는 평소처럼 오르내려요.${short ? ` <b>${formatCH(o.fee - moneyOf(state))}원 더 있어야 해요.</b>` : ''}</p>`,
    confirmText: short ? '' : `${formatCH(o.fee)}원 내고 도전`,
    confirm: short ? null : async () => { const out = await api.rankPromo(); applyState(out.state); toast(`${tierName(o.target)} 승급전 시작 · 2승이면 승급`); }
  });
}
function renderTierPane() {
  const hero = document.querySelector('[data-tier-hero]');
  const rs = state?.rankSeason;
  hero.className = `tier-hero${rs ? ` tier-hero--${rs.tier}` : ''}`;
  hero.innerHTML = tierHeroHtml(state) + promoHtml(state);
  hero.querySelector('[data-season-rules]')?.addEventListener('click', openSeasonEnd);
  hero.querySelector('[data-promo-start]')?.addEventListener('click', openPromoSheet);
  if (rs && !state.user?.guest) {
    const place = myMonthRank(state);
    const brag = bragButton(() => bragTier({ tier: rs.tier, name: tierName(rs.tier, rs.division), season: rs.season.name, rank: place?.rank || 0, of: place?.of || 0, peak: rs.peak, rp: rs.rp }), '자랑');
    brag.classList.remove('pill-button--solid');
    brag.classList.add('tier-hero-brag');
    hero.querySelector('.tier-hero-actions')?.prepend(brag);
  }
  document.querySelector('[data-rp-card]').innerHTML = rpCardHtml(state);
  document.querySelector('[data-tier-steps]').innerHTML = tierStepsHtml(state);
  const past = document.querySelector('[data-tier-past]');
  past.innerHTML = tierPastHtml(state);
  past.querySelector('[data-last-season]')?.addEventListener('click', () => maybeSeasonMoment(state, { force: true, onWrapped: showWrapped }));
}
function renderFriendPane() {
  const box = document.querySelector('[data-friend-record]');
  showFriends(document.querySelector('[data-friends]'), {
    frame: (id, n) => nameFrame(state, id, n),
    toast,
    // 옆자리: sit at a friend's room the way their invite link would.
    // A room opens on its floor's table (a stake above the floor's minimum is still that floor).
    onJoin: where => { if (setPendingJoin({ code: where.code, game: where.game, tier: where.floor || where.tier })) openInvite(); },
    // 관전: the same screen, from the friend's chair (js/games/room-client.js, holdem-room.js).
    onState: next => { if (next) applyState(next); },
    onWatch: (where, f) => { if (setPendingJoin({ code: where.code, game: where.game, tier: where.floor || where.tier, watch: f.id })) openInvite(); }
  });
  box.innerHTML = friendRecordHtml(state, (id, n) => nameFrame(state, id, n));
  box.querySelector('[data-friend-play]')?.addEventListener('click', () => showSurface('games', { focus: true }));
  renderDuels(document.querySelector('[data-duels]'), state, applyState);
}
function renderBoards() {
  const season = state?.rankings?.season;
  if (!season) rankPeriod = 'allTime';
  // From the RP season (2026-10-29) the month's tier is the RP, so the 베타 board folds into 이번 달.
  const rpMode = state?.rankSeason?.mode === 'rp';
  if (rpMode && rankPeriod === 'rp') rankPeriod = 'tier';
  const period = document.querySelector('[data-rank-period]');
  period.classList.toggle('segmented--four', !rpMode);
  period.replaceChildren(...[['tier', '이번 시즌'], ['rp', 'RP 베타'], ['season', '이번 주'], ['allTime', '전체']].filter(([key]) => !(rpMode && key === 'rp')).map(([key, label]) => {
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
  const rs = state?.rankSeason;
  if (rankPeriod === 'tier' && rs) {
    // The ladder and past months live on the 티어 view; here just the month and its clock.
    head.innerHTML = `<div class="season-card"><div><strong>${rs.season.name}</strong><small>${seasonEnding(rs) ? `<span data-season-clock data-ends="${rs.season.endsAt}">${seasonClock(seasonLeft(rs))}</span>` : `${timeLeft(rs.season.endsAt)}`} 남음 · ${rpMode ? '마감하면 3티어 내려가요' : '1일 0시에 모두 초기화'} <button type="button" class="link-button" data-season-rules>자세히</button></small></div><span class="season-mytier">${tierEmblem(rs.tier, { size: 34 })}<b>${rpMode ? `${rs.rp} RP` : tierName(rs.tier)}</b></span></div>`;
    head.querySelector('[data-season-rules]')?.addEventListener('click', openSeasonEnd);
  }
  if (rankPeriod === 'rp' && state?.rp) {
    head.innerHTML = `<div class="season-card"><div><strong>RP 베타</strong><small>건 돈 대비 번 만큼 쌓이는 점수 · 12월 시즌부터 티어가 돼요</small></div><span class="season-mytier">${tierEmblem(state.rp.tier, { size: 34 })}<b>${state.rp.points} RP</b></span></div>`;
  }
  if (!RANK_TABS[rankPeriod].some(([k]) => k === rankTab)) rankTab = RANK_TABS[rankPeriod][0][0];
  const tabs = document.querySelector('[data-rank-tabs]');
  tabs.replaceChildren(...RANK_TABS[rankPeriod].map(([key, label]) => {
    const b = el('button', `tab${key === rankTab ? ' is-active' : ''}`, rpMode && key === 'tier' ? '이번 시즌 RP' : label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === rankTab));
    b.addEventListener('click', () => { rankTab = key; renderRanking(); });
    return b;
  }));
  const rows = (rankPeriod === 'tier' ? state?.rankings?.tier : rankPeriod === 'rp' ? state?.rankings?.rp : rankPeriod === 'season' ? season?.[rankTab] : state?.rankings?.allTime?.[rankTab]) || [];
  // On the tier board every name carries its tier.
  const emblem = r => ((rankPeriod === 'tier' || rankPeriod === 'rp') && r.tier ? `${tierEmblem(r.tier, { size: 22 })}${r.division ? `<small class="rank-division">${r.division}</small>` : ''}` : '');
  const me = state?.user?.id;
  const rpBoard = rankPeriod === 'rp' || (rankPeriod === 'tier' && rpMode);
  const value = r => rankTab === 'wins' ? `${r.value}승` : rpBoard ? `${r.value} RP` : `${rankPeriod === 'season' && rankTab === 'profit' && r.value > 0 ? '+' : ''}${formatCH(r.value)}`;
  const board = rankPeriod === 'tier' ? `tier:${state?.rankSeason?.season.id}` : rankPeriod === 'rp' ? `rp:${state?.rp?.season}` : rankPeriod === 'season' ? `season:${season.id}:${rankTab}` : `allTime:${rankTab}`;
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
    node.setAttribute('aria-label', `${r.rank}위 ${r.nickname}, 플레이어 보기`);
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
    li.innerHTML = `<span class="podium-medal">${r.rank}</span><span class="podium-name">${emblem(r)}${nameFrame(state, r.id, r.nickname)}${r.id === me ? ' <small>나</small>' : ''}</span>${moveTag(r)}<span class="podium-value">${value(r)}</span><span class="podium-step" aria-hidden="true"></span>`;
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
    const gap = (a, b) => rankTab === 'wins' ? `${a.value - b.value}승` : rpBoard ? `${a.value - b.value} RP` : formatCH(a.value - b.value);
    const line = mine.rank === 1
      ? (below ? `1위 지키는 중 · 2위 ${below.nickname}보다 ${gap(mine, below)} 앞서요` : '1위예요')
      : above ? `${above.nickname}(${above.rank}위)까지 ${gap(above, mine)} 남았어요` : '';
    meBox.innerHTML = `<span class="rank-me-no">${mine.rank}<small>위</small></span><span class="rank-me-text"><b>나 ${moveTag(mine)}</b><small>${line}</small></span><span class="rank-me-value">${value(mine)}</span>`;
    // 동네방네: my place on this board as a card.
    const tabLabel = RANK_TABS[rankPeriod].find(([k]) => k === rankTab)?.[1] || '';
    const boardName = rankPeriod === 'tier' ? '시즌 티어' : rankPeriod === 'rp' ? 'RP 베타' : `${rankPeriod === 'season' ? '이번 주' : '전체'} ${tabLabel}`.trim();
    const brag = bragButton(() => bragRank({ rank: mine.rank, board: boardName, value: value(mine), tier: rankPeriod === 'tier' || rankPeriod === 'rp' ? mine.tier : null }), '자랑');
    brag.classList.remove('pill-button--solid');
    brag.classList.add('rank-me-brag');
    meBox.append(brag);
  }
  const rest = rows.filter(r => r.rank > 3);
  document.querySelector('[data-rank-list]').replaceChildren(...rest.map(r => {
    const li = el('li', `rank-row${r.id === me ? ' is-me' : ''}`);
    li.innerHTML = `<span class="rank-no">${r.rank}</span><span class="rank-name">${emblem(r)}${nameFrame(state, r.id, r.nickname)}${r.id === me ? ' <small>나</small>' : ''}${moveTag(r)}</span><span class="rank-value">${value(r)}</span>`;
    open(li, r);
    return li;
  }));
  if (!rows.length) document.querySelector('[data-rank-list]').innerHTML = '<li class="rank-empty">아직 이 순위에 오른 사람이 없어요. 한 판 하고 첫 이름을 올려 보세요.</li>';
}

// 사치품 were retired on 2026-10-29: say once where the refunded chips came from.
function noteLuxuryRefund(s) {
  const r = s?.latestRefund;
  if (!r?.id) return;
  try { if (localStorage.getItem('vegas:luxury-refund') === r.id) return; } catch { return; }
  remember('vegas:luxury-refund', r.id);
  toast(`사치품이 없어져서 산 값 그대로 ${formatCH(r.amount)}원을 칩으로 돌려드렸어요`, { duration: 8000 });
}

// ---------- profile ----------
function renderProfile() {
  const root = document.querySelector('[data-profile]');
  if (!state) { root.textContent = '불러오는 중…'; return; }
  const u = state.user, a = u.account;
  const floors = state.floors.map(f => `<li class="floor-row${f.open ? ' is-open' : ''}${f.outgrown ? ' is-outgrown' : ''}"><span>${f.name}${f.outgrown ? ' <small>졸업</small>' : f.rpNeed != null ? (f.unlocked ? '' : ` <small>RP ${f.rpNeed}</small>`) : f.unlocked && !f.passed ? ' <small>입장 꾸미기 필요</small>' : ''}</span><span class="floor-bar"><i style="width:${Math.round(f.progress * 100)}%"></i></span></li>`).join('');
  const eng = state.engagement || {};
  const badges = (eng.badges || []).filter(b => b.kind !== 'RANK').map(b => `<li class="badge badge--${b.rank}"><span class="badge-star" aria-hidden="true"></span><b>${b.rank}위</b><small>${b.name}</small></li>`).join('');
  // Per-game record: win rate, biggest win and net, most played first.
  const games = Object.entries(u.stats || {}).sort((x, y) => y[1].rounds - x[1].rounds).map(([g, s]) => {
    const rate = s.rounds ? Math.round((s.wins / s.rounds) * 100) : 0;
    return `<tr><th scope="row">${gameName(g)}</th><td>${s.rounds}</td><td>${rate}%</td><td>${formatCH(s.biggestWin)}</td><td class="${s.pnl > 0 ? 'pos' : s.pnl < 0 ? 'neg' : ''}">${s.pnl > 0 ? '+' : ''}${formatCH(s.pnl)}</td></tr>`;
  }).join('');
  const totals = Object.values(u.stats || {}).reduce((t, s) => ({ rounds: t.rounds + s.rounds, wins: t.wins + s.wins, best: Math.max(t.best, s.biggestWin) }), { rounds: 0, wins: 0, best: 0 });
  root.innerHTML = `
    <div class="profile-card">
      <div><strong>${nameFrame(state, u.id, u.nickname)}</strong><small>보유 ${formatCH(moneyOf(state))}원${state.bank?.debt ? ` · 남은 빚 ${formatCH(state.bank.debt)}원` : ''}</small></div>
    </div>
    ${u.guest ? guestCard(state) : ''}
    <dl class="stat-grid">
      <div><dt>총 손익</dt><dd class="${a.qualifiedPnl >= 0 ? 'pos' : 'neg'}">${a.qualifiedPnl >= 0 ? '+' : ''}${formatCH(a.qualifiedPnl)}</dd></div>
      <div><dt>총 베팅</dt><dd>${formatCH(a.totalWagered)}</dd></div>
      <div><dt>최고 자산</dt><dd>${formatCH(a.peakBankroll)}</dd></div>
      <div><dt>승률</dt><dd>${totals.rounds ? Math.round((totals.wins / totals.rounds) * 100) : 0}%</dd></div>
      <div><dt>최대 승리</dt><dd>${formatCH(totals.best)}</dd></div>
      <div><dt>최장 연승</dt><dd>${eng.streak?.best || 0}연승${eng.streak?.current > 1 ? ` <small>지금 ${eng.streak.current}</small>` : ''}</dd></div>
    </dl>
    <div data-invite-card></div>
    <button type="button" class="pill-button profile-shop" data-go-shop>꾸미기 상점 가기</button>
    <div data-wrapped-list></div>
    ${state.rankSeason?.history?.length ? `<h2 class="sub-head">지난 시즌 기록 <small>최고 ${tierName(state.rankSeason.best?.tier || state.rankSeason.history[0].tier)}</small></h2>${rankBadges(state.rankSeason.history)}` : ''}
    ${badges ? `<h2 class="sub-head">주간 시즌 배지</h2><ul class="badge-list">${badges}</ul>` : ''}
    <h2 class="sub-head">족보 도감 <small>${state.handBook ? `${state.handBook.count} / ${state.handBook.total}` : ''}</small></h2><div data-hand-book></div>
    <h2 class="sub-head">큰 판 다시보기 <small>${loadReplays().length || ''}</small></h2><div data-replays></div>
    <h2 class="sub-head">업적 <small>${(state.achievements || []).filter(x => x.claimed).length} / ${(state.achievements || []).length}</small></h2><div data-achievements></div>
    <h2 class="sub-head">게임별 기록</h2>
    ${games ? `<div class="game-stats-wrap"><table class="game-stats"><thead><tr><th scope="col">게임</th><th scope="col">판</th><th scope="col">승률</th><th scope="col">최대 승리</th><th scope="col">손익</th></tr></thead><tbody>${games}</tbody></table></div>` : '<p class="lounge-note">아직 플레이한 게임이 없어요.</p>'}
    <h2 class="sub-head">층</h2><ul class="floor-rows">${floors}</ul>
    ${u.guest ? "" : `<h2 class="sub-head">계정</h2>`}
    ${u.guest ? '' : `<div class="account-row"><span>${state.username ? `<b>${state.username}</b> 계정으로 로그인 중` : '로그인 중'}</span><button type="button" class="pill-button" data-sign-out>로그아웃</button></div>`}
    <div data-account-tools></div>`;
  const wl = wrappedBlock(state);
  if (wl) root.querySelector('[data-wrapped-list]').replaceWith(wl);
  renderInviteCard(root.querySelector('[data-invite-card]'), state);
  root.querySelector('[data-name-guest]')?.addEventListener('click', () => openNameSheet(applyState));
  renderAchievements(root.querySelector('[data-achievements]'));
  root.querySelector('[data-hand-book]').replaceWith(handBookBlock(state));
  root.querySelector('[data-replays]').replaceWith(replayBlock(state));
  root.querySelector('[data-go-shop]').addEventListener('click', () => showSurface('shop', { focus: true }));
  renderAccountTools(root.querySelector('[data-account-tools]'), state, applyState);
  renderAdmin(root, state, applyState);
  root.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
    forgetShownCode();
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
  // Several rewards waiting: one tap takes them all, one after another.
  const takeAll = ready.length > 1 ? el('button', 'pill-button pill-button--solid ach-all', `보상 ${ready.length}개 모두 받기 · ${formatCH(ready.reduce((n, a) => n + a.reward, 0))}`) : null;
  if (takeAll) {
    takeAll.type = 'button';
    takeAll.addEventListener('click', async () => {
      takeAll.disabled = true;
      let last = null, sum = 0;
      for (const a of ready) {
        try { const out = await api.achievementClaim(a.id); sum += out.claim.amount; last = out.state; }
        catch (e) { if (e?.code !== 'ACHIEVEMENT_ALREADY_CLAIMED') { errorToast(e); break; } }
      }
      if (sum) await chipsToWallet(takeAll, sum);
      if (last) applyState(last); else takeAll.disabled = false;
    });
  }
  box.replaceChildren(...(takeAll ? [takeAll] : []), ul, more);
}

// The notification sheet only interrupts the menus, never a hand in progress.
const inMenus = () => !document.body.classList.contains('game-mode') && !document.body.classList.contains('tier-mode');
// …and only once the player has finished a round and today's pay sheet is out of the way, so a
// new player's first screen is the free chips, not a permission prompt.
const askReady = () => Boolean(state) && !dailyDue(state) && Object.values(state.user?.stats || {}).some(s => s.rounds > 0);

// 오늘의 한 판 (js/daily.js), from the home chip or a friend's shared result link.
let dailyWanted = false;
function showDaily() { import('./js/daily.js').then(m => m.openDaily({ onClose: () => { if (state) refresh(); } })).catch(() => toast('오늘의 한 판을 열지 못했어요. 다시 눌러 주세요.')); }
// ./?daily=1 from a friend's shared result: drop it from the address and remember to open the sheet.
function takeDailyLink() {
  const params = new URLSearchParams(location.search);
  if (params.get('daily') !== '1') return false;
  params.delete('daily');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
  return true;
}
// 받기 on a friend's 도전 banner (js/news.js): sit at their table like an invite link would.
document.addEventListener('vegas:join-room', e => { const d = e.detail || {}; if (setPendingJoin({ ...d, tier: d.floor || d.tier })) openInvite(); });
// ./?rank=friends from a "친구가 들어왔어요" push: open the friends list.
let friendsWanted = (() => {
  const params = new URLSearchParams(location.search);
  if (params.get('rank') !== 'friends') return false;
  params.delete('rank');
  const q = params.toString();
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
  return true;
})();
function openFriendsLink() { if (friendsWanted && state) { friendsWanted = false; rankView = 'friends'; showSurface('ranking', { focus: true }); } }
function openDailyLink() { if (dailyWanted && state) { dailyWanted = false; showDaily(); } }

// ---------- account ----------
// A friend's invite link: once signed in, open that game; its room screen then takes the seat.
// Short of chips, the friend buys them first, at the room's floor even above their RP tier
// (lib/cashier.mjs roomFloor); the room screen then takes the seat.
let inviteBuying = false, inviteRoom = null;
async function openInvite() {
  const invite = pendingJoin();
  if (!invite || !state || inviteBuying) return;
  const game = GAMES.find(g => g.id === invite.screen && !g.event);
  if (!game) { dropPendingJoin(); return; }
  const tier = TIERS[invite.tier] ? invite.tier : (lastTier(game.id) || FIRST_TIER.slug);
  inviteRoom = { code: invite.code, tier };
  // Chips held without a seat go back to the wallet on the next move, so they don't count.
  if (!invite.watch && state.cashier?.on && (!state.cashier.seat || state.user.account.available < TIERS[tier].min)) {
    inviteBuying = true;
    let bought = null;
    try { bought = await buyInSheet(state, TIERS[tier], { room: invite.code }); } finally { inviteBuying = false; }
    if (!bought) { dropPendingJoin(); return; }
    applyState(bought);
  }
  sitAt(game, tier, null, { seated: true });
}
function signedIn(next) {
  shownWallet = null;
  applyState(next);
  startNotifications(inMenus, askReady);
  startNews();
  renderTiers();
  showSurface('lobby');
  ensureTerms();
  openInvite();
  openNightlyFromLink();
  openDailyLink();
  openFriendsLink();
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
  addEventListener(type, () => { audioUnlocked = true; syncMusic(); preloadSounds(); }, { once: true, capture: true });
}
document.addEventListener('visibilitychange', syncMusic);
new MutationObserver(paintSound).observe(document.querySelector('[data-surface="table"]') || document.body, { childList: true, subtree: true });
paintSound();

mountInstallButton(document.querySelector('[data-install]'));
watchConnection(refresh);
watchSeasonEnd(() => state);
if ('serviceWorker' in navigator && location.protocol !== 'file:') watchUpdates();

// A new build waits in the background (sw.js) until the player says so. Offered on the menus only, never mid-hand;
// leaving a table or coming back to the app asks again.
let waitingWorker = null;
let updating = false;
function offerUpdate() {
  if (!waitingWorker || updating || !inMenus() || document.hidden) return;
  toast('새 버전이 나왔어요', { action: '새로고침', duration: 12000, onAction: () => { updating = true; waitingWorker?.postMessage('skip-waiting'); } });
}
function watchUpdates() {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    const found = worker => { if (!worker || !navigator.serviceWorker.controller) return; waitingWorker = worker; offerUpdate(); };
    found(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') found(worker); });
    });
    // An app left open for days still hears about new builds.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { reg.update().catch(() => {}); offerUpdate(); } });
  }).catch(() => {});
}

renderGameLists();
showSurface('lobby');
dailyWanted = takeDailyLink();
capturePendingJoin();
// An invite link (/j?...) leaves the address bar once read, so a reload is the plain app.
history.replaceState({ vegasSurface: 'lobby' }, '', location.pathname === '/j' || location.pathname === '/j/' ? '/' : location.pathname);
if (sessionToken()) refresh().then(() => { renderTiers(); if (state) { startNotifications(inMenus, askReady); startNews(); ensureTerms(); openInvite(); openDailyLink(); openFriendsLink(); } });
else openSignIn(signedIn);
// Once home is up and quiet, fetch the game played last so its table opens without a wait.
addEventListener('load', () => (window.requestIdleCallback || (fn => setTimeout(fn, 1500)))(() => warmGame(GAMES.find(g => g.id === recentTables()[0]?.game)), { timeout: 4000 }), { once: true });
startPlaytime({ isInTable: () => document.body.classList.contains('game-mode') });
