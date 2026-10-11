// Casino chips: denominations per stake tier, chip markup and stack decomposition.
import { el, formatCH } from './fx.js';

export const CHIP_COLORS = {
  10_000: 'white', 50_000: 'red', 100_000: 'blue', 250_000: 'green', 500_000: 'teal',
  1_000_000: 'black', 2_500_000: 'purple', 5_000_000: 'orange',
  10_000_000: 'blue', 25_000_000: 'pink', 50_000_000: 'gold', 100_000_000: 'wine',
  250_000_000: 'purple', 500_000_000: 'orange', 1_000_000_000: 'black',
  2_500_000_000: 'pink', 5_000_000_000: 'gold', 10_000_000_000: 'wine',
  50_000_000_000: 'teal', 100_000_000_000: 'ivory', 500_000_000_000: 'gold'
};

// Five denominations per table so a bet can be built in fine steps up to the limit.
// The smallest bet anywhere is 1만 원; The Vault goes up to 1조.
export const TIERS = {
  low: { slug: 'low', name: 'Low', floor: 'downtown', floorName: 'Downtown', min: 10_000, max: 999_999, chips: [10_000, 50_000, 100_000, 250_000, 500_000] },
  mid: { slug: 'mid', name: 'Mid', floor: 'strip', floorName: 'The Strip', min: 1_000_000, max: 9_999_999, chips: [100_000, 500_000, 1_000_000, 2_500_000, 5_000_000] },
  high: { slug: 'high', name: 'High', floor: 'high-limit', floorName: 'High Limit', min: 10_000_000, max: 99_999_999, chips: [1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000] },
  vip: { slug: 'vip', name: 'Salon', floor: 'salon-prive', floorName: 'Salon Privé', min: 100_000_000, max: 999_999_999, chips: [10_000_000, 50_000_000, 100_000_000, 250_000_000, 500_000_000] },
  royal: { slug: 'royal', name: 'Penthouse', floor: 'penthouse', floorName: 'Penthouse', min: 1_000_000_000, max: 9_999_999_999, chips: [100_000_000, 500_000_000, 1_000_000_000, 2_500_000_000, 5_000_000_000] },
  vault: { slug: 'vault', name: 'Vault', floor: 'vault', floorName: 'The Vault', min: 10_000_000_000, max: 1_000_000_000_000, chips: [1_000_000_000, 10_000_000_000, 50_000_000_000, 100_000_000_000, 500_000_000_000] }
};

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
