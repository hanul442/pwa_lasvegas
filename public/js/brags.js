// What each brag says: a new floor, a purchase, a tier, a rank. Every one becomes a VEGAS card
// and goes out through share.js with a link back to the app.
import { formatCH } from './fx.js';
import { brandCard, shareImage, bragName } from './share.js';

const QUOTES = {
  floor: ['“한 층 더 올라왔어요”', '“이제 여기가 내 자리”', '“엘리베이터 버튼 누르는 맛”'],
  buy: ['“돈은 이렇게 쓰는 거예요”', '“플렉스 했어요”', '“구경 오세요”'],
  tier: ['“이번 달은 내가 주인공”', '“딜러도 알아보는 얼굴”', '“다음 달에도 여기서 봐요”'],
  rank: ['“나 잡아 봐라”', '“여기가 내 자리”', '“다들 분발하세요”']
};
const pick = (list, seed) => list[Math.abs([...String(seed)].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % list.length];

export async function bragFloor(floor, nickname = bragName()) {
  const blob = await brandCard({ kicker: '새 층 입성 · NEW FLOOR', title: floor.name, big: `${formatCH(floor.minBet)}–${formatCH(floor.maxBet)}원 테이블`, quote: pick(QUOTES.floor, floor.slug), nickname });
  return shareImage({ blob, filename: 'vegas-floor.png', title: 'VEGAS 새 층', text: `VEGAS ${floor.name} 층에 올라왔어요 🏙️`, nickname });
}

export async function bragPurchase({ eyebrow = 'NEW ACQUISITION', title, line = '' }, nickname = bragName()) {
  const blob = await brandCard({ kicker: eyebrow, title, big: line, quote: pick(QUOTES.buy, title), nickname });
  return shareImage({ blob, filename: 'vegas-new.png', title: 'VEGAS 플렉스', text: `VEGAS에서 ${title} 샀어요 ✨${line ? ` (${line})` : ''}`, nickname });
}

// tier: the tier id; name: its Korean name; season: e.g. "2026년 10월"; rank/of when known.
export async function bragTier({ tier, name, season = '', rank = 0, of = 0, peak = 0, up = false }, nickname = bragName()) {
  const big = rank && of ? `${of}명 중 ${rank}위` : peak ? `최고 순자산 ${formatCH(peak)}원` : '';
  const blob = await brandCard({ kicker: `${season ? `${season} · ` : ''}${up ? '티어 승급' : '월간 티어'}`, title: name, big, quote: pick(QUOTES.tier, `${tier}${season}`), nickname, tier });
  return shareImage({ blob, filename: 'vegas-tier.png', title: 'VEGAS 티어', text: `VEGAS ${season ? `${season} ` : ''}${name} ${up ? '달성' : '티어'}! ${big} 🏆`.replace(/ {2,}/g, ' '), nickname });
}

// board: "월간 티어", "이번 주 수익" ...; value: already formatted.
export async function bragRank({ rank, board, value, tier = null }, nickname = bragName()) {
  const blob = await brandCard({ kicker: `VEGAS 랭킹 · ${board}`, title: `${rank}위`, big: value, quote: pick(QUOTES.rank, `${rank}${board}`), nickname, tier });
  return shareImage({ blob, filename: 'vegas-rank.png', title: 'VEGAS 랭킹', text: `VEGAS ${board} 랭킹 ${rank}위 (${value}) 🥇`, nickname });
}
