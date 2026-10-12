// Casino chips: denominations per stake tier, chip markup and stack decomposition.
import { el, formatCH } from './fx.js';

// Each table has five chips: 1, 2, 3, 5 and 7 times its smallest bet. The table's colours go
// up with the floor, so a glance at the rack says where you are sitting.
const STEPS = [1, 2, 3, 5, 7];
const PALETTES = {
  corner: ['white', 'red', 'blue', 'green', 'black'],
  'main-street': ['red', 'blue', 'green', 'black', 'purple'],
  house: ['blue', 'green', 'black', 'purple', 'orange'],
  downtown: ['green', 'black', 'purple', 'orange', 'teal'],
  strip: ['black', 'purple', 'orange', 'teal', 'pink'],
  'gold-room': ['purple', 'orange', 'teal', 'pink', 'gold'],
  'high-limit': ['gold', 'wine', 'purple', 'blue', 'black'],
  'salon-prive': ['pink', 'gold', 'wine', 'teal', 'ivory'],
  penthouse: ['teal', 'ivory', 'gold', 'wine', 'purple'],
  'sky-lounge': ['ivory', 'wine', 'black', 'gold', 'teal'],
  vault: ['gold', 'black', 'wine', 'ivory', 'pink']
};
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

export const CHIP_COLORS = Object.fromEntries(Object.entries(TIERS).flatMap(([slug, t]) => t.chips.map((v, k) => [v, PALETTES[slug][k]])));

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
