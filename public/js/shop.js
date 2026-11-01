// 상점: skins (꾸미기) for the tables; each floor's skins are its pass. Prices, ownership
// and what is worn all come from the server (lib/shop.mjs); this screen only draws them.
import { api, errorMessage } from './api.js';
import { errorToast } from './notice.js';
import { el, formatCH, wonCH, sound, haptic, ms, reducedMotion } from './fx.js';
import { moneyOf } from './money.js';
import { createCard, setCardBack } from './cards.js';
import { createHwatu } from './hwatu.js';
import { createChip } from './chips.js';
import { bragButton } from './share.js';
import { bragPurchase } from './brags.js';

const won = n => `${wonCH(n)}원`;

// ---------- applying skins ----------
// Card backs live in cards.js; the chip accent is a variable set on the page; the felt is read
// by each table as it opens (table.js); the nameplate is drawn with the name (nameFrame).
export function applyCosmetics(state) {
  const eq = state?.user?.cosmetics?.equipped || {};
  setCardBack(eq.cardBack ? eq.cardBack.replace(/^back-/, '') : null);
  const chips = eq.chips ? eq.chips.replace(/^chips-/, '') : '';
  if (chips) document.documentElement.dataset.chipAccent = chips;
  else delete document.documentElement.dataset.chipAccent;
  // 화투 뒷면·앞면: read by skins.css off the page, so every hwatu table (friends' rooms too) wears them.
  for (const [slot, key, prefix] of [['hwatuBack', 'hwBack', /^hwback-/], ['hwatuFace', 'hwFace', /^hwface-/]]) {
    if (eq[slot]) document.documentElement.dataset[key] = eq[slot].replace(prefix, '');
    else delete document.documentElement.dataset[key];
  }
}

// ---------- what owning a skin does (looks only: odds never change) ----------
// Skins: each bought one brings its own touch to the table.
const SKIN_FX = { cardBack: '카드가 깔릴 때 뒷면에 빛이 스쳐요', felt: '테이블에 앉으면 펠트 위로 빛이 지나가요', chips: '칩을 걸 때마다 칩 둘레로 빛 고리가 퍼져요', frame: '랭킹과 프로필의 내 이름에 걸려요', hwatuBack: '섯다·고스톱·맞고의 화투 뒷면이 바뀌어요', hwatuFace: '그림은 그대로, 화투 앞면 마감이 바뀌어요' };
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
const VIEW_KEY = 'vegas:shop-view';
const FLOOR_KEY = 'vegas:shop-floor';
const SLOT_KEY = 'vegas:shop-slot';
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const recall = key => { try { return localStorage.getItem(key); } catch { return null; } };
// Four ways in: one floor at a time, one kind at a time, the season's limited pieces, the free ones.
const TABS = [['floors', '층별'], ['slots', '종류별'], ['season', '시즌 한정'], ['free', '무료·업적']];
let view = TABS.some(([k]) => k === recall(VIEW_KEY)) ? recall(VIEW_KEY) : 'floors';
let pickedFloor = recall(FLOOR_KEY);
let pickedSlot = recall(SLOT_KEY) || 'cardBack';
// Set when a locked table sent the player here: open that floor and bring it into view once.
let focusFloor = null;
export function showShopTab(key, floor = null) {
  focusFloor = floor;
  if (floor) { view = 'floors'; pickedFloor = floor; }
}

export function renderShop(root, state, onChanged) {
  if (!state?.shop) { root.textContent = '불러오는 중…'; return; }
  const rerender = () => renderShop(root, state, onChanged);
  root.replaceChildren(cosmeticsTab(state, onChanged, rerender));
}

const SLOT_NAME = { cardBack: '카드 뒷면', felt: '펠트', chips: '칩 테두리', frame: '명패', hwatuBack: '화투 뒷면', hwatuFace: '화투 앞면' };
const HW_SLOTS = ['hwatuBack', 'hwatuFace'];

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
// A hwatu wearing one look (or the house look), whatever the page wears (skins.css skips .hw--pv).
function hwatuCard(item, id) {
  const back = item.slot === 'hwatuBack', node = createHwatu(id, { faceUp: !back });
  node.classList.add('hw--pv');
  node.style.removeProperty('--tilt');
  if (!item.house) node.querySelector(back ? '.hw-back' : '.hw-face').classList.add(back ? `hwback--${skinName(item.id, /^hwback-/)}` : `hwface--${skinName(item.id, /^hwface-/)}`);
  return node;
}
const feltClass = item => item.house ? 'felt-swatch--house' : `felt--skin-${skinName(item.id, /^felt-/)}`;
const chipClass = item => `chip-accent--${skinName(item.id, /^chips-/)}`;

