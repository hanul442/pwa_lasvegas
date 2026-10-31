// 꾸미기 catalog, kept apart from the shop so the floor rules (lib/state.mjs) can read it.
// Every floor above the Gold Room has its own set of skins (한서's call): owning any one of them
// is that floor's pass, so a player climbs by net worth AND by buying into the next floor's look.
// Prices scale with the floor's smallest bet: the felt (the cheapest pass) costs one bet, the card
// back and nameplate one and a half, the chips three (한서 2026-10-17: raised from 0.6–1.5×). A
// floor opens at UNLOCK_MULTIPLE (3) bets of net worth, so the cheapest pass still leaves two to play.
import { FLOORS, roundMoney } from './constants.mjs';

const M = slug => FLOORS.find(f => f.slug === slug).minBet;
// Prices land on clean steps (2026-10-31 금액 전수 점검): 1천만·1500만·2천만·2500만·3천만·4천만·5천만…
// instead of what the multipliers made (2300만, 6800만, 9900만, 9억 9천만, 67억 5천만).
const STEPS = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];
export function cleanPrice(x) {
  if (!(x > 0)) return 0;
  const p = 10 ** (Math.floor(Math.log10(x)) - 1), m = x / p;
  const step = STEPS.reduce((best, k) => (Math.abs(k - m) < Math.abs(best - m) || (Math.abs(k - m) === Math.abs(best - m) && k > best) ? k : best), STEPS[0]);
  return roundMoney(step * p);
}

export const SLOTS = ['cardBack', 'felt', 'chips', 'frame'];

// price 0 is everyone's from the start; `achievement` unlocks one for free once done; `house` is
// the look an empty slot shows, so wearing it simply empties the slot. `floor`: the floor this
// skin is a pass for.
const set = (floor, items) => items.map(([id, slot, name, blurb, times]) => ({ id, slot, name, blurb, price: cleanPrice(times * M(floor) / 2), floor }));

// More looks per floor (2026-10-30, 한서 "상품 더 많이 넣고 층별로"): the floor's motif in two more
// finishes, drawn by scripts/draw-skins.mjs: 누아르 (black lacquer and the floor's metal, 1.5× the
// price) and 아이보리 (ivory stock in the floor's dark ink, 2.2×). The Gold Room (홀) gets a set of
// its own here too; it opens no floor, since the Gold Room is open to all.
const LOOKS = [
  // key, floor, word, motif, metal, [felt names: classic?, noir, ivory]
  ['hall', 'gold-room', '홀', '하우스 별', '은빛', ['하우스 그린', '그래파이트', '로열 블루']],
  ['club', 'high-limit', '클럽', '스페이드와 아가일', '은빛', [null, '그래파이트 그린', '버건디']],
  ['salon', 'salon-prive', '살롱', '아르데코 부채', '진주빛', [null, '미드나잇 슬레이트', '스톤 그레이']],
  ['penthouse', 'penthouse', '펜트하우스', '열쇠와 헤링본', '대리석빛', [null, '모카', '올리브']],
  ['sky', 'sky-lounge', '스카이', '초승달과 별', '백금빛', [null, '딥 네이비', '더스크 퍼플']],
  ['vault', 'vault', '볼트', '금고 다이얼', '강철빛', [null, '건메탈', '블랙 그린']],
  ['crown', 'crown', '크라운', '왕관', '샴페인빛', [null, '블랙 벨벳', '크라운 버건디']],
  ['olympus', 'olympus', '올림푸스', '월계관과 그리스 문양', '대리석빛', [null, '마블 그레이', '에게해']]
];
const BASE_TIMES = { felt: 2, cardBack: 3, frame: 3, chips: 6 };
function floorLooks() {
  const out = [];
  for (const [key, floor, word, motif, metal, felts] of LOOKS) {
    const ways = [
      ...(felts[0] ? [['classic', 1, {
        cardBack: [`${word} 클래식`, `그린 래커에 ${metal} 박으로 새긴 ${motif}`],
        felt: [felts[0], `${felts[0]} 펠트에 ${motif} 문양`],
        chips: [`${word} 클래식 라인`, `열두 개 인서트에 ${metal} 링`],
        frame: [`${word} 명패`, `그린 래커 각인판에 ${motif}`]
      }]] : []),
      ['noir', 1.5, {
        cardBack: [`${word} 누아르`, `검은 래커에 ${metal} 박으로 새긴 ${motif}`],
        felt: [felts[1], `${felts[1]} 펠트에 ${motif} 문양`],
        chips: [`${word} 누아르 라인`, `검은 인서트에 ${metal} 링`],
        frame: [`${word} 메탈 명패`, `${metal} 금속판에 이름을 새긴 명패`]
      }],
      ['ivory', 2.2, {
        cardBack: [`${word} 아이보리`, `아이보리 바탕에 짙은 잉크로 새긴 ${motif}`],
        felt: [felts[2], `${felts[2]} 펠트에 ${motif} 문양`],
        chips: [`${word} 아이보리 라인`, '아이보리 인서트와 아이보리 링'],
        frame: [`${word} 누아르 명패`, `검은 래커에 ${metal} 이중 테`]
      }]
    ];
    for (const [way, k, names] of ways) for (const slot of SLOTS) {
      const prefix = slot === 'cardBack' ? 'back' : slot;
      out.push({ id: `${prefix}-${key}-${way}`, slot, name: names[slot][0], blurb: names[slot][1], price: cleanPrice(BASE_TIMES[slot] * k * M(floor) / 2), floor });
    }
  }
  return out;
}

