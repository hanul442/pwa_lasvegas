// 상점: skins (꾸미기) for the tables; each floor's skins are its pass. Prices, ownership
// and what is worn all come from the server (lib/shop.mjs); this screen only draws them.
import { api, errorMessage } from './api.js';
import { errorToast } from './notice.js';
import { el, formatCH, sound, haptic, ms, reducedMotion } from './fx.js';
import { moneyOf } from './money.js';
import { createCard, setCardBack } from './cards.js';
import { createChip } from './chips.js';
import { bragButton } from './share.js';
import { bragPurchase } from './brags.js';

const won = n => `${formatCH(n)}원`;

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

// ---------- what owning a skin does (looks only: odds never change) ----------
// Skins: each bought one brings its own touch to the table.
const SKIN_FX = { cardBack: '카드가 깔릴 때 뒷면에 빛이 스쳐요', felt: '테이블에 앉으면 펠트 위로 빛이 지나가요', chips: '칩을 걸 때마다 칩 둘레로 빛 고리가 퍼져요', frame: '랭킹과 프로필의 내 이름에 걸려요' };
export const skinEffect = item => item.house ? null : SKIN_FX[item.slot];

// A handful of little stars scattered at random, for the purchase moment.
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
const VIEW_KEY = 'vegas:shop-skin-view';
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const recall = key => { try { return localStorage.getItem(key); } catch { return null; } };
// The 꾸미기 tab shows either the floors (each floor's skins are its pass) or one slot at a time.
const VIEWS = [['floors', '층별'], ['cardBack', '카드 뒷면'], ['felt', '펠트'], ['chips', '칩'], ['frame', '명패']];
let view = VIEWS.some(([k]) => k === recall(VIEW_KEY)) ? recall(VIEW_KEY) : 'floors';
// A floor whose skins the 꾸미기 tab opens and scrolls to once, when a locked table sent the player here.
let focusFloor = null;
// Floors the player opened or closed by hand this visit, so a re-render (after a purchase) keeps them.
const floorOpenByHand = new Map();
export function showShopTab(key, floor = null) {
  focusFloor = floor;
  if (floor) { view = 'floors'; floorOpenByHand.delete(floor); }
}

export function renderShop(root, state, onChanged) {
  if (!state?.shop) { root.textContent = '불러오는 중…'; return; }
  const rerender = () => renderShop(root, state, onChanged);
  root.replaceChildren(cosmeticsTab(state, onChanged, rerender));
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
  const available = moneyOf(state);
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
  const available = moneyOf(state);
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
  const available = moneyOf(state);
  const li = el('li', `skin-tile${item.equipped ? ' is-equipped' : ''}${item.owned ? '' : ' is-locked'}`);
  li.append(preview(item, state.user.nickname));
  const where = showFloor && pass ? pass.name : SLOT_NAME[item.slot];
  const status = item.owned ? (item.house ? '기본' : item.achievement ? '업적 보상' : '보유') : item.achievement ? `업적 「${item.achievementLabel}」` : null;
  li.append(el('div', 'skin-text', `<span class="skin-name">${item.name}${item.season ? '<span class="skin-limited">한정</span>' : ''}</span><small>${where}${status ? ` · ${status}` : ''}</small>`));
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
  const passCount = passes.filter(p => p.passed).length, era = Boolean(state.shop.era);
  box.append(el('h2', 'sub-head shop-head', era ? '착용 중' : `착용 중 <small>입장권 ${passCount}/${passes.length}층</small>`), worn);

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
    box.append(el('p', 'shop-note', era ? '층마다 그 층의 꾸미기가 넷 있어요. 층은 RP 티어로 열리고, 꾸미기는 모양만 바꿔요.' : '층마다 그 층의 꾸미기가 넷 있어요. 하나만 가지고 있어도 그 층 입장권이 돼요. 순자산 조건도 함께 채워야 해요.'));
    // 시즌 한정 (lib/cosmetics.mjs SEASON_COSMETICS): this season's four, sold only until it ends.
    const limited = all.filter(x => x.season && x.onSale);
    if (limited.length) {
      const sec = el('section', 'season-shop');
      const ends = state.shop.season?.endsAt ? new Date(Date.parse(state.shop.season.endsAt) - 1).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }) : '';
      sec.append(el('div', 'season-shop-head', `<h3>시즌 한정</h3><small>${state.shop.season?.name || ''}${ends ? ` · ${ends}까지` : ''}</small>`));
      sec.append(el('p', 'shop-note', '이번 시즌에만 파는 꾸미기예요. 시즌이 끝나면 다시 팔지 않고, 산 꾸미기는 계속 가져요.'));
      const grid = el('ul', 'skin-grid');
      for (const item of limited) grid.append(skinTile(state, item, onChanged, null));
      sec.append(grid);
      box.append(sec);
    }
    const auto = era ? (focusFloor || null) : floorToOpen(passes);
    let focus = null;
    for (const pass of passes) {
      const items = all.filter(x => x.floor === pass.slug);
      const owned = items.filter(x => x.owned).length;
      const section = el('details', `pass-floor${pass.passed && (!era || pass.unlocked) ? ' is-passed' : ''}${pass.unlocked && !pass.passed ? ' is-due' : ''}`);
      section.dataset.passFloor = pass.slug;
      section.open = floorOpenByHand.has(pass.slug) ? floorOpenByHand.get(pass.slug) : pass.slug === auto;
      section.addEventListener('toggle', () => floorOpenByHand.set(pass.slug, section.open));
      const state_ = era ? (pass.unlocked ? '열린 층' : `RP ${pass.rpNeed}이면 열려요`) : pass.passed
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
    box.append(el('p', 'shop-note', `${SLOT_NAME[view]} ${items.length}가지.${era ? '' : ' 층 꾸미기는 그 층 입장권도 돼요.'}`));
    const grid = el('ul', 'skin-grid');
    for (const item of items) grid.append(skinTile(state, item, onChanged, item.floor ? passOf(item.floor) : null, { showFloor: true }));
    box.append(grid);
  }
  return box;
}

// Another player, opened from the ranking.
export function openPlayerSheet(state, row) {
  const user = state?.users?.find(u => u.id === row.id);
  openSheet({
    eyebrow: row.id === state.user.id ? '내 정보' : '플레이어',
    title: row.nickname,
    body: `<dl class="shop-summary shop-summary--two"><div><dt>순자산</dt><dd>${won(row.wealth)}</dd></div></dl>${user && state.handBook ? `<p class="lounge-note">족보 도감 ${user.jokbo ?? 0} / ${state.handBook.total}칸</p>` : ''}`
  });
}