function preview(item, nickname) {
  const box = el('div', `skin-preview skin-preview--${item.slot}`);
  box.setAttribute('aria-hidden', 'true');
  if (item.slot === 'cardBack') box.append(backCard(item), backCard(item));
  else if (item.slot === 'hwatuBack') box.append(hwatuCard(item, '01-1'), hwatuCard(item, '08-1'));
  else if (item.slot === 'hwatuFace') box.append(hwatuCard(item, '01-1'), hwatuCard(item, '03-2'), hwatuCard(item, '08-1'));
  else if (item.slot === 'felt') {
    // The cloth with a hand on it: a house card and a chip, so the colour reads as a table.
    box.classList.add(feltClass(item));
    const card = createCard(null, { faceUp: false });
    card.querySelector('.card-back').className = 'card-back';
    box.append(card, createChip(10_000_000));
  }
  else if (item.slot === 'frame') box.innerHTML = plate(item, nickname);
  else {
    // Two short stacks and a plaque, as they would sit in front of the player.
    box.classList.add(chipClass(item));
    for (const [value, n] of [[10_000_000, 5], [30_000_000, 3]]) {
      const stack = el('div', 'pv-stack');
      for (let i = 0; i < n; i++) { const c = createChip(value); c.style.setProperty('--i', i); stack.append(c); }
      box.append(stack);
    }
    box.append(createChip(1_000_000_000));
  }
  return box;
}

// The look as a whole: a corner of felt with a card, two chips and the nameplate, as the player
// wears it now. `tryOn` swaps one slot for a skin they are looking at.
const wornItem = (all, slot, equipped) => all.find(x => x.slot === slot && (equipped[slot] ? x.id === equipped[slot] : x.house));
function stage(state, tryOn = null, hw = false) {
  const all = state.shop.cosmetics, equipped = state.shop.equipped || {};
  const pick = slot => tryOn && tryOn.slot === slot ? tryOn : wornItem(all, slot, equipped);
  const box = el('div', `skin-stage ${feltClass(pick('felt'))}`);
  box.setAttribute('aria-hidden', 'true');
  const cards = el('div', 'skin-stage-cards');
  // Trying on a hwatu look, or looking at the hwatu slots, the hand on the felt is hwatu.
  if ((tryOn && HW_SLOTS.includes(tryOn.slot)) || (!tryOn && hw)) {
    cards.classList.add('skin-stage-cards--hw');
    cards.append(hwatuCard(pick('hwatuBack'), '01-1'), hwatuCard(pick('hwatuFace'), '01-1'), hwatuCard(pick('hwatuFace'), '08-1'));
  } else cards.append(backCard(pick('cardBack')), backCard(pick('cardBack')));
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
  body.append(el('p', 'lounge-note', `<b>${won(item.price)}</b> · ${item.blurb}. 사면 바로 장착하고, 꾸미기는 되팔 수 없어요.${skinEffect(item) ? ` 효과: ${skinEffect(item)}.` : ''}${opens ? ` <b>${pass.name} 입장권이 같이 생겨요${pass.unlocked ? '. 바로 앉을 수 있어요' : `. 순자산 ${wonCH(pass.threshold)}원이 되면 열려요`}.</b>` : ''}${short ? ` <b>${won(item.price - available)} 더 있어야 해요.</b>` : ''}`));
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
        stamp: newPass ? (pass.unlocked ? `${pass.name} 입장권 · 지금 앉을 수 있어요` : `${pass.name} 입장권 · 순자산 ${wonCH(pass.threshold)}원이면 열려요`) : ''
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
        stamp: pass ? (pass.unlocked ? '이번 시즌 · 지금 앉을 수 있어요' : `이번 시즌 · 순자산 ${wonCH(pass.threshold)}원이면 열려요`) : ''
      });
    }
  });
}

