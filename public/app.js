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
import { renderLounge, maybeOpenDaily, dailyButton, celebrateFloors, gameName, chipsToWallet } from './js/lounge.js';
import { startNotifications, maybeAsk, forgetDevice } from './js/notify.js';
import { mountInstallButton } from './js/install.js';
import { startNews, stopNews } from './js/news.js';
import { maybeBust } from './js/bust.js';
import { renderBank } from './js/bank.js';

document.documentElement.dataset.vegasUi = 'live-tables';

const GAMES = [
  { id: 'blackjack', name: 'Blackjack', tag: '21에 가깝게, 블랙잭은 3 대 2', blurb: '21에 가깝게. 블랙잭은 3 대 2로 받아요.', mount: mountBlackjack },
  { id: 'roulette', name: 'Roulette', tag: '싱글 제로 휠, 숫자 하나에 35배', blurb: '싱글 제로 유럽식 휠. 숫자 하나에 걸면 35배.', mount: mountRoulette },
  { id: 'baccarat', name: 'Baccarat', tag: '플레이어냐 뱅커냐', blurb: '플레이어와 뱅커 중 한쪽에. 카드는 천천히 열려요.', mount: mountBaccarat },
  { id: 'dice', name: 'Sic Bo', tag: '주사위 세 개의 합', blurb: '주사위 세 개의 합을 맞혀요.', mount: mountDice },
  { id: 'matgo', name: '맞고', tag: '둘이서 치는 고스톱', blurb: '둘이서 치는 고스톱. AI보다 먼저 7점을 내세요.', mount: mountMatgo },
  { id: 'gostop', name: '고스톱', tag: 'AI 둘과 셋이서 고·스톱', blurb: '셋이서 치는 고스톱. AI 둘과 3점부터 고·스톱.', mount: mountGostop },
  { id: 'seotda', name: '섯다', tag: '두 장으로 겨루는 족보 싸움', blurb: '화투 두 장의 족보 싸움. 땡잡이와 암행어사까지.', mount: mountSeotda },
  { id: 'poker', name: "Hold'em", tag: 'AI들과 텍사스 홀덤', blurb: 'AI 플레이어들과 텍사스 홀덤. 칩으로 바이인하고 앉아요.', mount: mountHoldem },
  { id: 'slots', name: 'Slots', tag: '별 세 개면 잭팟', blurb: '레버를 당겨요. 별 세 개면 모두가 키운 잭팟이 터져요.', mount: mountSlots },
  // Event tables (lib/events.mjs): one runs each week, reached from the 이벤트 tab.
  { id: 'royale', event: 'royale', guide: 'poker', name: 'Casino Royale', blurb: '007 체험 이벤트. 하이롤러 다섯 명과 홀덤 토너먼트, 마지막 한 사람이 판돈을 전부 가져가요.', mount: ctx => mountHoldem(ctx, { royale: true }) },
  { id: 'tazza', event: 'tazza', guide: 'gostop', name: '타짜 나이트', blurb: '아귀와 고광렬이 앉는 고스톱. 모든 판이 묻고 더블 ×2로 시작해요.', mount: ctx => mountGostop(ctx, { event: 'tazza' }) },
  { id: 'oceans', event: 'oceans', guide: 'blackjack', name: "Ocean's Heist", blurb: '대니의 크루와 블랙잭. 다섯 판 연속으로 이기면 금고가 열려요.', mount: ctx => mountBlackjack(ctx, { event: 'oceans' }) },
  { id: 'rounders', event: 'rounders', guide: 'poker', name: 'Rounders', blurb: '홀덤 1대1 보스전. 이기면 다음 보스로, 마지막은 KGB 테디.', mount: ctx => mountHoldem(ctx, { tourney: 'rounders' }) },
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

// A floor this player has outgrown (net worth ≥ 1,000× its minimum) stays shut; only a seat they
// already hold in a room there can bring them back.
const outgrownTier = slug => Boolean(state?.floors?.find(f => f.slug === TIERS[slug]?.floor)?.outgrown);

async function openTable(tier, { seated = false } = {}) {
  if (!selectedGame) return;
  if (!seated && outgrownTier(tier)) { renderTiers(); showSurface('tiers', { focus: true }); return; }
  try { localStorage.setItem(LAST_TABLE_KEY, JSON.stringify({ game: selectedGame.id, tier })); } catch {}
  history.pushState({ vegasSurface: 'table' }, '', `#table-${selectedGame.id}-${tier}`);
  showSurface('table');
  closeTable();
  voice.preload(selectedGame.guide || selectedGame.id);
  // Event tables play the tense 'noir' cue; the rest of the casino keeps the big band.
  music.theme(selectedGame.event ? 'noir' : 'lounge');
  activeTable = await selectedGame.mount({ mount: tableMount, tier, state, onLeave: () => leaveTable() });
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
  showSurface('games'); restoreTrigger();
}

document.querySelector('[data-tier-back]').addEventListener('click', () => leaveTable());
window.addEventListener('popstate', event => {
  if (event.state?.vegasSurface === 'tiers') { showSurface('tiers', { focus: true }); return; }
  if (event.state?.vegasSurface === 'table') { showSurface('tiers'); return; }
  if (document.body.classList.contains('game-mode') || document.body.classList.contains('tier-mode')) { showSurface('games'); restoreTrigger(); }
});
window.addEventListener('keydown', event => { if (event.key === 'Escape') leaveTable(); });
// A room screen sends someone back to the table where they still hold a seat.
addEventListener('vegas:open-table', event => {
  const game = GAMES.find(g => g.id === event.detail?.game);
  if (!game) return;
  selectedGame = game;
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
  renderRecharge();
  renderGameLists();
  maybeBust(state);
  renderLounge(document.querySelector('[data-lounge]'), state, applyState);
  if (isActive('ranking')) renderRanking();
  if (isActive('profile')) renderProfile();
  if (isActive('bank')) renderBank(document.querySelector('[data-bank]'), state, applyState);
  if (isActive('tiers')) renderTiers();
  if (isActive('lobby')) { celebrateFloors(state); maybeOpenDaily(state, applyState); }
}

// The lobby offers to sit back down at the last table played on this device.
const LAST_TABLE_KEY = 'vegas:last-table';
function lastTable() {
  try {
    const t = JSON.parse(localStorage.getItem(LAST_TABLE_KEY) || 'null');
    return t && GAMES.some(g => g.id === t.game && playable(g)) && TIERS[t.tier] ? t : null;
  } catch { return null; }
}

function renderRecharge() {
  const slot = document.querySelector('[data-recharge-slot]');
  const r = state?.recharge;
  slot.replaceChildren();
  const daily = dailyButton(state, applyState);
  if (daily) slot.append(daily);
  // Not enough for the cheapest table where this player may sit: the bank is the way back in.
  if (state?.bank && state.user.account.available < state.bank.base) {
    const b = el('button', 'pill-button pill-button--solid', '은행에서 칩 빌리기');
    b.type = 'button';
    b.addEventListener('click', () => showSurface('bank', { focus: true }));
    slot.append(b);
  }
  const last = lastTable();
  const lastEventElsewhere = last && GAMES.find(g => g.id === last.game)?.event && TIERS[last.tier]?.floor !== state?.eventEntry?.floor;
  if (last && !outgrownTier(last.tier) && !lastEventElsewhere) {
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
  if (g.event) b.classList.add('is-event');
  b.innerHTML = `${icon(g.id)}<span class="game-row-name">${g.name}</span><span class="game-row-desc">${g.tag || g.blurb}</span>`;
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
  slots: '<rect x="7" y="12" width="34" height="24" rx="3"/><path d="M18.3 12v24M29.7 12v24"/><path d="M12.6 21l1.1 2.3 2.5.3-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.3zM24 21l1.1 2.3 2.5.3-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.3zM35.4 21l1.1 2.3 2.5.3-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.3z"/>'
};
const icon = id => `<svg class="game-row-icon" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICON[id] || ICON.poker}</svg>`;
// The smallest table this player can sit at right now: the lowest floor they have unlocked and
// not yet outgrown.
function entryMin() {
  const open = Object.values(TIERS).filter(t => {
    const f = state?.floors?.find(x => x.slug === t.floor);
    return f ? f.unlocked && !f.outgrown : t === TIERS.corner;
  });
  return (open.length ? Math.min(...open.map(t => t.min)) : TIERS.corner.min);
}
const GROUPS = [['카지노', ['blackjack', 'roulette', 'baccarat', 'dice', 'poker', 'slots']], ['화투', ['matgo', 'gostop', 'seotda']]];
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

// The lobby carries one slim teaser for this week's event; the 이벤트 tab has the rest.
function renderEvents() {
  const slot = document.querySelector('[data-events]');
  const g = GAMES.find(x => x.event && eventOf(x));
  const ev = g && eventOf(g);
  slot.hidden = !ev;
  if (!ev) { slot.replaceChildren(); return; }
  const b = el('button', `event-banner event-banner--teaser event-banner--${g.id}`);
  b.type = 'button';
  b.innerHTML = `<span class="event-kicker">이번 주 이벤트 · ${timeLeft(ev.until)} 남음</span><strong class="event-title">${ev.title}</strong><span class="event-cta">이벤트 보기</span>`;
  b.addEventListener('click', () => showSurface('events', { focus: true }));
  slot.replaceChildren(b);
  if (document.querySelector('[data-surface="events"]').classList.contains('is-active')) renderEventTab();
}

const dayLabel = iso => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });
function eventCard(ev, { now = false } = {}) {
  const g = GAMES.find(x => x.event === ev.id);
  const card = el('article', `event-banner event-card event-banner--${ev.id}${now ? '' : ' is-upcoming'}`);
  const when = now ? `${timeLeft(ev.until)} 남음` : `${dayLabel(ev.from)} 시작`;
  card.innerHTML = `<span class="event-kicker">${ev.kicker} · ${when}</span><strong class="event-title">${ev.title}</strong><span class="event-blurb">${ev.blurb}</span><ul class="event-rules">${ev.rules.map(r => `<li>${r}</li>`).join('')}</ul>${entryLine()}`;
  if (now && g) {
    const go = el('button', 'event-cta', '테이블 고르기');
    go.type = 'button';
    go.dataset.game = g.id;
    go.addEventListener('click', () => chooseGame(go));
    card.append(go);
  }
  return card;
}
// Events seat only big players: one fixed table, and a minimum holding to sit down.
function eventEntry() {
  const e = state?.eventEntry;
  const tier = e && Object.values(TIERS).find(t => t.floor === e.floor);
  return e && tier ? { ...e, tier, open: (state?.user?.account?.available ?? 0) >= e.entry } : null;
}
function entryLine() {
  const e = eventEntry();
  if (!e) return '';
  return `<p class="event-entry${e.open ? ' is-open' : ''}">입장 · 보유 칩 ${formatCH(e.entry)} 이상 · ${e.tier.name} ${formatCH(e.tier.min)}–${formatCH(e.tier.max)}원${e.open ? '' : ' · 아직 입장할 수 없어요'}</p>`;
}
function renderEventTab() {
  const [now, next, ...later] = state?.eventSchedule || [];
  const live = now && eventOf({ event: now.id }) ? now : null;
  document.querySelector('[data-event-now]').replaceChildren(live ? eventCard(live, { now: true }) : el('p', 'lede', '이번 주에는 열린 이벤트가 없어요.'));
  document.querySelector('[data-event-next]').replaceChildren(...(next ? [eventCard(next)] : []));
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
  if (selectedGame?.event && eventEntry()) return renderEventTier(grid, eventEntry());
  const all = Object.values(TIERS).map(tier => ({ tier, floor: floors.find(f => f.slug === tier.floor) }));
  const outgrown = all.filter(x => x.floor?.outgrown);
  const firstLocked = all.findIndex(x => x.floor && !x.floor.unlocked);
  const shown = all.filter((x, i) => !x.floor?.outgrown && (firstLocked < 0 || i <= firstLocked + 1));
  const note = outgrown.length ? [el('p', 'tier-outgrown', `${outgrown.map(x => x.tier.name).join(' · ')}은 졸업했어요. 순자산이 최소 베팅의 1,000배가 되면 그 층에는 앉지 않아요.`)] : [];
  grid.replaceChildren(...note, ...shown.map(({ tier, floor }) => {
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
    const status = locked ? `순자산 ${formatCH(floor?.threshold || 0)}원이 되면 열려요 (${Math.round((floor?.progress || 0) * 100)}%)` : broke ? '칩이 부족해요 · 은행에서 빌릴 수 있어요' : floor?.ceiling ? `순자산 ${formatCH(floor.ceiling)}원부터는 졸업` : '끝없는 층';
    b.innerHTML = `<strong>${tier.name}</strong><span>${formatCH(tier.min)} – ${formatCH(tier.max)}원</span><small>${status}</small>`;
    chips.setAttribute('aria-hidden', 'true');
    b.append(chips);
    b.addEventListener('click', () => openTable(tier.slug));
    return b;
  }));
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
  document.querySelector('[data-rank-list]').replaceChildren(...rows.map(r => {
    const li = el('li', `rank-row${r.id === me ? ' is-me' : ''}${r.rank <= 3 ? ` is-top is-top-${r.rank}` : ''}`);
    li.innerHTML = `<span class="rank-no">${r.rank}</span><span class="rank-name">${r.nickname}${r.id === me ? ' <small>나</small>' : ''}</span><span class="rank-value">${value(r)}</span>`;
    return li;
  }));
  renderDuels(document.querySelector('[data-duels]'), state, applyState);
}

// ---------- profile ----------
const LEDGER_LABEL = { INITIAL_GRANT: '시작 칩', GAME_WIN: '승리', GAME_LOSS: '패배', GAME_PUSH: '무승부', BET_LOCK: '베팅', BET_SETTLE: '정산', AUTO_RECHARGE: '충전', BANKRUPTCY: '파산', ADMIN_GRANT: '지급', ADMIN_DEDUCT: '회수', DAILY_BONUS: '일급', MISSION_REWARD: '미션 보상', SEASON_REWARD: '시즌 보상', RESCUE_GRANT: '럭키 카드', JACKPOT_WIN: '잭팟', LOAN_DISBURSE: '대출', LOAN_REPAY: '상환', LOAN_COLLECT: '자동 회수', BANKRUPTCY_SEIZURE: '파산 압류', DEBT_DISCHARGED: '빚 탕감', WEEKLY_PAY: '주급', MONTHLY_PAY: '월급', GOV_GRANT: '정부 지원금', WELFARE: '생계급여', ACHIEVEMENT: '업적', CHALLENGE_PRIZE: '대결 상금' };
function renderProfile() {
  const root = document.querySelector('[data-profile]');
  if (!state) { root.textContent = '불러오는 중…'; return; }
  const u = state.user, a = u.account;
  const floors = state.floors.map(f => `<li class="floor-row${f.open ? ' is-open' : ''}${f.outgrown ? ' is-outgrown' : ''}"><span>${f.name}${f.outgrown ? ' <small>졸업</small>' : ''}</span><span class="floor-bar"><i style="width:${Math.round(f.progress * 100)}%"></i></span></li>`).join('');
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
      <div><strong>${u.nickname}</strong><small>보유 ${formatFull(a.available)}원${state.bank?.debt ? ` · 빚 ${formatFull(state.bank.debt)}원 · 신용 ${state.bank.credit.grade}등급` : ''}</small></div>
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
    <h2 class="sub-head">업적 <small>${(state.achievements || []).filter(x => x.claimed).length} / ${(state.achievements || []).length}</small></h2><div data-achievements></div>
    <h2 class="sub-head">게임별 기록</h2>
    ${games ? `<div class="game-stats-wrap"><table class="game-stats"><thead><tr><th scope="col">게임</th><th scope="col">판</th><th scope="col">승률</th><th scope="col">최대 승리</th><th scope="col">손익</th></tr></thead><tbody>${games}</tbody></table></div>` : '<p class="lounge-note">아직 플레이한 게임이 없어요.</p>'}
    <h2 class="sub-head">층</h2><ul class="floor-rows">${floors}</ul>
    <h2 class="sub-head">최근 기록</h2><ul class="ledger">${ledger || '<li><span>아직 기록이 없어요</span></li>'}</ul>
    <h2 class="sub-head">계정</h2>
    <div class="account-row"><span>${state.username ? `<b>${state.username}</b> 계정으로 로그인 중` : '로그인 중'}</span><button type="button" class="pill-button" data-sign-out>로그아웃</button></div>`;
  renderAchievements(root.querySelector('[data-achievements]'));
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
        catch (e) { b.disabled = false; alert(errorMessage(e)); }
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

mountInstallButton(document.querySelector('[data-install]'));
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

renderLobby();
showSurface('lobby');
history.replaceState({ vegasSurface: 'lobby' }, '', location.pathname);
if (sessionToken()) refresh().then(() => { renderTiers(); if (state) { startNotifications(inMenus); startNews(); } });
else openSignIn(signedIn);
dealVignette();