export const COSMETICS = [
  { id: 'back-lacquer', slot: 'cardBack', name: '블랙 래커', blurb: '하우스 기본 뒷면', price: 0, house: true },
  { id: 'back-ivory', slot: 'cardBack', name: '아이보리', blurb: '아이보리 바탕에 검은 선으로 새긴 별', price: 0, achievement: 'first-win' },
  { id: 'back-grid', slot: 'cardBack', name: '그리드', blurb: '은빛 격자에 마름모 메달', price: 0, achievement: 'streak-10' },
  { id: 'felt-house', slot: 'felt', name: '게임별 기본', blurb: '테이블마다 원래 펠트', price: 0, house: true },
  { id: 'felt-charcoal', slot: 'felt', name: '차콜', blurb: '숯빛 펠트', price: 0, achievement: 'floor-penthouse' },
  { id: 'chips-classic', slot: 'chips', name: '실버 라인', blurb: '하우스 기본 칩', price: 0, house: true },
  { id: 'chips-ivory', slot: 'chips', name: '아이보리 라인', blurb: '또렷한 흰 테두리', price: 0, achievement: 'wins-50' },
  { id: 'frame-plain', slot: 'frame', name: '이름만', blurb: '테두리 없는 이름', price: 0, house: true },
  { id: 'frame-jokbo', slot: 'frame', name: '족보 명패', blurb: '족보 도감 절반, 화투 한 장이 박힌 테두리', price: 0, achievement: 'jokbo-half' },
  { id: 'frame-attend', slot: 'frame', name: '개근 명패', blurb: '오늘의 미션 7일 연속, 일곱 칸 도장이 찍힌 테두리', price: 0, achievement: 'mission-week' },
  { id: 'frame-jokbo-master', slot: 'frame', name: '족보 마스터 명패', blurb: '족보 도감 완성, 광과 별이 함께 빛나는 테두리', price: 0, achievement: 'jokbo-all' },
  ...set('high-limit', [
    ['felt-forest', 'felt', '딥 그린', '숲색 펠트에 은은한 아가일과 스페이드', 2],
    ['back-oxblood', 'cardBack', '옥스블러드', '와인색 래커에 은선 아가일, 스페이드 메달', 3],
    ['frame-silver', 'frame', '실버 명패', '은빛 테를 두른 각인판에 스페이드', 3],
    ['chips-onyx', 'chips', '오닉스 라인', '넓은 인서트 넷에 가는 줄이 든 은빛 테두리', 6]
  ]),
  ...set('salon-prive', [
    ['felt-navy', 'felt', '네이비', '남색 펠트에 아르데코 물결 비늘', 2],
    ['back-navy', 'cardBack', '미드나잇 네이비', '남색 래커에 진주빛 부채 문양', 3],
    ['frame-pearl', 'frame', '펄 명패', '진주빛 각인판에 아르데코 부채', 3],
    ['chips-double', 'chips', '더블 라인', '세 줄 인서트와 진주 구슬 링', 6]
  ]),
  ...set('penthouse', [
    ['felt-oxblood', 'felt', '옥스블러드', '와인색 펠트에 헤링본 짜임', 2],
    ['back-pinstripe', 'cardBack', '핀스트라이프', '차콜 래커에 헤링본, 펜트하우스 열쇠', 3],
    ['frame-onyx', 'frame', '오닉스 명패', '흑단 각인판에 열쇠', 3],
    ['chips-marble', 'chips', '마블 라인', '대리석빛 넓은 인서트와 가는 링', 6]
  ]),
  ...set('sky-lounge', [
    ['felt-teal', 'felt', '피콕 틸', '공작빛 펠트에 흩어진 별', 2],
    ['back-skyline', 'cardBack', '스카이라인', '별밤 아래 스트립 야경과 초승달', 3],
    ['frame-platinum', 'frame', '플래티넘 명패', '백금 각인판에 초승달', 3],
    ['chips-platinum', 'chips', '플래티넘 라인', '열두 개 백금 인서트', 6]
  ]),
  ...set('vault', [
    ['felt-obsidian', 'felt', '옵시디언', '흑요석 펠트에 기요셰 원 문양', 2],
    ['back-vault', 'cardBack', '볼트 다이얼', '방사선 기요셰 위 금고 다이얼', 3],
    ['frame-diamond', 'frame', '블랙 다이아 명패', '강철 각인판에 금고 다이얼', 3],
    ['chips-diamond', 'chips', '다이아 라인', '촘촘한 눈금 인서트와 눈금 링', 6]
  ]),
  ...set('crown', [
    ['felt-royal', 'felt', '로열 퍼플', '보랏빛 펠트에 왕관 격자', 2],
    ['back-crown', 'cardBack', '크라운', '가지색 래커에 샴페인빛 기요셰와 왕관', 3],
    ['frame-crown', 'frame', '크라운 명패', '샴페인빛 각인판에 왕관', 3],
    ['chips-crown', 'chips', '크라운 라인', '쌍줄 케인 인서트와 구슬 링', 6]
  ]),
  ...set('olympus', [
    ['felt-ultramarine', 'felt', '울트라마린', '청금석 펠트에 그리스 문양 띠', 2],
    ['back-olympus', 'cardBack', '올림푸스', '기둥 홈과 그리스 문양, 월계관 메달', 3],
    ['frame-olympus', 'frame', '올림푸스 명패', '대리석빛 각인판에 월계관', 3],
    ['chips-olympus', 'chips', '올림푸스 라인', '대리석빛 인서트와 가는 링', 6]
  ]),
  ...floorLooks()
];