async function equip(item, onChanged, button) {
  if (button) button.disabled = true;
  try { const out = await api.shopEquip(item.slot, item.house ? null : item.id); sound.chip(); onChanged(out.state); }
  catch (e) { if (button) button.disabled = false; errorToast(e); }
}

function skinTile(state, item, onChanged, pass) {
  const available = moneyOf(state);
  const li = el('li', `skin-tile${item.equipped ? ' is-equipped' : ''}${item.owned ? '' : ' is-locked'}`);
  li.append(preview(item, state.user.nickname));
  const status = item.owned ? (item.house ? '기본' : item.achievement ? '업적 보상' : '보유') : item.achievement ? `업적 「${item.achievementLabel}」` : item.season ? '시즌 한정' : '';
  li.append(el('div', 'skin-text', `<span class="skin-name">${item.name}</span>${status ? `<small>${status}</small>` : ''}`));
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
    li.append(el('span', 'skin-lock', '잠김'));
  }
  return li;
}

// The floor shown first: the one a locked table sent the player to, else the one they picked last,
// else the highest floor open to them (where they play now).
function floorShown(passes) {
  if (focusFloor && passes.some(p => p.slug === focusFloor)) return focusFloor;
  if (pickedFloor && passes.some(p => p.slug === pickedFloor)) return pickedFloor;
  return [...passes].reverse().find(p => p.unlocked)?.slug || passes[0]?.slug || null;
}

// One shelf: a small head and the looks in one row you swipe sideways (a grid on wide screens).
function shelf(state, title, items, onChanged, passOf, { note = '', count = true } = {}) {
  const sec = el('section', 'shop-shelf');
  const owned = items.filter(x => x.owned).length;
  sec.append(el('div', 'shop-shelf-head', `<h3>${title}</h3>${count ? `<span class="shop-shelf-count">${owned}/${items.length}</span>` : ''}${note ? `<small>${note}</small>` : ''}`));
  const row = el('ul', 'skin-row');
  for (const item of items) row.append(skinTile(state, item, onChanged, passOf(item)));
  sec.append(row);
  return sec;
}

