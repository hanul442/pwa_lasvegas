// Getting between tables quickly: the tables played lately on this device (the lobby's
// "최근 테이블" row and the in-table switcher), the table last used per game, and the switcher
// sheet that opens from a table's name.
import { el, formatCH, sound } from './fx.js';
import { TIERS } from './chips.js';

const RECENT_KEY = 'vegas:recent-tables';
const LAST_TABLE_KEY = 'vegas:last-table'; // the single "다시 앉기" entry older builds kept
const tierKey = game => `vegas:last-tier:${game}`;
const RECENT_KEEP = 12;

function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

// Most recent first, one entry per game and table.
export function recentTables() {
  let list = read(RECENT_KEY);
  if (!Array.isArray(list)) {
    const last = read(LAST_TABLE_KEY);
    list = last?.game ? [last] : [];
  }
  return list.filter(x => x && typeof x.game === 'string' && TIERS[x.tier]);
}

export function rememberTable(game, tier) {
  if (!TIERS[tier]) return;
  const list = recentTables().filter(x => !(x.game === game && x.tier === tier));
  list.unshift({ game, tier, at: Date.now() });
  write(RECENT_KEY, list.slice(0, RECENT_KEEP));
  write(tierKey(game), tier);
  write(LAST_TABLE_KEY, { game, tier });
}

export function lastTier(game) {
  const t = read(tierKey(game));
  return TIERS[t] ? t : null;
}

// The table switcher: a bottom sheet over the table.
// games: [{ id, name, tag }] in display order; current: the game at this table.
// tierFor(game) -> tier slug to go straight to, or null when the player has to pick.
// tiersOf(game) -> [{ slug, name, min, max, open }] for the current game's table row.
// onGame(game), onTier(slug), onAllTiers()
export function openTableSwitcher({ games, current, currentTier, tierFor, tiersOf, onGame, onTier, onAllTiers, maxOf = t => t.max }) {
  document.querySelector('.table-switcher')?.dispatchEvent(new Event('vegas:close'));
  const scrim = el('div', 'lounge-scrim');
  const sheet = el('section', 'lounge-sheet table-switcher');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'switcher-title');
  sheet.innerHTML = `<header class="switcher-head"><p class="lounge-eyebrow">지금 ${current.name} · ${TIERS[currentTier]?.name || ''}</p><h2 id="switcher-title">테이블 바꾸기</h2></header>`;
  const close = () => {
    scrim.classList.remove('is-open'); sheet.classList.remove('is-open');
    removeEventListener('keydown', onKey, true);
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 320);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  const pick = fn => () => { sound.tick(); close(); fn(); };

  // This game's other tables, when it has more than one.
  const tiers = current.event ? [] : tiersOf(current);
  if (tiers.length) {
    const block = el('div', 'switcher-block');
    block.append(el('h3', 'switcher-label', `${current.name} 테이블`));
    const row = el('div', 'switcher-tiers');
    for (const t of tiers) {
      const b = el('button', `switcher-tier${t.slug === currentTier ? ' is-current' : ''}`);
      b.type = 'button';
      b.innerHTML = `<strong>${t.name}</strong><small>${formatCH(t.min)}–${formatCH(maxOf(t))}</small>`;
      if (t.slug === currentTier) b.setAttribute('aria-current', 'true');
      b.disabled = !t.open || t.slug === currentTier;
      b.addEventListener('click', pick(() => onTier(t.slug)));
      row.append(b);
    }
    const all = el('button', 'switcher-all', '모든 테이블 보기');
    all.type = 'button';
    all.addEventListener('click', pick(onAllTiers));
    block.append(row, all);
    sheet.append(block);
  }

  // Every game: the ones played lately first, each at the table it would open.
  const order = recentTables().map(x => x.game);
  const rank = id => { const i = order.indexOf(id); return i < 0 ? order.length + games.findIndex(g => g.id === id) : i; };
  const list = el('ul', 'switcher-games');
  list.setAttribute('aria-label', '게임');
  for (const g of [...games].sort((a, b) => rank(a.id) - rank(b.id))) {
    const li = el('li');
    const b = el('button', `switcher-game${g.id === current.id ? ' is-current' : ''}`);
    b.type = 'button';
    const tier = TIERS[tierFor(g)];
    b.innerHTML = `<strong>${g.name}</strong><small>${g.id === current.id ? '지금 앉은 게임' : tier ? `${tier.name} · ${formatCH(tier.min)}–${formatCH(maxOf(tier))}` : '테이블 고르기'}</small>`;
    if (g.id === current.id) { b.setAttribute('aria-current', 'true'); b.disabled = true; }
    b.addEventListener('click', pick(() => onGame(g)));
    li.append(b);
    list.append(li);
  }
  sheet.append(el('h3', 'switcher-label', '다른 게임'), list);

  const actions = el('div', 'lounge-sheet-actions');
  const shut = el('button', 'pill-button', '닫기');
  shut.type = 'button';
  shut.addEventListener('click', close);
  actions.append(shut);
  sheet.append(actions);

  sheet.addEventListener('vegas:close', close);
  scrim.addEventListener('click', close);
  addEventListener('keydown', onKey, true);
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => {
    scrim.classList.add('is-open'); sheet.classList.add('is-open');
    sheet.querySelector('.switcher-game:not(:disabled), .switcher-tier:not(:disabled), button')?.focus({ preventScroll: true });
  });
  return close;
}
