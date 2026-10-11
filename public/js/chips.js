// Casino chips: denominations per stake tier, chip markup and stack decomposition.
import { el, formatCH } from './fx.js';

export const CHIP_COLORS = {
  5_000: 'blue', 25_000: 'ivory', 50_000: 'teal', 100_000: 'white', 250_000: 'red', 500_000: 'green',
  1_000_000: 'black', 2_500_000: 'purple', 5_000_000: 'orange',
  10_000_000: 'blue', 25_000_000: 'pink', 50_000_000: 'gold', 100_000_000: 'wine'
};

// Five denominations per table so a bet can be built in fine steps up to the limit.
export const TIERS = {
  low: { slug: 'low', name: 'Low', floor: 'downtown', floorName: 'Downtown', min: 100_000, max: 999_999, chips: [25_000, 50_000, 100_000, 250_000, 500_000] },
  mid: { slug: 'mid', name: 'Mid', floor: 'strip', floorName: 'The Strip', min: 1_000_000, max: 9_999_999, chips: [250_000, 500_000, 1_000_000, 2_500_000, 5_000_000] },
  high: { slug: 'high', name: 'High', floor: 'high-limit', floorName: 'High Limit', min: 10_000_000, max: 49_999_999, chips: [1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000] },
  vip: { slug: 'vip', name: 'Salon', floor: 'high-limit', floorName: 'High Limit', min: 50_000_000, max: 100_000_000, chips: [5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000] }
};

export function createChip(value, tag = 'span') {
  const chip = el(tag, `chip chip--${CHIP_COLORS[value] || 'white'}`);
  chip.dataset.value = value;
  chip.innerHTML = `<span class="chip-label">${formatCH(value)}</span>`;
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
