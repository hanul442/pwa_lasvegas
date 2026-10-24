// 상점: luxury assets (사치품) to show off and skins (꾸미기) for the tables. Prices, ownership
// and what is worn all come from the server (lib/shop.mjs); this screen only draws them.
import { api, errorMessage } from './api.js';
import { errorToast } from './notice.js';
import { el, formatCH, sound, haptic, ms, reducedMotion } from './fx.js';
import { createCard, setCardBack } from './cards.js';
import { createChip } from './chips.js';
import { bragButton } from './share.js';
import { bragPurchase } from './brags.js';

const won = n => `${formatCH(n)}원`;

// One fine ivory line drawing per kind of asset, in the same hand as the game icons.
const LUX_ICON = {
  watch: '<rect x="18" y="4.5" width="12" height="8.5" rx="1.5"/><rect x="18" y="35" width="12" height="8.5" rx="1.5"/><circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="8"/><path d="M24 19.5V24l3.2 2.2M35 22.6v2.8"/>',
  car: '<path d="M5.5 31.5v-2.2c0-1.5 1-2.7 2.5-3l8.2-1.8 5.6-4.4c1.1-.9 2.5-1.4 3.9-1.4h5.4c1.6 0 3.1.6 4.2 1.7l3.8 3.8 3 .7c1.6.4 2.6 1.7 2.6 3.3v3.3h-3.8M12.3 33.5H7.5c-1.1 0-2-.9-2-2"/><circle cx="16" cy="33.5" r="3.7"/><circle cx="35.5" cy="33.5" r="3.7"/><path d="M19.7 33.5h12.1M17 25h22.5"/>',
  yacht: '<path d="M4.5 30.5h39L38 37.5H10z"/><path d="M10 30.5l3-5.5h19.5l6 5.5"/><path d="M15.5 25l2.5-4.5h10.5l3 4.5"/><path d="M21 20.5v-3.5h5"/><path d="M4 42.5c3 0 3-1.5 6.7-1.5s3.6 1.5 6.6 1.5 3.6-1.5 6.7-1.5 3.6 1.5 6.6 1.5 3.6-1.5 6.7-1.5 3 1.5 6.7 1.5"/>',
  apartment: '<rect x="14.5" y="6" width="19" height="35"/><path d="M9 41h30M19 12h2.5M26.5 12H29M19 18h2.5M26.5 18H29M19 24h2.5M26.5 24H29M19 30h2.5M26.5 30H29M22 41v-5h4v5"/>',
  building: '<rect x="7.5" y="15" width="17" height="26"/><rect x="24.5" y="6" width="15" height="35"/><path d="M4.5 41h39M11.5 21h9M11.5 27h9M11.5 33h9M28.5 12h7M28.5 18h7M28.5 24h7M28.5 30h7M30 41v-5h4v5"/>',
  jet: '<path d="M24 4.5c1.6 0 2.6 2.1 2.6 4.6v9.4l15 8.6v3.6l-15-4.6v8.6l4.6 3.6v2.7l-7.2-2-7.2 2v-2.7l4.6-3.6v-8.6l-15 4.6v-3.6l15-8.6V9.1c0-2.5 1-4.6 2.6-4.6z"/>',
  island: '<path d="M7 36.5c4.5-4.8 10.5-7 17-7s12.5 2.2 17 7"/><path d="M4 42c3 0 3-1.5 6.7-1.5s3.6 1.5 6.6 1.5 3.6-1.5 6.7-1.5 3.6 1.5 6.6 1.5 3.6-1.5 6.7-1.5 3 1.5 6.7 1.5"/><path d="M23 29.5c0-6.5 1.4-11.8 4.6-16.5"/><path d="M27.6 13c-3-3-8-3.2-11.4-.3M27.6 13c3.2-2.8 8.2-2.6 11.2.6M27.6 13c-2.6 1.4-4.6 4.4-5 8M27.6 13c2.4 1.6 4 4.6 4.2 8.2"/>',
  casino: '<path d="M8.5 41V20.5h31V41M5 41h38M8.5 20.5 24 9l15.5 11.5M20.5 41v-8.5h7V41M13 25.5h4.5V30H13zM30.5 25.5H35V30h-4.5z"/><path d="M24 13.4l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/>'
};
export function luxuryIcon(icon, cls = 'lux-icon') {
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${LUX_ICON[icon] || LUX_ICON.watch}</svg>`;
}
// The catalog entry for an item id, from the state's shop.
export const luxuryItem = (state, id) => state?.shop?.luxury?.find(x => x.id === id) || null;

// ---------- applying skins ----------
// Card backs live in cards.js; the chip accent is a variable set on the page; the felt is read
// by each table as it opens (table.js); the nameplate is drawn with the name (nameFrame).
export function applyCosmetics(state) {
  const eq = state?.user?.cosmetics?.equipped || {};
  setCardBack(eq.cardBack ? eq.cardBack.replace(/^back-/, '') : null);
  const chips = eq.chips ? eq.chips.replace(/^chips-/, '') : '';
  if (chips) document.documentElement.dataset.chipAccent = chips;
  else delete document.documentElement.dataset.chipAccent;
}

// ---------- what owning something does (looks only: odds never change) ----------
// Luxury: sitting down at a table, the dearest piece walks in with you. The dearer the piece,
// the bigger the entrance: a plate, then a beam of light, then a shower of stars.
export const luxuryLevel = (state, id) => {
  const at = (state?.shop?.luxury || []).findIndex(x => x.id === id);
  return at < 0 ? 1 : at >= 7 ? 3 : at >= 4 ? 2 : 1;
};
const LUX_FX = { 1: '테이블에 앉으면 오너 플레이트가 걸려요', 2: '테이블에 앉으면 오너 플레이트와 빛줄기가 함께 들어와요', 3: '테이블에 앉으면 오너 플레이트, 빛줄기, 쏟아지는 별로 입장해요' };
export const luxuryEffect = (state, id) => LUX_FX[luxuryLevel(state, id)];
// Skins: each bought one brings its own touch to the table.
const SKIN_FX = { cardBack: '카드가 깔릴 때 뒷면에 빛이 스쳐요', felt: '테이블에 앉으면 펠트 위로 빛이 지나가요', chips: '칩을 걸 때마다 칩 둘레로 빛 고리가 퍼져요', frame: '랭킹과 프로필의 내 이름에 걸려요' };
export const skinEffect = item => item.house ? null : SKIN_FX[item.slot];

// The entrance: the dearest piece this player owns, on a plate across the top of the felt.
export function ownerEntrance(state, felt) {
  const mine = (state?.user?.luxury || []).map(x => luxuryItem(state, x.id)).filter(Boolean);
  if (!felt || !mine.length) return;
  const top = mine.reduce((a, b) => (b.price > a.price ? b : a));
  const level = luxuryLevel(state, top.id);
  const node = el('div', `owner-entrance owner-entrance--${level}`);
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `${level >= 2 ? '<span class="owner-beam"></span>' : ''}<span class="owner-plate">${luxuryIcon(top.icon)}<span><small>${top.group} OWNER</small><b>${state.user.nickname}</b></span></span>`;
  if (level >= 3 && !reducedMotion()) node.append(sparkles(14, 'owner-spark'));
  felt.append(node);
  setTimeout(() => node.remove(), ms(3000) + 200);
}

// A handful of little stars scattered at random, for the entrance and the purchase moment.
function sparkles(n, cls) {
  const box = el('span', `${cls}s`);
  for (let i = 0; i < n; i++) {
    const s = el('i', cls);
    s.style.left = `${4 + Math.random() * 92}%`;
    s.style.top = `${6 + Math.random() * 80}%`;
    s.style.setProperty('--d', `${Math.round(Math.random() * 900)}ms`);
    s.style.setProperty('--s', (0.5 + Math.random() * 0.9).toFixed(2));
    box.append(s);
  }
  return box;
}

// ---------- the purchase moment ----------
// Buying something stops the screen for a beat: the piece draws itself in light (a skin shows on
// the table it will dress), and the dearer the piece, the more the room lights up.
export function acquireMoment({ eyebrow, title, line = '', note = '', art, level = 1, stamp = '' }) {
  const brag = () => bragPurchase({ eyebrow, title, line });
  return new Promise(resolve => {
    const node = el('div', `acquire acquire--${level}`);
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', `${title} ${eyebrow}`);
    node.innerHTML = `<div class="acquire-glow" aria-hidden="true"></div>${level >= 2 ? '<div class="acquire-beam" aria-hidden="true"></div>' : ''}
      <div class="acquire-inner">
        <div class="acquire-art"></div>
        <p class="acquire-eyebrow">${eyebrow}</p>
        <h2 class="acquire-title">${title}</h2>
        ${line ? `<p class="acquire-line">${line}</p>` : ''}
        ${note ? `<p class="acquire-note">${note}</p>` : ''}
        ${stamp ? `<p class="acquire-stamp"><span aria-hidden="true"></span>${stamp}</p>` : ''}
        <div class="moment-actions"><button type="button" class="pill-button acquire-close">좋아요</button></div>
      </div>`;
    node.querySelector('.acquire-art').append(art);
    node.querySelector('.moment-actions').prepend(bragButton(brag, '자랑하기'));
    if (!reducedMotion()) node.prepend(sparkles(level === 3 ? 34 : level === 2 ? 18 : 9, 'acquire-spark'));
    // The line drawing traces itself: every stroke starts hidden and is drawn in.
    node.querySelectorAll('.acquire-art .lux-icon :is(path,rect,circle)').forEach(p => p.setAttribute('pathLength', '1'));
    document.body.append(node);
    requestAnimationFrame(() => node.classList.add('is-open'));
    sound.win();
    setTimeout(() => sound.chips(level * 3), ms(380));
    if (level >= 3) setTimeout(() => sound.win(), ms(900));
    haptic(level >= 3 ? [30, 40, 30, 40, 140] : level === 2 ? [30, 40, 80] : 40);
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      removeEventListener('keydown', onKey, true);
      node.classList.remove('is-open');
      setTimeout(() => { node.remove(); resolve(); }, ms(300));
    };
    const onKey = e => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.target.closest?.('.brag-button'))) { e.preventDefault(); e.stopPropagation(); close(); } };
    addEventListener('keydown', onKey, true);
    node.addEventListener('click', e => { if (e.target === node || e.target.closest('.acquire-close')) close(); });
    node.querySelector('.brag-button').focus({ preventScroll: true });
  });
}

// ---------- bottom sheet ----------
// The same sheet the bank uses: a title, a few lines, and one confirm button.
export function openSheet({ eyebrow, title, body = '', confirm = null, confirmText = '', danger = false }) {
  const scrim = el('div', 'lounge-scrim');
  const sheet = el('section', 'lounge-sheet shop-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'shop-sheet-title');
  sheet.innerHTML = `<p class="lounge-eyebrow">${eyebrow}</p><h2 id="shop-sheet-title">${title}</h2>`;
  const content = el('div', 'shop-sheet-body');
  if (typeof body === 'string') content.innerHTML = body; else content.append(body);
  sheet.append(content);
  const actions = el('div', 'lounge-sheet-actions');
  const cancel = el('button', 'pill-button', '닫기');
  cancel.type = 'button';
  actions.append(cancel);
  let go = null;
  if (confirm) {
    go = el('button', `pill-button pill-button--solid${danger ? ' pill-button--danger' : ''}`, confirmText);
    go.type = 'button';
    actions.append(go);
  }
  sheet.append(actions);
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => { scrim.classList.add('is-open'); sheet.classList.add('is-open'); (go || cancel).focus({ preventScroll: true }); });
  const close = () => {
    scrim.classList.remove('is-open'); sheet.classList.remove('is-open');
    removeEventListener('keydown', onKey, true);
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 320);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', close);
  cancel.addEventListener('click', close);
  go?.addEventListener('click', async () => {
    go.disabled = true;
    try { await confirm(); close(); }
    catch (e) {
      go.disabled = false;
      let note = content.querySelector('.bank-error');
      if (!note) { note = el('p', 'bank-error'); note.setAttribute('role', 'alert'); content.append(note); }
      note.textContent = errorMessage(e);
    }
  });
  return close;
}

// ---------- the screen ----------
const TABS = [['luxury', '사치품'], ['cosmetics', '꾸미기']];
const TAB_KEY = 'vegas:shop-tab';
const VIEW_KEY = 'vegas:shop-skin-view';
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const recall = key => { try { return localStorage.getItem(key); } catch { return null; } };
let tab = recall(TAB_KEY) === 'cosmetics' ? 'cosmetics' : 'luxury';
// The 꾸미기 tab shows either the floors (each floor's skins are its pass) or one slot at a time.
const VIEWS = [['floors', '층 입장권'], ['cardBack', '카드 뒷면'], ['felt', '펠트'], ['chips', '칩'], ['frame', '명패']];
let view = VIEWS.some(([k]) => k === recall(VIEW_KEY)) ? recall(VIEW_KEY) : 'floors';
// A floor whose skins the 꾸미기 tab opens and scrolls to once, when a locked table sent the player here.
let focusFloor = null;
// Floors the player opened or closed by hand this visit, so a re-render (after a purchase) keeps them.
const floorOpenByHand = new Map();
export function showShopTab(key, floor = null) {
  tab = key === 'cosmetics' ? 'cosmetics' : 'luxury';
  focusFloor = floor;
  if (floor) { view = 'floors'; floorOpenByHand.delete(floor); }
}

export function renderShop(root, state, onChanged) {
  if (!state?.shop) { root.textContent = '불러오는 중…'; return; }
  const tabs = el('div', 'tabs shop-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [key, label] of TABS) {
    const b = el('button', `tab${key === tab ? ' is-active' : ''}`, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === tab));
    b.addEventListener('click', () => { tab = key; remember(TAB_KEY, key); renderShop(root, state, onChanged); });
    tabs.append(b);
  }
  const rerender = () => renderShop(root, state, onChanged);
  const body = tab === 'luxury' ? luxuryTab(state, onChanged) : cosmeticsTab(state, onChanged, rerender);
  root.replaceChildren(tabs, body);
}

const pct = rate => Math.round(rate * 100);

function sellSheet(shop, item, onChanged) {
  openSheet({
    eyebrow: '되팔기', title: item.name,
    body: `<div class="shop-sheet-hero">${luxuryIcon(item.icon)}<div><b>${won(item.resale)}</b><small>산 값 ${won(item.paid)}의 ${pct(shop.sellRate)}%</small></div></div><p class="lounge-note">칩으로 바로 돌려받고, 프로필과 랭킹에서 빠져요.</p>`,
    confirmText: `${won(item.resale)}에 되팔기`,
    confirm: async () => { const out = await api.shopSell(item.id); sound.chips(4); onChanged(out.state); }
  });
}

function buySheet(shop, item, available, onChanged) {
  const short = available < item.price;
  openSheet({
    eyebrow: `사치품 · ${item.group}`, title: item.name,
    body: `<div class="shop-sheet-hero">${luxuryIcon(item.icon)}<div><b>${won(item.price)}</b><small>${short ? `${won(item.price - available)} 더 있어야 해요` : `사고 나면 ${won(available - item.price)} 남아요`}</small></div></div><p class="lounge-note">${item.blurb}. 프로필과 랭킹에 걸리고, 되팔면 ${won(item.resale)}(${pct(shop.sellRate)}%)가 돌아와요. 층 입장에는 들어가지 않아요.${item.headline ? ' 사면 라운지 소식으로 모두에게 알려져요.' : ''}</p><p class="shop-fx"><span aria-hidden="true"></span>${luxuryEffect({ shop }, item.id)}</p>`,
    confirmText: short ? '' : `${won(item.price)}에 사기`,
    confirm: short ? null : async () => {
      const out = await api.shopBuy(item.id);
      onChanged(out.state);
      const level = luxuryLevel({ shop }, item.id);
      const art = el('div', 'acquire-lux', luxuryIcon(item.icon));
      acquireMoment({ eyebrow: item.id === 'casino' ? 'THE HOUSE IS YOURS' : 'NEW ACQUISITION', title: item.name, line: `${won(item.price)} · ${item.group}`, note: `효과: ${luxuryEffect({ shop }, item.id)}`, art, level });
    }
  });
}

// 사치품: what I own sits on a shelf at the top, the next thing worth saving for under it, then
// the whole ladder as cards. A card is the button: the sheet it opens says what buying costs.
function luxuryTab(state, onChanged) {
  const shop = state.shop, available = state.user.account.available;
  const box = el('div', 'shop-pane');
  const summary = el('dl', 'shop-summary');
  summary.innerHTML = `<div><dt>보유 칩</dt><dd>${won(available)}</dd></div><div><dt>자산</dt><dd>${won(shop.assets)}</dd></div><div><dt>되팔면</dt><dd>${won(shop.resale)}</dd></div>`;
  box.append(summary);

  const mine = shop.luxury.filter(x => x.owned).sort((a, b) => b.paid - a.paid);
  box.append(el('h2', 'sub-head shop-head', `내 컬렉션 <small>${mine.length ? `${mine.length}점` : '비어 있음'}</small>`));
  if (mine.length) {
    const shelf = el('ul', 'lux-shelf');
    shelf.setAttribute('aria-label', '내 컬렉션');
    for (const item of mine) {
      const li = el('li');
      const b = el('button', 'lux-piece');
      b.type = 'button';
      b.setAttribute('aria-label', `${item.name}, 되팔면 ${won(item.resale)}`);
      b.innerHTML = `${luxuryIcon(item.icon)}<span class="lux-piece-name">${item.name}</span><small>${won(item.paid)}</small>`;
      b.addEventListener('click', () => sellSheet(shop, item, onChanged));
      li.append(b);
      shelf.append(li);
    }
    box.append(shelf);
  } else {
    box.append(el('p', 'shop-empty', `아직 산 물건이 없어요. 산 물건은 프로필과 랭킹에서 이름 옆에 걸려요.`));
  }

  // The next goal: the cheapest piece the chips can't reach yet (or, when they reach all, the cheapest left).
  const unowned = shop.luxury.filter(x => !x.owned).sort((a, b) => a.price - b.price);
  const next = unowned.find(x => x.price > available) || unowned[0];
  if (next) {
    const ready = available >= next.price;
    const goal = el('button', `lux-goal${ready ? ' is-ready' : ''}`);
    goal.type = 'button';
    goal.innerHTML = `<span class="lux-goal-label">다음 목표</span>${luxuryIcon(next.icon)}<span class="lux-goal-text"><b>${next.name}</b><small>${ready ? `${won(next.price)} · 지금 살 수 있어요` : `${won(next.price - available)} 더 모으면 살 수 있어요`}</small></span><span class="lux-goal-bar" aria-hidden="true"><i style="width:${Math.min(100, Math.round(available / next.price * 100))}%"></i></span>`;
    goal.addEventListener('click', () => buySheet(shop, next, available, onChanged));
    box.append(goal);
  }

  box.append(el('h2', 'sub-head shop-head', `전체 <small>${shop.luxury.length}점 · 되팔면 산 값의 ${pct(shop.sellRate)}%</small>`));
  const grid = el('ul', 'lux-grid');
  for (const item of shop.luxury) {
    const short = !item.owned && available < item.price;
    const li = el('li');
    const b = el('button', `lux-card${item.owned ? ' is-owned' : ''}${short ? ' is-short' : ''}`);
    b.type = 'button';
    const foot = item.owned ? '<span class="lux-card-own"><i aria-hidden="true"></i>보유 중</span>' : short ? `<span class="lux-card-need">${won(item.price - available)} 부족</span>` : '<span class="lux-card-buy">살 수 있어요</span>';
    b.innerHTML = `${luxuryIcon(item.icon)}<span class="lux-card-group">${item.group}</span><span class="lux-card-name">${item.name}</span><b class="lux-card-price">${won(item.owned ? item.paid : item.price)}</b>${foot}`;
    b.setAttribute('aria-label', item.owned ? `${item.name}, 보유 중, 되팔면 ${won(item.resale)}` : `${item.name}, ${won(item.price)}${short ? ', 칩이 부족해요' : ''}`);
    b.addEventListener('click', () => item.owned ? sellSheet(shop, item, onChanged) : buySheet(shop, item, available, onChanged));
    li.append(b);
    grid.append(li);
  }
  box.append(grid, el('p', 'shop-note', '자산은 자랑용이에요. 층 입장은 칩에서 빚을 뺀 순자산으로만 정해져요.'));
  return box;
}

const SLOT_NAME = { cardBack: '카드 뒷면', felt: '펠트', chips: '칩 테두리', frame: '명패' };

// A player's name in the nameplate they wear (꾸미기 명패), for the ranking and the profile.
export function nameFrame(state, userId, nickname) {
  const user = userId === state?.user?.id ? state.user : state?.users?.find(u => u.id === userId);
  const frame = user?.cosmetics?.equipped?.frame;
  return frame ? `<span class="name-frame name-frame--${String(frame).replace(/^frame-/, '')}">${nickname}</span>` : nickname;
}

const skinName = (id, prefix) => String(id).replace(prefix, '');
const plate = (item, nickname) => item.house ? `<span class="name-frame-plain">${nickname}</span>` : `<span class="name-frame name-frame--${skinName(item.id, /^frame-/)}">${nickname}</span>`;
function backCard(item) {
  const card = createCard(null, { faceUp: false });
  card.querySelector('.card-back').className = item.house ? 'card-back' : `card-back back--${skinName(item.id, /^back-/)}`;
  return card;
}
const feltClass = item => item.house ? 'felt-swatch--house' : `felt--skin-${skinName(item.id, /^felt-/)}`;
const chipClass = item => `chip-accent--${skinName(item.id, /^chips-/)}`;

function preview(item, nickname) {
  const box = el('div', `skin-preview skin-preview--${item.slot}`);
  box.setAttribute('aria-hidden', 'true');
  if (item.slot === 'cardBack') box.append(backCard(item));
  else if (item.slot === 'felt') box.classList.add(feltClass(item));
  else if (item.slot === 'frame') box.innerHTML = plate(item, nickname);
  else { box.classList.add(chipClass(item)); box.append(createChip(10_000_000), createChip(1_000_000_000)); }
  return box;
}

// The look as a whole: a corner of felt with a card, two chips and the nameplate, as the player
// wears it now. `tryOn` swaps one slot for a skin they are looking at.
const wornItem = (all, slot, equipped) => all.find(x => x.slot === slot && (equipped[slot] ? x.id === equipped[slot] : x.house));
function stage(state, tryOn = null) {
  const all = state.shop.cosmetics, equipped = state.shop.equipped || {};
  const pick = slot => tryOn && tryOn.slot === slot ? tryOn : wornItem(all, slot, equipped);
  const box = el('div', `skin-stage ${feltClass(pick('felt'))}`);
  box.setAttribute('aria-hidden', 'true');
  const cards = el('div', 'skin-stage-cards');
  const a = backCard(pick('cardBack')), b = backCard(pick('cardBack'));
  cards.append(a, b);
  const chips = el('div', `skin-stage-chips ${chipClass(pick('chips'))}`);
  chips.append(createChip(10_000_000), createChip(100_000_000), createChip(1_000_000_000));
  const name = el('div', 'skin-stage-name', plate(pick('frame'), state.user.nickname));
  box.append(cards, chips, name);
  return box;
}

function buySkinSheet(state, item, onChanged, pass) {
  const available = state.user.account.available;
  const short = available < item.price;
  const opens = pass && !pass.passed;
  const body = el('div');
  body.append(stage(state, item));
  body.append(el('p', 'lounge-note', `<b>${won(item.price)}</b> · ${item.blurb}. 사면 바로 장착하고, 꾸미기는 되팔 수 없어요.${skinEffect(item) ? ` 효과: ${skinEffect(item)}.` : ''}${opens ? ` <b>${pass.name} 입장권이 같이 생겨요${pass.unlocked ? '. 바로 앉을 수 있어요' : `. 순자산 ${formatCH(pass.threshold)}원이 되면 열려요`}.</b>` : ''}${short ? ` <b>${won(item.price - available)} 더 있어야 해요.</b>` : ''}`));
  openSheet({
    eyebrow: `${SLOT_NAME[item.slot]}${item.floor && pass ? ` · ${pass.name}` : ''}`, title: item.name, body,
    confirmText: short ? '' : `${won(item.price)}에 사고 장착`,
    confirm: short ? null : async () => {
      const bought = await api.shopBuy(item.id);
      const out = await api.shopEquip(item.slot, item.id);
      onChanged(out.state);
      const newPass = bought.purchase?.pass && pass;
      const art = stage(out.state, null);
      art.classList.add('acquire-stage');
      acquireMoment({
        eyebrow: 'NEW LOOK', title: item.name, art,
        level: newPass ? 2 : 1,
        line: `${SLOT_NAME[item.slot]} · ${won(item.price)}`,
        note: skinEffect(item) ? `효과: ${skinEffect(item)}` : '',
        stamp: newPass ? (pass.unlocked ? `${pass.name} 입장권 · 지금 앉을 수 있어요` : `${pass.name} 입장권 · 순자산 ${formatCH(pass.threshold)}원이면 열려요`) : ''
      });
    }
  });
}

// A skin bought in an earlier month: buying it again is this month's pass to its floor.
function renewSheet(state, item, onChanged, pass) {
  const available = state.user.account.available;
  const short = available < item.price;
  const body = el('div');
  body.append(stage(state, item));
  body.append(el('p', 'lounge-note', `입장권은 한 달 동안만 유지돼요. 이미 가진 꾸미기를 다시 사면 <b>${pass ? pass.name : '이 층'} 입장권</b>이 이번 시즌 동안 생겨요.${short ? ` <b>${won(item.price - available)} 더 있어야 해요.</b>` : ''}`));
  openSheet({
    eyebrow: `입장권 갱신${pass ? ` · ${pass.name}` : ''}`, title: item.name, body,
    confirmText: short ? '' : `${won(item.price)}에 갱신`,
    confirm: short ? null : async () => {
      const out = await api.shopBuy(item.id);
      onChanged(out.state);
      const art = stage(out.state, null);
      art.classList.add('acquire-stage');
      acquireMoment({
        eyebrow: 'PASS', title: pass ? `${pass.name} 입장권` : item.name, art, level: 2,
        line: `${item.name} · ${won(item.price)}`,
        stamp: pass ? (pass.unlocked ? '이번 시즌 · 지금 앉을 수 있어요' : `이번 시즌 · 순자산 ${formatCH(pass.threshold)}원이면 열려요`) : ''
      });
    }
  });
}

async function equip(item, onChanged, button) {
  if (button) button.disabled = true;
  try { const out = await api.shopEquip(item.slot, item.house ? null : item.id); sound.chip(); onChanged(out.state); }
  catch (e) { if (button) button.disabled = false; errorToast(e); }
}

function skinTile(state, item, onChanged, pass, { showFloor = false } = {}) {
  const available = state.user.account.available;
  const li = el('li', `skin-tile${item.equipped ? ' is-equipped' : ''}${item.owned ? '' : ' is-locked'}`);
  li.append(preview(item, state.user.nickname));
  const where = showFloor && pass ? pass.name : SLOT_NAME[item.slot];
  const status = item.owned ? (item.house ? '기본' : item.achievement ? '업적 보상' : '보유') : item.achievement ? `업적 「${item.achievementLabel}」` : null;
  li.append(el('div', 'skin-text', `<span class="skin-name">${item.name}</span><small>${where}${status ? ` · ${status}` : ''}</small>`));
  if (item.renewable && pass && !pass.passed) {
    const short = available < item.price;
    const b = el('button', `pill-button skin-act skin-price${short ? ' is-short' : ''}`, `갱신 ${won(item.price)}`);
    b.type = 'button';
    b.setAttribute('aria-label', `${item.name}로 ${pass.name} 입장권 갱신, ${won(item.price)}`);
    b.addEventListener('click', () => renewSheet(state, item, onChanged, pass));
    li.append(b);
  } else if (item.equipped) {
    li.append(el('span', 'skin-on', '장착 중'));
  } else if (item.owned) {
    const b = el('button', 'pill-button skin-act', '장착');
    b.type = 'button';
    b.setAttribute('aria-label', `${item.name} 장착`);
    b.addEventListener('click', () => equip(item, onChanged, b));
    li.append(b);
  } else if (!item.achievement) {
    const short = available < item.price;
    const b = el('button', `pill-button skin-act skin-price${short ? ' is-short' : ''}`, won(item.price));
    b.type = 'button';
    b.setAttribute('aria-label', `${item.name} ${won(item.price)}${short ? ', 칩이 부족해요' : '에 사기'}`);
    b.addEventListener('click', () => buySkinSheet(state, item, onChanged, pass));
    li.append(b);
  } else {
    li.append(el('span', 'skin-lock', '업적을 달성하면 열려요'));
  }
  return li;
}

// Which floor opens by itself: the one a locked table sent the player to, else the one a single
// purchase would let them into, else the next floor still without a pass.
function floorToOpen(passes) {
  return focusFloor
    || passes.find(p => p.unlocked && !p.passed)?.slug
    || passes.find(p => !p.passed)?.slug
    || null;
}

// 꾸미기: what I wear now on top (one picture of the whole look), then the floors or one slot.
function cosmeticsTab(state, onChanged, rerender) {
  const box = el('div', 'shop-pane');
  const all = state.shop.cosmetics, equipped = state.shop.equipped || {};
  const passes = state.shop.passes || [];

  const worn = el('section', 'skin-worn');
  worn.append(stage(state));
  const slots = el('ul', 'skin-slots');
  for (const slot of ['cardBack', 'felt', 'chips', 'frame']) {
    const item = wornItem(all, slot, equipped);
    const li = el('li');
    const b = el('button', `skin-slot${view === slot ? ' is-active' : ''}`, `<small>${SLOT_NAME[slot]}</small><span>${item?.name ?? '기본'}</span>`);
    b.type = 'button';
    b.setAttribute('aria-label', `${SLOT_NAME[slot]}: ${item?.name ?? '기본'}. 바꾸기`);
    b.addEventListener('click', () => { view = slot; remember(VIEW_KEY, slot); rerender(); });
    li.append(b);
    slots.append(li);
  }
  worn.append(slots);
  const passCount = passes.filter(p => p.passed).length;
  box.append(el('h2', 'sub-head shop-head', `착용 중 <small>입장권 ${passCount}/${passes.length}층</small>`), worn);

  const filter = el('div', 'shop-filter');
  filter.setAttribute('role', 'tablist');
  filter.setAttribute('aria-label', '꾸미기 보기');
  for (const [key, label] of VIEWS) {
    const b = el('button', `shop-filter-chip${key === view ? ' is-active' : ''}`, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === view));
    b.addEventListener('click', () => { view = key; remember(VIEW_KEY, key); rerender(); });
    filter.append(b);
  }
  box.append(filter);

  if (view === 'floors') {
    box.append(el('p', 'shop-note', '층마다 그 층의 꾸미기가 넷 있어요. 하나만 가지고 있어도 그 층 입장권이 돼요. 순자산 조건도 함께 채워야 해요.'));
    const auto = floorToOpen(passes);
    let focus = null;
    for (const pass of passes) {
      const items = all.filter(x => x.floor === pass.slug);
      const owned = items.filter(x => x.owned).length;
      const section = el('details', `pass-floor${pass.passed ? ' is-passed' : ''}${pass.unlocked && !pass.passed ? ' is-due' : ''}`);
      section.dataset.passFloor = pass.slug;
      section.open = floorOpenByHand.has(pass.slug) ? floorOpenByHand.get(pass.slug) : pass.slug === auto;
      section.addEventListener('toggle', () => floorOpenByHand.set(pass.slug, section.open));
      const state_ = pass.passed
        ? (pass.unlocked ? '입장권 보유' : `입장권 보유 · 순자산 ${formatCH(pass.threshold)}원이면 열려요`)
        : pass.unlocked ? '순자산 충족 · 하나만 사거나 갱신하면 입장' : `순자산 ${formatCH(pass.threshold)}원 + 이번 달 입장권`;
      const head = el('summary', 'pass-head', `<span class="pass-mark" aria-hidden="true"></span><span class="pass-name">${pass.name}</span><span class="pass-count">${owned}/${items.length}</span><small class="pass-state">${state_}</small>`);
      section.append(head);
      const grid = el('ul', 'skin-grid');
      for (const item of items) grid.append(skinTile(state, item, onChanged, pass));
      section.append(grid);
      box.append(section);
      if (pass.slug === focusFloor) focus = section;
    }
    if (focus) {
      focusFloor = null;
      requestAnimationFrame(() => { focus.scrollIntoView({ block: 'start', behavior: 'smooth' }); focus.classList.add('is-focus'); });
    }
    const free = all.filter(x => !x.floor);
    box.append(el('h2', 'sub-head', `기본 · 업적 <small>무료 ${free.filter(x => x.owned).length}/${free.length}</small>`));
    const grid = el('ul', 'skin-grid');
    for (const item of free) grid.append(skinTile(state, item, onChanged, null));
    box.append(grid);
  } else {
    // One slot: what I own first (cheapest to swap to), then what is for sale, then achievements.
    const passOf = slug => passes.find(p => p.slug === slug) || null;
    const rank = x => x.equipped ? 0 : x.owned ? 1 : x.achievement ? 3 : 2;
    const items = all.filter(x => x.slot === view).sort((a, b) => rank(a) - rank(b) || a.price - b.price);
    box.append(el('p', 'shop-note', `${SLOT_NAME[view]} ${items.length}가지. 층 꾸미기는 그 층 입장권도 돼요.`));
    const grid = el('ul', 'skin-grid');
    for (const item of items) grid.append(skinTile(state, item, onChanged, item.floor ? passOf(item.floor) : null, { showFloor: true }));
    box.append(grid);
  }
  return box;
}

// Another player's collection, opened from the ranking.
export function openPlayerSheet(state, row) {
  const user = state?.users?.find(u => u.id === row.id);
  const items = (user?.luxury || []).map(x => ({ ...x, item: luxuryItem(state, x.id) })).filter(x => x.item).sort((a, b) => b.price - a.price);
  const list = items.length
    ? `<ul class="showcase-list">${items.map(x => `<li>${luxuryIcon(x.item.icon)}<span>${x.item.name}</span><small>${won(x.price)}</small></li>`).join('')}</ul>`
    : '<p class="lounge-note">아직 산 사치품이 없어요.</p>';
  openSheet({
    eyebrow: row.id === state.user.id ? '내 컬렉션' : '플레이어',
    title: row.nickname,
    body: `<dl class="shop-summary shop-summary--two"><div><dt>순자산</dt><dd>${won(row.wealth)}</dd></div><div><dt>자산</dt><dd>${won(user?.assets ?? row.assets ?? 0)}</dd></div></dl>${user && state.handBook ? `<p class="lounge-note">족보 도감 ${user.jokbo ?? 0} / ${state.handBook.total}칸</p>` : ''}${list}`
  });
}
