// 상점: luxury assets to show off, and cosmetic skins for the tables. Every purchase is a PURCHASE
// ledger row (chips go to the house); a luxury item sold back is a RESALE row at SELL_RATE of
// what was paid. Luxury assets are trophies, not chips: floors still open on chips minus debt
// (lib/state.mjs netWorth). Skins are what lets a player in, though: each floor above the Gold
// Room opens only once they own one of that floor's skins (lib/cosmetics.mjs).
import { addLedger } from './economy.mjs';
import { ACHIEVEMENTS } from './achievements.mjs';
import { pushFeed } from './engagement.mjs';
import { isMoney, FLOORS } from './constants.mjs';
import { SLOTS, COSMETICS, PASS_ITEMS } from './cosmetics.mjs';
import { SELL_RATE, luxuryValue, resaleOf, hasFloorPass, floorOpen } from './state.mjs';

export { SELL_RATE };

const 억 = 100_000_000, 조 = 10_000 * 억;

// The luxury ladder, cheapest first. icon names the line drawing the client uses.
// headline: buying one goes in the lounge feed and the news banner; push: also to phones.
export const LUXURY = [
  { id: 'watch-steel', group: '시계', icon: 'watch', name: '스틸 크로노그래프', blurb: '매일 차는 시계', price: 1 * 억 },
  { id: 'watch-tourbillon', group: '시계', icon: 'watch', name: '투르비용 워치', blurb: '한 해에 몇 점만 나오는 시계', price: 5 * 억 },
  { id: 'car-gt', group: '슈퍼카', icon: 'car', name: 'V12 그랜드 투어러', blurb: '주말마다 꺼내는 차', price: 8 * 억 },
  { id: 'car-hyper', group: '슈퍼카', icon: 'car', name: '하이퍼카', blurb: '전 세계에 몇백 대뿐', price: 30 * 억 },
  { id: 'yacht', group: '요트', icon: 'yacht', name: '50m 슈퍼요트', blurb: '선원까지 딸린 배', price: 100 * 억 },
  { id: 'apt-gangnam', group: '아파트', icon: 'apartment', name: '강남 아파트', blurb: '한강이 보이는 한 채', price: 150 * 억 },
  { id: 'apt-hannam', group: '아파트', icon: 'apartment', name: '한남 펜트하우스', blurb: '꼭대기 층 통째로', price: 300 * 억 },
  { id: 'building', group: '빌딩', icon: 'building', name: '강남 사옥 빌딩', blurb: '내 이름을 건 건물', price: 1_000 * 억, headline: true },
  { id: 'jet', group: '전용기', icon: 'jet', name: '장거리 전용기', blurb: '서울에서 베가스까지 논스톱', price: 2_000 * 억, headline: true },
  { id: 'island', group: '섬', icon: 'island', name: '프라이빗 아일랜드', blurb: '지도에 내 이름이 붙는 섬', price: 5_000 * 억, headline: true, push: true },
  { id: 'casino', group: '카지노', icon: 'casino', name: '나만의 카지노', blurb: '이제 하우스는 나', price: 2 * 조, headline: true, push: true }
];

// Skins, one slot each, and the floor passes among them: lib/cosmetics.mjs.
export { SLOTS, COSMETICS, PASS_ITEMS };

const ITEMS = new Map([...LUXURY.map(x => [x.id, { ...x, kind: 'luxury' }]), ...COSMETICS.map(x => [x.id, { ...x, kind: 'cosmetic' }])]);
for (const x of ITEMS.values()) if (!isMoney(x.price) && x.price !== 0) throw new Error(`SHOP_PRICE_NOT_IN_UNITS:${x.id}`);

export const itemById = itemId => ITEMS.get(String(itemId || '')) || null;

function luxuryList(user) {
  if (!Array.isArray(user.luxury)) user.luxury = [];
  return user.luxury;
}
function cosmetics(user) {
  const c = user.cosmetics && typeof user.cosmetics === 'object' ? user.cosmetics : {};
  c.owned = Array.isArray(c.owned) ? c.owned : [];
  c.equipped = { cardBack: null, felt: null, chips: null, frame: null, ...(c.equipped || {}) };
  user.cosmetics = c;
  return c;
}

const achievementDone = (user, achievementId) => {
  const a = ACHIEVEMENTS.find(x => x.id === achievementId);
  return Boolean(a) && a.value(user) >= a.target;
};

// Whether `user` may wear a skin: free ones always, achievement ones once it is done, bought ones after buying.
export function ownsCosmetic(user, item) {
  if (!item || item.kind !== 'cosmetic') return false;
  if (item.price === 0 && !item.achievement) return true;
  if (item.achievement && achievementDone(user, item.achievement)) return true;
  return cosmetics(user).owned.includes(item.id);
}
export const ownsLuxury = (user, itemId) => luxuryList(user).some(x => x.id === itemId);

// Replays a buy or sell retried with the same idempotency key instead of running it twice.
const LOG_LIMIT = 20;
function shopCommand(user, key, kind, itemId, run) {
  const log = Array.isArray(user.shopLog) ? user.shopLog : (user.shopLog = []);
  if (key) {
    const seen = log.find(x => x.key === key);
    if (seen) {
      if (seen.kind !== kind || seen.itemId !== itemId) throw new Error('IDEMPOTENCY_CONFLICT');
      return { ...seen.result, replayed: true };
    }
  }
  const result = run();
  if (key) { log.push({ key, kind, itemId, result }); if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT); }
  return { ...result, replayed: false };
}

