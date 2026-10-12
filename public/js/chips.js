// Casino chips: denominations per stake tier, chip markup and stack decomposition.
import { el, formatCH } from './fx.js';

// Each table has four round chips: 1, 2, 5 and 10 times its smallest bet (1억·2억·5억·10억,
// 한서's call: no 3억 or 7억). The table's colours go up with the floor, so a glance at the rack
// says where you are sitting.
const STEPS = [1, 2, 5, 10];
// One colour per chip value from 10원 to 1조, rising through the floors. A table's 10× chip is
// the next table's 1× chip, so the two share a colour and no rack repeats one.
const COLORS = ('white red blue green black purple orange teal pink gold wine ivory black red gold teal purple wine '
  + 'ivory pink gold black wine ivory teal gold pink black ivory wine gold wine black ivory').split(' ');
// A table is a floor: same slug, same name. Its range runs from the smallest bet to ten times it.
const tier = (slug, name, min) => ({ slug, name, floor: slug, floorName: name, min, max: min * 10, chips: STEPS.map(k => k * min) });

// Eleven floors from 10원 at The Corner to 1천억 in The Vault, each ten times the last
// (lib/constants.mjs FLOORS). A floor opens at ten of its smallest bets in net worth and
// closes to anyone worth a thousand of them.
export const TIERS = Object.fromEntries([
  ['corner', 'The Corner', 10],
  ['main-street', 'Main Street', 100],
  ['house', 'The House', 1_000],
  ['downtown', 'Downtown', 10_000],
  ['strip', 'The Strip', 100_000],
  ['gold-room', 'Gold Room', 1_000_000],
  ['high-limit', 'High Limit', 10_000_000],
  ['salon-prive', 'Salon Privé', 100_000_000],
  ['penthouse', 'Penthouse', 1_000_000_000],
  ['sky-lounge', 'Sky Lounge', 10_000_000_000],
  ['vault', 'The Vault', 100_000_000_000]
].map(([slug, name, min]) => [slug, tier(slug, name, min)]));

export const CHIP_COLORS = Object.fromEntries(Object.values(TIERS).flatMap((t, i) => t.chips.map((v, k) => [v, COLORS[i * 3 + k]])));

export function createChip(value, tag = 'span') {
  const chip = el(tag, `chip chip--${CHIP_COLORS[value] || 'white'}`);
  chip.dataset.value = value;
  const label = formatCH(value);
  // Long Korean amounts (2500만) get a smaller face so they stay inside the inlay.
  chip.innerHTML = `<span class="chip-label${label.length > 4 ? ' chip-label--long' : ''}">${label}</span>`;
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
