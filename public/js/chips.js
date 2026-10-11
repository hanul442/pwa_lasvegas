// Casino chips: denominations per stake tier, chip markup and stack decomposition.
import { el, formatCH } from './fx.js';

// Each table has five chips: 1, 2, 3, 5 and 7 times its smallest bet. The table's colours go
// up with the floor, so a glance at the rack says where you are sitting.
const STEPS = [1, 2, 3, 5, 7];
const PALETTES = {
  low: ['white', 'red', 'blue', 'green', 'black'],
  mid: ['black', 'purple', 'orange', 'teal', 'pink'],
  high: ['gold', 'wine', 'purple', 'blue', 'black'],
  vip: ['pink', 'gold', 'wine', 'teal', 'ivory'],
  royal: ['teal', 'ivory', 'gold', 'wine', 'purple'],
  vault: ['gold', 'black', 'wine', 'ivory', 'pink']
};
const tier = (slug, name, floor, floorName, min) => ({ slug, name, floor, floorName, min, max: min * 10 - 1, chips: STEPS.map(k => k * min) });

// The smallest bet anywhere is 1천만 원; each floor up is ten times the last, to 10조 at The Vault.
export const TIERS = {
  low: tier('low', 'Low', 'downtown', 'Downtown', 10_000_000),
  mid: tier('mid', 'Mid', 'strip', 'The Strip', 100_000_000),
  high: tier('high', 'High', 'high-limit', 'High Limit', 1_000_000_000),
  vip: tier('vip', 'Salon', 'salon-prive', 'Salon Privé', 10_000_000_000),
  royal: tier('royal', 'Penthouse', 'penthouse', 'Penthouse', 100_000_000_000),
  vault: { ...tier('vault', 'Vault', 'vault', 'The Vault', 1_000_000_000_000), max: 10_000_000_000_000 }
};

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