export function buyItem(state, user, itemId, { key = null } = {}) {
  const item = itemById(itemId);
  if (!item) throw new Error('ITEM_NOT_FOUND');
  return shopCommand(user, key, 'buy', item.id, () => {
    if (item.kind === 'luxury' ? ownsLuxury(user, item.id) : ownsCosmetic(user, item)) throw new Error('ITEM_ALREADY_OWNED');
    if (item.kind === 'cosmetic' && (item.achievement || item.price === 0)) throw new Error('ITEM_NOT_FOR_SALE');
    if (user.account.available < item.price) throw new Error('INSUFFICIENT_BANKROLL');
    const tx = addLedger(state, user, { type: 'PURCHASE', amount: -item.price, referenceType: 'SHOP', referenceId: item.id, metadata: { item: item.id, kind: item.kind, name: item.name } });
    const at = tx.createdAt;
    if (item.kind === 'luxury') {
      luxuryList(user).push({ id: item.id, price: item.price, boughtAt: at });
      if (item.headline) pushFeed(state, { type: 'LUXURY', actorId: user.id, item: item.id, name: item.name, amount: item.price, push: Boolean(item.push) });
    } else {
      const before = item.floor ? hasFloorPass(user, FLOORS.find(f => f.slug === item.floor)) : true;
      cosmetics(user).owned.push(item.id);
      if (!before) return { itemId: item.id, kind: item.kind, price: item.price, pass: item.floor };
    }
    return { itemId: item.id, kind: item.kind, price: item.price };
  });
}

// A luxury asset goes back to the house at SELL_RATE of what was paid for it.
export function sellItem(state, user, itemId, { key = null } = {}) {
  const item = itemById(itemId);
  if (!item) throw new Error('ITEM_NOT_FOUND');
  return shopCommand(user, key, 'sell', item.id, () => {
    if (item.kind !== 'luxury') throw new Error('ITEM_NOT_SELLABLE');
    const list = luxuryList(user), at = list.findIndex(x => x.id === item.id);
    if (at < 0) throw new Error('ITEM_NOT_OWNED');
    const [owned] = list.splice(at, 1);
    const amount = resaleOf(owned.price);
    addLedger(state, user, { type: 'RESALE', amount, referenceType: 'SHOP', referenceId: item.id, metadata: { item: item.id, kind: 'luxury', name: item.name, paid: owned.price, rate: SELL_RATE } });
    return { itemId: item.id, kind: 'luxury', amount };
  });
}

// Puts on a skin the player owns, or (itemId null) goes back to the house look for that slot.
export function equipItem(user, slot, itemId) {
  if (!SLOTS.includes(slot)) throw new Error('INVALID_SLOT');
  const c = cosmetics(user);
  if (itemId === null || itemId === undefined || itemId === '') { c.equipped[slot] = null; return { slot, itemId: null }; }
  const item = itemById(itemId);
  if (!item || item.kind !== 'cosmetic') throw new Error('ITEM_NOT_FOUND');
  if (item.slot !== slot) throw new Error('INVALID_SLOT');
  if (!ownsCosmetic(user, item)) throw new Error('ITEM_NOT_OWNED');
  c.equipped[slot] = item.house ? null : item.id;
  return { slot, itemId: c.equipped[slot] };
}

// What a player has on, for the client to apply: only skins they still own (an achievement
// skin stays on once earned, since achievements never undo).
export function equippedOf(user) {
  const c = cosmetics(user), out = {};
  for (const slot of SLOTS) { const item = itemById(c.equipped[slot]); out[slot] = item && ownsCosmetic(user, item) ? item.id : null; }
  return out;
}

// The shop for this player: every item with whether they own it, and their asset total.
export function shopView(user) {
  const owned = new Map(luxuryList(user).map(x => [x.id, x]));
  const equipped = equippedOf(user);
  const achievementLabel = id => ACHIEVEMENTS.find(a => a.id === id)?.label ?? null;
  return {
    sellRate: SELL_RATE,
    assets: luxuryValue(user),
    resale: luxuryList(user).reduce((t, x) => t + resaleOf(x.price), 0),
    luxury: LUXURY.map(x => {
      const mine = owned.get(x.id);
      return { id: x.id, group: x.group, icon: x.icon, name: x.name, blurb: x.blurb, price: x.price, headline: Boolean(x.headline), owned: Boolean(mine), boughtAt: mine?.boughtAt ?? null, paid: mine?.price ?? null, resale: mine ? resaleOf(mine.price) : resaleOf(x.price) };
    }),
    cosmetics: COSMETICS.map(x => {
      const item = itemById(x.id);
      return { id: x.id, slot: x.slot, name: x.name, blurb: x.blurb, price: x.price, house: Boolean(x.house), achievement: x.achievement ?? null, achievementLabel: x.achievement ? achievementLabel(x.achievement) : null, floor: x.floor ?? null, owned: ownsCosmetic(user, item), equipped: x.house ? equipped[x.slot] === null : equipped[x.slot] === x.id };
    }),
    // Each floor's pass: whether this player holds it, has reached the floor, and sits there now.
    passes: FLOORS.filter(f => PASS_ITEMS[f.slug]).map(f => ({ slug: f.slug, name: f.name, minBet: f.minBet, threshold: f.threshold, items: PASS_ITEMS[f.slug], passed: hasFloorPass(user, f), unlocked: user.account.unlockedFloors.includes(f.slug), open: floorOpen(user, f) })),
    equipped
  };
}
