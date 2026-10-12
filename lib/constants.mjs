// New players start with nothing: the first chips come from the bank (lib/bank.mjs) or a handout.
export const INITIAL_BANKROLL = 0;
export const RECHARGE_TARGET = 50_000_000;
export const RECHARGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const DAILY_RECHARGE_LIMIT = 3;
export const CHICKEN_PRICE = 25_000;

// Six floors, each ten times the one below: from 100만 in the Gold Room to 1천억 in The Vault
// (한서 dropped every table under 100만). A floor opens once a player's net worth (chips minus
// debt) reaches ten of its smallest bets, and closes to anyone worth more than a hundred of
// them, so high rollers stay off the cheap tables.
const FLOOR_LIST = [
  ['gold-room', 'Gold Room', 1_000_000],
  ['high-limit', 'High Limit', 10_000_000],
  ['salon-prive', 'Salon Privé', 100_000_000],
  ['penthouse', 'Penthouse', 1_000_000_000],
  ['sky-lounge', 'Sky Lounge', 10_000_000_000],
  ['vault', 'The Vault', 100_000_000_000]
];
export const UNLOCK_MULTIPLE = 10;
export const CEILING_MULTIPLE = 100;

// A bet belongs to the tier whose range holds it; a floor takes its own tier and the next one's
// smallest bet, so its table maximum is ten times its minimum.
export const STAKE_TIERS = FLOOR_LIST.map(([slug, name, min], i) => ({
  slug, name, minBet: min, maxBet: i === FLOOR_LIST.length - 1 ? min * 10 : min * 10 - 1
}));

export function stakeTierFor(stake) {
  if (!Number.isSafeInteger(stake) || stake <= 0) return null;
  return STAKE_TIERS.find(tier => stake >= tier.minBet && stake <= tier.maxBet) ?? null;
}

export const FLOORS = FLOOR_LIST.map(([slug, name, min], i) => ({
  slug, name, minBet: min, maxBet: min * 10,
  threshold: i === 0 ? 0 : min * UNLOCK_MULTIPLE,
  ceiling: i === FLOOR_LIST.length - 1 ? null : min * CEILING_MULTIPLE,
  stakeTiers: [slug, FLOOR_LIST[i + 1]?.[0]].filter(Boolean)
}));

export const REFERENCE_PRICES = [
  { slug: 'coffee', name: '커피', emoji: '☕', price: 5_000 },
  { slug: 'chicken', name: '치킨', emoji: '🍗', price: 25_000 },
  { slug: 'laptop', name: '노트북', emoji: '💻', price: 2_000_000 },
  { slug: 'car', name: '4천만원 자동차', emoji: '🚗', price: 40_000_000 },
  { slug: 'supercar', name: '3억원 슈퍼카', emoji: '🏎️', price: 300_000_000 },
  { slug: 'apartment', name: '7억원 아파트', emoji: '🏠', price: 700_000_000 },
  { slug: 'building', name: '20억원 건물', emoji: '🏢', price: 2_000_000_000 }
];
