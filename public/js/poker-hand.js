// The name of the best hand in a set of face-up cards ("A♠", "10♥"…), for showing a player what
// they hold as the board comes out. Same categories as the server (lib/holdem.mjs evaluate).
const VALUE = { J: 11, Q: 12, K: 13, A: 14 };
export const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

const hasStraight = values => {
  const v = new Set(values);
  if (v.has(14)) v.add(1);
  for (let hi = 14; hi >= 5; hi--) if ([0, 1, 2, 3, 4].every(k => v.has(hi - k))) return true;
  return false;
};

export function handCategory(cards) {
  const parsed = cards.map(c => /^(10|[2-9JQKA])(.)$/.exec(c)).filter(Boolean).map(([, r, s]) => ({ v: VALUE[r] || Number(r), s }));
  if (!parsed.length) return null;
  const counts = new Map(), suits = new Map();
  for (const c of parsed) { counts.set(c.v, (counts.get(c.v) || 0) + 1); suits.set(c.s, [...(suits.get(c.s) || []), c.v]); }
  const groups = [...counts.values()].sort((a, b) => b - a);
  const flush = [...suits.values()].find(vs => vs.length >= 5);
  if (flush && hasStraight(flush)) return 8;
  if (groups[0] === 4) return 7;
  if (groups[0] === 3 && groups[1] >= 2) return 6;
  if (flush) return 5;
  if (hasStraight([...counts.keys()])) return 4;
  if (groups[0] === 3) return 3;
  if (groups[0] === 2 && groups[1] === 2) return 2;
  if (groups[0] === 2) return 1;
  return 0;
}
export const handName = cards => { const cat = handCategory(cards); return cat === null ? '' : HAND_NAMES[cat]; };
