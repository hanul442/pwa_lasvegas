// 상점: luxury assets (사치품) to show off and skins (꾸미기) for the tables. Prices, ownership
// and what is worn all come from the server (lib/shop.mjs); this screen only draws them.
import { api, errorMessage } from './api.js';
import { errorToast, toast } from './notice.js';
import { el, formatCH, sound } from './fx.js';
import { createCard, setCardBack } from './cards.js';
import { createChip } from './chips.js';

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
let tab = (() => { try { return localStorage.getItem(TAB_KEY) === 'cosmetics' ? 'cosmetics' : 'luxury'; } catch { return 'luxury'; } })();
// A floor whose skins the 꾸미기 tab scrolls to once, when a locked table sent the player here.
let focusFloor = null;
export function showShopTab(key, floor = null) {
  tab = key === 'cosmetics' ? 'cosmetics' : 'luxury';
  focusFloor = floor;
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
    b.addEventListener('click', () => { tab = key; try { localStorage.setItem(TAB_KEY, key); } catch {} renderShop(root, state, onChanged); });
    tabs.append(b);
  }
  const body = tab === 'luxury' ? luxuryTab(state, onChanged) : cosmeticsTab(state, onChanged);
  root.replaceChildren(tabs, body);
}

function luxuryTab(state, onChanged) {
  const shop = state.shop, available = state.user.account.available;
  const box = el('div', 'shop-pane');
  const summary = el('dl', 'shop-summary');
  summary.innerHTML = `<div><dt>보유 칩</dt><dd>${won(available)}</dd></div><div><dt>자산</dt><dd>${won(shop.assets)}</dd></div><div><dt>되팔면</dt><dd>${won(shop.resale)}</dd></div>`;
  const note = el('p', 'shop-note', `산 물건은 프로필과 랭킹에 걸려요. 언제든 산 값의 ${Math.round(shop.sellRate * 100)}%에 되팔 수 있어요. 자산은 층 입장에 들어가지 않아요.`);
  const list = el('ul', 'shop-list');
  for (const item of shop.luxury) {
    const li = el('li', `shop-row${item.owned ? ' is-owned' : ''}`);
    li.innerHTML = `${luxuryIcon(item.icon)}<div class="shop-row-text"><span class="shop-row-name">${item.name}${item.owned ? ' <small class="shop-tag">보유</small>' : ''}</span><small>${item.group} · ${item.blurb}</small><b class="shop-price">${won(item.owned ? item.paid : item.price)}</b></div>`;
    const b = el('button', `pill-button shop-buy${item.owned ? '' : ' pill-button--solid'}`);
    b.type = 'button';
    if (item.owned) {
      b.textContent = '되팔기';
      b.setAttribute('aria-label', `${item.name} 되팔기, ${won(item.resale)} 받기`);
      b.addEventListener('click', () => openSheet({
        eyebrow: '되팔기', title: item.name,
        body: `<p class="lounge-note">산 값 ${won(item.paid)}의 ${Math.round(shop.sellRate * 100)}%인 <b>${won(item.resale)}</b>을 칩으로 돌려받아요. 프로필과 랭킹에서도 빠져요.</p>`,
        confirmText: `${won(item.resale)}에 되팔기`,
        confirm: async () => { const out = await api.shopSell(item.id); sound.chips(4); onChanged(out.state); }
      }));
    } else {
      const short = available < item.price;
      b.textContent = '구매';
      b.disabled = short;
      b.setAttribute('aria-label', short ? `${item.name}, 칩이 부족해요` : `${item.name} ${won(item.price)}에 사기`);
      if (short) li.classList.add('is-short');
      b.addEventListener('click', () => openSheet({
        eyebrow: '사치품 구매', title: item.name,
        body: `<div class="shop-sheet-hero">${luxuryIcon(item.icon)}<div><b>${won(item.price)}</b><small>사고 나면 ${won(available - item.price)} 남아요</small></div></div><p class="lounge-note">되팔 때는 ${won(item.resale)}(${Math.round(shop.sellRate * 100)}%)만 돌아와요. 자산은 층 입장에 들어가지 않아요.${item.headline ? ' 라운지 소식에 모두에게 알려져요.' : ''}</p>`,
        confirmText: `${won(item.price)}에 사기`,
        confirm: async () => { const out = await api.shopBuy(item.id); sound.chips(6); onChanged(out.state); }
      }));
    }
    li.append(b);
    list.append(li);
  }
  box.append(summary, note, list);
  return box;
}

const SLOT_NAME = { cardBack: '카드 뒷면', felt: '펠트', chips: '칩 테두리', frame: '명패' };

// A player's name in the nameplate they wear (꾸미기 명패), for the ranking and the profile.
export function nameFrame(state, userId, nickname) {
  const user = userId === state?.user?.id ? state.user : state?.users?.find(u => u.id === userId);
  const frame = user?.cosmetics?.equipped?.frame;
  return frame ? `<span class="name-frame name-frame--${String(frame).replace(/^frame-/, '')}">${nickname}</span>` : nickname;
}