// Chips you swipe through to pick one floor or one kind.
function picker(label, entries, current, onPick) {
  const bar = el('div', 'shop-picker');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', label);
  for (const [key, text, cls = ''] of entries) {
    const b = el('button', `shop-pick${key === current ? ' is-active' : ''}${cls ? ` ${cls}` : ''}`, text);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === current));
    b.addEventListener('click', () => onPick(key));
    bar.append(b);
  }
  requestAnimationFrame(() => bar.querySelector('.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  return bar;
}

const SLOTS_ORDER = ['cardBack', 'felt', 'chips', 'frame', ...HW_SLOTS];
const bySlot = items => SLOTS_ORDER.map(slot => [slot, items.filter(x => x.slot === slot)]).filter(([, list]) => list.length);

// 상점: what I wear now (one small picture), four tabs that stay on top, then one floor or one
// kind at a time, each kind or floor in a row of its own.
function cosmeticsTab(state, onChanged, rerender) {
  const box = el('div', 'shop-pane');
  const all = state.shop.cosmetics;
  const passes = state.shop.passes || [];
  const era = Boolean(state.shop.era);
  const passOfSlug = slug => passes.find(p => p.slug === slug) || null;
  const passOf = item => item.floor ? passOfSlug(item.floor) : null;
  const limited = all.filter(x => x.season && x.onSale), past = all.filter(x => x.season && !x.onSale);
  const free = all.filter(x => !x.floor && !x.season);
  const tabs = TABS.filter(([k]) => k !== 'season' || limited.length || past.length);
  if (!tabs.some(([k]) => k === view)) view = 'floors';
  const go = (key, value) => { if (key === 'view') { view = value; remember(VIEW_KEY, value); } if (key === 'floor') { pickedFloor = value; remember(FLOOR_KEY, value); } if (key === 'slot') { pickedSlot = value; remember(SLOT_KEY, value); } rerender(); };

  // What I wear now, small: the felt, the hand (hwatu while looking at hwatu), the chips and my name.
  const worn = el('section', 'skin-worn');
  worn.append(stage(state, null, view === 'slots' && HW_SLOTS.includes(pickedSlot)));
  const passCount = passes.filter(p => p.passed).length;
  worn.append(el('p', 'skin-worn-label', `착용 중${era ? '' : ` · 입장권 ${passCount}/${passes.length}층`}`));
  box.append(worn);

  const bar = el('div', 'shop-tabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', '상점 보기');
  for (const [key, label] of tabs) {
    const b = el('button', `shop-tab${key === view ? ' is-active' : ''}`, label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === view));
    b.addEventListener('click', () => go('view', key));
    bar.append(b);
  }
  box.append(bar);

  if (view === 'floors') {
    const slug = floorShown(passes);
    box.append(picker('층 고르기', passes.map(p => [p.slug, `<span class="pick-mark${p.unlocked ? ' is-open' : ''}" aria-hidden="true"></span>${p.name}`]), slug, s => go('floor', s)));
    const pass = passOfSlug(slug);
    if (pass) {
      const items = all.filter(x => x.floor === pass.slug);
      const owned = items.filter(x => x.owned).length;
      const line = era ? (pass.unlocked ? '열린 층 · 꾸미기는 모양만 바꿔요' : `RP ${pass.rpNeed}이면 열리는 층 · 꾸미기는 먼저 사 둘 수 있어요`) : pass.passed
        ? (pass.unlocked ? '입장권 보유' : `입장권 보유 · 순자산 ${wonCH(pass.threshold)}원이면 열려요`)
        : pass.unlocked ? '순자산 충족 · 하나만 사거나 갱신하면 입장' : `순자산 ${wonCH(pass.threshold)}원 + 이번 달 입장권`;
      const head = el('div', `shop-floor-head${pass.unlocked ? ' is-open' : ''}`, `<span class="pass-mark" aria-hidden="true"></span><div><h2>${pass.name}</h2><small>${line}</small></div><span class="shop-floor-count">${owned}/${items.length}</span>`);
      head.dataset.passFloor = pass.slug;
      box.append(head);
      for (const [slot, list] of bySlot(items)) box.append(shelf(state, SLOT_NAME[slot], list, onChanged, passOf));
      if (focusFloor) {
        focusFloor = null;
        requestAnimationFrame(() => { bar.scrollIntoView({ block: 'start', behavior: 'smooth' }); head.classList.add('is-focus'); });
      }
    }
  } else if (view === 'slots') {
    box.append(picker('종류 고르기', SLOTS_ORDER.map(s => [s, SLOT_NAME[s]]), pickedSlot, s => go('slot', s)));
    const of = list => list.filter(x => x.slot === pickedSlot);
    // Free first (what costs nothing to swap to), then this season's, then floor by floor.
    if (of(free).length) box.append(shelf(state, '무료·업적', of(free), onChanged, passOf));
    if (of(limited).length) box.append(shelf(state, '시즌 한정', of(limited), onChanged, passOf));
    for (const pass of passes) {
      const list = of(all.filter(x => x.floor === pass.slug));
      if (list.length) box.append(shelf(state, pass.name, list, onChanged, passOf, { note: era ? (pass.unlocked ? '' : `RP ${pass.rpNeed}`) : '' }));
    }
    if (of(past).length) box.append(shelf(state, '지난 시즌 한정', of(past), onChanged, passOf));
  } else if (view === 'season') {
    // 시즌 한정 (lib/cosmetics.mjs SEASON_COSMETICS): sold only until the season ends.
    if (limited.length) {
      const ends = state.shop.season?.endsAt ? new Date(Date.parse(state.shop.season.endsAt) - 1).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }) : '';
      box.append(el('p', 'shop-note', `${state.shop.season?.name ? `<b>${state.shop.season.name}</b> · ` : ''}${ends ? `${ends}까지만 팔아요. ` : ''}시즌이 끝나면 다시 팔지 않고, 산 꾸미기는 계속 가져요.`));
      box.append(shelf(state, '이번 시즌', limited, onChanged, passOf));
    }
    // Past seasons' sets are no longer sold; the server sends them only to those who own them.
    if (past.length) box.append(shelf(state, '지난 시즌 한정', past, onChanged, passOf, { count: false, note: `${past.length}개 보유` }));
  } else {
    box.append(el('p', 'shop-note', '처음부터 있는 기본 꾸미기와, 업적을 달성하면 열리는 꾸미기예요.'));
    for (const [slot, list] of bySlot(free)) box.append(shelf(state, SLOT_NAME[slot], list, onChanged, passOf));
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
