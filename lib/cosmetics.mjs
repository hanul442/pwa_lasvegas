// 꾸미기 catalog, kept apart from the shop so the floor rules (lib/state.mjs) can read it.
// Every floor above the Gold Room has its own set of skins (한서's call): owning any one of them
// is that floor's pass, so a player climbs by net worth AND by buying into the next floor's look.
// Prices scale with what opening the floor takes (UNLOCK_MULTIPLE smallest bets): a pass costs a
// fifth to half of that, 0.6–1.5× the floor's smallest bet now that floors open at three of them.
import { FLOORS, UNLOCK_MULTIPLE, roundMoney } from './constants.mjs';

const M = slug => FLOORS.find(f => f.slug === slug).minBet;

export const SLOTS = ['cardBack', 'felt', 'chips', 'frame'];

// price 0 is everyone's from the start; `achievement` unlocks one for free once done; `house` is
// the look an empty slot shows, so wearing it simply empties the slot. `floor`: the floor this
// skin is a pass for.
const set = (floor, items) => items.map(([id, slot, name, blurb, times]) => ({ id, slot, name, blurb, price: roundMoney(times * M(floor) * UNLOCK_MULTIPLE / 10), floor }));
export const COSMETICS = [
  { id: 'back-lacquer', slot: 'cardBack', name: '블랙 래커', blurb: '하우스 기본 뒷면', price: 0, house: true },
  { id: 'back-ivory', slot: 'cardBack', name: '아이보리', blurb: '흰 바탕에 검은 별', price: 0, achievement: 'first-win' },
  { id: 'back-grid', slot: 'cardBack', name: '그리드', blurb: '촘촘한 흰 격자', price: 0, achievement: 'streak-10' },
  { id: 'felt-house', slot: 'felt', name: '게임별 기본', blurb: '테이블마다 원래 펠트', price: 0, house: true },
  { id: 'felt-charcoal', slot: 'felt', name: '차콜', blurb: '숯빛 펠트', price: 0, achievement: 'floor-penthouse' },
  { id: 'chips-classic', slot: 'chips', name: '실버 라인', blurb: '하우스 기본 칩', price: 0, house: true },
  { id: 'chips-ivory', slot: 'chips', name: '아이보리 라인', blurb: '또렷한 흰 테두리', price: 0, achievement: 'wins-50' },
  { id: 'frame-plain', slot: 'frame', name: '이름만', blurb: '테두리 없는 이름', price: 0, house: true },
  ...set('high-limit', [
    ['felt-forest', 'felt', '딥 그린', '짙은 숲색 펠트', 2],
    ['back-oxblood', 'cardBack', '옥스블러드', '짙은 와인색 래커', 3],
    ['frame-silver', 'frame', '실버 명패', '가는 은색 테두리', 3],
    ['chips-onyx', 'chips', '오닉스 라인', '검은 테두리', 5]
  ]),
  ...set('salon-prive', [
    ['felt-navy', 'felt', '네이비', '남색 펠트', 2],
    ['back-navy', 'cardBack', '미드나잇 네이비', '깊은 남색 래커', 3],
    ['frame-pearl', 'frame', '펄 명패', '진주빛 이중 테두리', 3],
    ['chips-double', 'chips', '더블 라인', '두 겹 은테', 5]
  ]),
  ...set('penthouse', [
    ['felt-oxblood', 'felt', '옥스블러드', '와인색 펠트', 2],
    ['back-pinstripe', 'cardBack', '핀스트라이프', '차콜에 가는 세로줄', 3],
    ['frame-onyx', 'frame', '오닉스 명패', '검은 래커에 은 모서리', 3],
    ['chips-marble', 'chips', '마블 라인', '따뜻한 대리석빛 테두리', 5]
  ]),
  ...set('sky-lounge', [
    ['felt-teal', 'felt', '피콕 틸', '공작 깃털빛 펠트', 2],
    ['back-skyline', 'cardBack', '스카이라인', '밤의 스트립 실루엣', 3],
    ['frame-platinum', 'frame', '플래티넘 명패', '빛이 흐르는 백금 테두리', 3],
    ['chips-platinum', 'chips', '플래티넘 라인', '굵은 백금 테두리', 5]
  ]),
  ...set('vault', [
    ['felt-obsidian', 'felt', '옵시디언', '빛을 머금은 흑요석 펠트', 2],
    ['back-vault', 'cardBack', '볼트 다이얼', '금고 다이얼 문양', 3],
    ['frame-diamond', 'frame', '블랙 다이아 명패', '반짝이는 별이 박힌 테두리', 3],
    ['chips-diamond', 'chips', '다이아 라인', '빛나는 흰 테두리', 5]
  ])
];

// The skins that open each floor, by floor slug.
export const PASS_ITEMS = Object.fromEntries(FLOORS.slice(1).map(f => [f.slug, COSMETICS.filter(x => x.floor === f.slug).map(x => x.id)]));
const PASS_FLOOR = new Map(COSMETICS.filter(x => x.floor).map(x => [x.id, x.floor]));
export const passFloorOf = itemId => PASS_FLOOR.get(itemId) ?? null;
