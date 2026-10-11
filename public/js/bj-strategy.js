// Blackjack basic strategy for this table's rules: six decks, dealer stands on soft 17, double on
// any two cards (also after a split), split up to six hands, no surrender. Pure, no DOM: the table
// uses it for the hint button and the server plays the AI seats with it.

const rankOf = c => (typeof c === 'string' ? c.slice(0, -1) : c?.r);
const pip = r => (r === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(r) ? 10 : Number(r));

export function handTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { const r = rankOf(c); if (r === 'A') aces++; total += pip(r); }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

// Dealer up card 2..11 (ace = 11).
const upValue = up => pip(rankOf(up));

// Pairs, by the rank's value: which dealer up cards to split against.
const SPLIT_VS = {
  11: () => true,
  10: () => false,
  9: d => d <= 9 && d !== 7,
  8: () => true,
  7: d => d <= 7,
  6: d => d <= 6,
  5: () => false,
  4: d => d === 5 || d === 6,
  3: d => d <= 7,
  2: d => d <= 7
};

// 'D' doubles when allowed and hits otherwise; 'Ds' doubles when allowed and stands otherwise.
function softPlay(total, d) {
  if (total >= 19) return 'S';
  if (total === 18) return d >= 3 && d <= 6 ? 'Ds' : d <= 8 ? 'S' : 'H';
  if (total === 17) return d >= 3 && d <= 6 ? 'D' : 'H';
  if (total >= 15) return d >= 4 && d <= 6 ? 'D' : 'H';
  if (total >= 13) return d === 5 || d === 6 ? 'D' : 'H';
  return 'H';
}
function hardPlay(total, d) {
  if (total >= 17) return 'S';
  if (total >= 13) return d <= 6 ? 'S' : 'H';
  if (total === 12) return d >= 4 && d <= 6 ? 'S' : 'H';
  if (total === 11) return d <= 10 ? 'D' : 'H';
  if (total === 10) return d <= 9 ? 'D' : 'H';
  if (total === 9) return d >= 3 && d <= 6 ? 'D' : 'H';
  return 'H';
}

// cards: the hand ('A♠' strings or {r, s}); up: the dealer's up card.
// Returns 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT'.
export function basicStrategy(cards, up, { canDouble = true, canSplit = true } = {}) {
  const d = upValue(up);
  if (canSplit && cards.length === 2) {
    const [a, b] = cards.map(c => pip(rankOf(c)));
    if (a === b && SPLIT_VS[a]?.(d)) return 'SPLIT';
  }
  const { total, soft } = handTotal(cards);
  const play = soft ? softPlay(total, d) : hardPlay(total, d);
  const double = canDouble && cards.length === 2;
  if (play === 'D') return double ? 'DOUBLE' : 'HIT';
  if (play === 'Ds') return double ? 'DOUBLE' : 'STAND';
  return play === 'S' ? 'STAND' : 'HIT';
}
