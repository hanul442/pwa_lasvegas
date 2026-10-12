// Casino chips: denominations per stake tier, chip markup and stack decomposition.
import { el, formatCH } from './fx.js';

// Each table has four round chips: 1, 2, 5 and 10 times its smallest bet (1억·2억·5억·10억,
// 한서's call: no 3억 or 7억). The table's colours go up with the floor, so a glance at the rack
// says where you are sitting.
const STEPS = [1, 2, 5, 10];
// One colour per chip value from 100만 to 1조, rising through the floors. A table's 10× chip is
// the next table's 1× chip, so the two share a colour and no rack repeats one.
const COLORS = 'teal purple wine ivory pink gold black wine ivory teal gold pink black ivory wine gold wine black ivory'.split(' ');
// A table is a floor: same slug, same name. Its range runs from the smallest bet to ten times it.
// Higher floors play harder (lib/constants.mjs DIFFICULTY_STARS, H17_FROM_LEVEL): sharper AI, and
// from the Penthouse up the blackjack dealer hits soft 17.
const STARS = [1, 2, 3, 4, 5, 5];
const tier = (slug, name, min, level) => ({ slug, name, floor: slug, floorName: name, min, max: min * 10, chips: STEPS.map(k => k * min), level, stars: STARS[level], h17: level >= 3 });

// Six floors from 100만 in the Gold Room to 1천억 in The Vault, each ten times the last
// (lib/constants.mjs FLOORS). A floor opens at ten of its smallest bets in net worth and
// closes to anyone worth more than a hundred of them.
export const TIERS = Object.fromEntries([
  ['gold-room', 'Gold Room', 1_000_000],
  ['high-limit', 'High Limit', 10_000_000],
  ['salon-prive', 'Salon Privé', 100_000_000],
  ['penthouse', 'Penthouse', 1_000_000_000],
  ['sky-lounge', 'Sky Lounge', 10_000_000_000],
  ['vault', 'The Vault', 100_000_000_000]
].map(([slug, name, min], i) => [slug, tier(slug, name, min, i)]));

// The cheapest table in the casino.
export const FIRST_TIER = Object.values(TIERS)[0];

export const CHIP_COLORS = Object.fromEntries(Object.values(TIERS).flatMap((t, i) => t.chips.map((v, k) => [v, COLORS[i * 3 + k]])));

// Big money is played with plaques, the rectangular pearl tiles of a high-roller table (the
// Casino Royale look): every value from 1억 up, so Salon Privé and the floors above it bet
// with plaques while the tables below keep round chips.
export const PLAQUE_MIN = 100_000_000;
export const isPlaque = value => value >= PLAQUE_MIN;

export function createChip(value, tag = 'span') {
  const chip = el(tag, `chip chip--${CHIP_COLORS[value] || 'white'}${isPlaque(value) ? ' chip--plaque' : ''}`);
  chip.dataset.value = value;
  const label = formatCH(value);
  // Long Korean amounts (2500만) get a smaller face so they stay inside the inlay.
  // Width is weighed by glyph: Korean units are wide, commas narrow.
  const width = [...label].reduce((n, c) => n + (/[가-힣]/.test(c) ? 1.6 : c === ',' ? 0.4 : 1), 0);
  const face = `<span class="chip-label${width > 4 ? ' chip-label--long' : ''}">${label}</span>`;
  // Discs carry a printed dash ring around the inlay; plaques carry the house mark and a serial
  // number, like the numbered plaques of a real high-limit room. Both are decoration only.
  chip.innerHTML = isPlaque(value)
    ? `<i class="chip-mark" aria-hidden="true">VEGAS</i>${face}<i class="chip-serial" aria-hidden="true">№ ${String(Math.round(value / PLAQUE_MIN)).padStart(5, '0')}</i>`
    : `<i class="chip-ring" aria-hidden="true"></i>${face}`;
  return chip;
}

// Greedy breakdown of an amount into the tier's chips, capped so stacks stay readable.
export function breakdown(amount, denoms, cap = 10) {
  const sorted = [...denoms].sort((a, b) => b - a);
  const out = [];
  let rest = amount;
  for (const d of sorted) while (rest >= d && out.length < cap) { out.push(d); rest -= d; }
  if (!out.length && amount > 0) out.push(sorted[sorted.length - 1]);
  return out;
}

// How a balance sits in front of a player as the table's chips: mostly the biggest chip, with
// a few of each smaller one broken out for change, as a cashier would hand it over. Returns a
// count per chip in the order given (smallest first). Anything under the smallest chip is loose.
const CHANGE = [4, 3, 3];
export function holding(amount, chips) {
  const counts = chips.map(() => 0);
  let rest = Math.max(0, Math.floor(amount));
  for (let k = chips.length - 1; k >= 0; k--) { counts[k] = Math.floor(rest / chips[k]); rest -= counts[k] * chips[k]; }
  // Break bigger chips into smaller ones until each smaller chip has a little change.
  for (let k = chips.length - 1; k > 0; k--) {
    while (counts[k] > 0 && counts[k - 1] < (CHANGE[k - 1] ?? 3)) {
      counts[k]--;
      let left = chips[k];
      for (let j = k - 1; j >= 0 && left > 0; j--) { const n = Math.floor(left / chips[j]); counts[j] += n; left -= n * chips[j]; }
    }
  }
  return counts;
}