function preview(item, nickname) {
  const box = el('div', `skin-preview skin-preview--${item.slot}`);
  box.setAttribute('aria-hidden', 'true');
  if (item.slot === 'cardBack') {
    const card = createCard(null, { faceUp: false });
    card.querySelector('.card-back').className = item.house ? 'card-back' : `card-back back--${item.id.replace(/^back-/, '')}`;
    box.append(card);
  } else if (item.slot === 'felt') {
    box.classList.add(item.house ? 'felt-swatch--house' : `felt--skin-${item.id.replace(/^felt-/, '')}`);
  } else if (item.slot === 'frame') {
    box.innerHTML = item.house ? `<span class="name-frame-plain">${nickname}</span>` : `<span class="name-frame name-frame--${item.id.replace(/^frame-/, '')}">${nickname}</span>`;
  } else {
    box.classList.add(`chip-accent--${item.id.replace(/^chips-/, '')}`);
    box.append(createChip(10_000_000), createChip(1_000_000_000));
  }
  return box;
}

function skinTile(state, item, onChanged, pass) {
  const available = state.user.account.available;
  const li = el('li', `skin-tile${item.equipped ? ' is-equipped' : ''}${item.owned ? '' : ' is-locked'}`);
  li.append(preview(item, state.user.nickname));
  const status = item.owned ? (item.house ? '기본' : item.achievement ? `업적 「${item.achievementLabel}」` : '보유') : item.achievement ? `업적 「${item.achievementLabel}」 달성 시` : won(item.price);
  li.append(el('div', 'skin-text', `<span class="skin-name">${item.name}</span><small>${SLOT_NAME[item.slot]} · ${status}</small>`));
  if (item.equipped) {
    const tag = el('span', 'skin-on', '장착 중');
    tag.setAttribute('aria-hidden', 'true');
    li.append(tag);
  } else if (item.owned) {
    const b = el('button', 'pill-button skin-act', '장착');
    b.type = 'button';
    b.setAttribute('aria-label', `${item.name} 장착`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { const out = await api.shopEquip(item.slot, item.house ? null : item.id); sound.chip(); onChanged(out.state); }
      catch (e) { b.disabled = false; errorToast(e); }
    });
    li.append(b);
  } else if (!item.achievement) {
    const b = el('button', 'pill-button pill-button--solid skin-act', '구매');
    b.type = 'button';
    b.disabled = available < item.price;
    b.setAttribute('aria-label', `${item.name} ${won(item.price)}에 사기`);
    const opens = pass && !pass.passed;
    b.addEventListener('click', () => openSheet({
      eyebrow: `${SLOT_NAME[item.slot]} 구매`, title: item.name,
      body: `<p class="lounge-note">${item.blurb}. ${won(item.price)}에 사서 바로 장착해요. 꾸미기는 되팔 수 없어요.${opens ? ` <b>사면 ${pass.name} 입장권이 생겨요${pass.unlocked ? '. 바로 앉을 수 있어요' : `. 순자산 ${formatCH(pass.threshold)}원이 되면 열려요`}.</b>` : ''}</p>`,
      confirmText: `${won(item.price)}에 사기`,
      confirm: async () => {
        const bought = await api.shopBuy(item.id);
        const out = await api.shopEquip(item.slot, item.id);
        sound.chips(4);
        onChanged(out.state);
        if (bought.purchase?.pass && pass) toast(pass.unlocked ? `${pass.name} 입장권이 생겼어요. 이제 ${pass.name} 테이블에 앉을 수 있어요.` : `${pass.name} 입장권이 생겼어요. 순자산 ${formatCH(pass.threshold)}원이 되면 열려요.`);
      }
    }));
    li.append(b);
  }
  return li;
}

// Skins by floor: owning any one of a floor's skins is its pass (lib/cosmetics.mjs), then the
// free house and achievement ones.
function cosmeticsTab(state, onChanged) {
  const box = el('div', 'shop-pane');
  const all = state.shop.cosmetics;
  box.append(el('p', 'shop-note', '층마다 그 층의 꾸미기가 있어요. 하나라도 가지고 있어야 그 층 테이블에 앉을 수 있어요. 순자산 조건도 함께 채워야 해요.'));
  let focus = null;
  for (const pass of state.shop.passes || []) {
    const section = el('section', `pass-floor${pass.passed ? ' is-passed' : ''}${pass.unlocked && !pass.passed ? ' is-due' : ''}`);
    section.dataset.passFloor = pass.slug;
    const state_ = pass.passed ? (pass.unlocked ? '입장권 보유' : `입장권 보유 · 순자산 ${formatCH(pass.threshold)}원이면 열려요`) : pass.unlocked ? '순자산 충족 · 하나만 사면 입장' : `순자산 ${formatCH(pass.threshold)}원 + 꾸미기 하나`;
    section.append(el('h2', 'sub-head pass-head', `<span class="pass-mark" aria-hidden="true"></span>${pass.name} <small>${state_}</small>`));
    const grid = el('ul', 'skin-grid');
    for (const item of all.filter(x => x.floor === pass.slug)) grid.append(skinTile(state, item, onChanged, pass));
    section.append(grid);
    box.append(section);
    if (pass.slug === focusFloor) focus = section;
  }
  box.append(el('h2', 'sub-head', '기본 · 업적 <small>무료</small>'));
  const grid = el('ul', 'skin-grid');
  for (const item of all.filter(x => !x.floor)) grid.append(skinTile(state, item, onChanged, null));
  box.append(grid);
  if (focus) {
    focusFloor = null;
    requestAnimationFrame(() => { focus.scrollIntoView({ block: 'start', behavior: 'smooth' }); focus.classList.add('is-focus'); });
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
    body: `<dl class="shop-summary shop-summary--two"><div><dt>순자산</dt><dd>${won(row.wealth)}</dd></div><div><dt>자산</dt><dd>${won(user?.assets ?? row.assets ?? 0)}</dd></div></dl>${list}`
  });
}