// 시즌 한정 꾸미기 (2026-10-29, 한서 "돈을 더 쓰게"): each season sells its own set of four, only
// while that season runs; afterwards it is never sold again, and whoever bought it keeps it. They
// open no floor. A season with no set here sells none; add the next ones before they start.
const 억 = 100_000_000;
export const SEASON_PRICES = { felt: 100 * 억, cardBack: 200 * 억, frame: 300 * 억, chips: 500 * 억 };
const seasonSet = (season, key, name, blurbs) => [
  ['felt', `felt-${key}`, `${name} 펠트`, blurbs[0]],
  ['cardBack', `back-${key}`, `${name} 뒷면`, blurbs[1]],
  ['frame', `frame-${key}`, `${name} 명패`, blurbs[2]],
  ['chips', `chips-${key}`, `${name} 라인`, blurbs[3]]
].map(([slot, id, n, blurb]) => ({ id, slot, name: n, blurb, price: SEASON_PRICES[slot], season }));
export const SEASON_COSMETICS = [
  ...seasonSet('rank-2026-10', 'ember', '엠버', ['불씨빛 펠트에 작은 불꽃 문양', '숯빛 래커에 물결 기요셰와 불꽃 메달', '불씨빛 각인판에 불꽃', '쌍줄 케인 인서트에 주황 링']),
  ...seasonSet('rank-2026-12', 'frost', '프로스트', ['얼음빛 펠트에 눈꽃 문양', '남청 래커에 육각 얼음 결과 눈꽃 메달', '서리빛 각인판에 눈꽃', '열두 개 얼음빛 인서트와 눈금 링']),
  ...seasonSet('rank-2027-01', 'crimson', '크림슨', ['진홍 펠트에 별 문양', '진홍 래커에 아가일과 별 메달', '진홍 각인판에 별', '넓은 인서트 넷에 진홍 구슬 링']),
  ...seasonSet('rank-2027-02', 'rose', '로즈', ['장밋빛 펠트에 장미 문양', '장밋빛 래커에 점묘와 장미 메달', '장밋빛 각인판에 장미', '세 줄 인서트와 장밋빛 구슬 링']),
  ...seasonSet('rank-2027-03', 'sage', '세이지', ['세이지 펠트에 잎 문양', '세이지 래커에 헤링본과 잎 메달', '세이지 각인판에 잎', '넓은 인서트와 연둣빛 링']),
  ...seasonSet('rank-2027-04', 'lilac', '라일락', ['라일락 펠트에 꽃 문양', '라일락 래커에 비늘 물결과 꽃 메달', '라일락 각인판에 꽃', '쌍줄 케인 인서트에 연보라 링'])
];
COSMETICS.push(...SEASON_COSMETICS);

// The skins that open each floor, by floor slug.
export const PASS_ITEMS = Object.fromEntries(FLOORS.slice(1).map(f => [f.slug, COSMETICS.filter(x => x.floor === f.slug).map(x => x.id)]));
const PASS_FLOOR = new Map(COSMETICS.filter(x => x.floor && x.floor !== FLOORS[0].slug).map(x => [x.id, x.floor]));
export const passFloorOf = itemId => PASS_FLOOR.get(itemId) ?? null;
