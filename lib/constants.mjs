export const INITIAL_BANKROLL = 1_000_000_000;
export const RECHARGE_TARGET = 500_000_000;
export const RECHARGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const DAILY_RECHARGE_LIMIT = 3;
export const CHICKEN_PRICE = 25_000;

// Bets start at 1천만 원 and climb tenfold per floor up to 10조 at The Vault.
export const STAKE_TIERS = [
  { slug: 'low', name: 'LOW', minBet: 10_000_000, maxBet: 99_999_999 },
  { slug: 'mid', name: 'MID', minBet: 100_000_000, maxBet: 999_999_999 },
  { slug: 'high', name: 'HIGH', minBet: 1_000_000_000, maxBet: 9_999_999_999 },
  { slug: 'vip', name: 'VIP', minBet: 10_000_000_000, maxBet: 99_999_999_999 },
  { slug: 'royal', name: 'ROYAL', minBet: 100_000_000_000, maxBet: 999_999_999_999 },
  { slug: 'vault', name: 'VAULT', minBet: 1_000_000_000_000, maxBet: 10_000_000_000_000 }
];

export function stakeTierFor(stake) {
  if (!Number.isSafeInteger(stake) || stake <= 0) return null;
  return STAKE_TIERS.find(tier => stake >= tier.minBet && stake <= tier.maxBet) ?? null;
}

// Each floor opens once the chips a player holds (wallet + table) reach its threshold; it never closes again.
export const FLOORS = [
  { slug: 'downtown', name: 'Downtown', threshold: 0, minBet: 10_000_000, maxBet: 100_000_000, stakeTiers: ['low','mid'] },
  { slug: 'strip', name: 'The Strip', threshold: 1_000_000_000, minBet: 100_000_000, maxBet: 1_000_000_000, stakeTiers: ['mid','high'] },
  { slug: 'high-limit', name: 'High Limit', threshold: 10_000_000_000, minBet: 1_000_000_000, maxBet: 10_000_000_000, stakeTiers: ['high','vip'] },
  { slug: 'salon-prive', name: 'Salon Privé', threshold: 50_000_000_000, minBet: 10_000_000_000, maxBet: 100_000_000_000, stakeTiers: ['vip','royal'] },
  { slug: 'penthouse', name: 'Penthouse', threshold: 200_000_000_000, minBet: 100_000_000_000, maxBet: 1_000_000_000_000, stakeTiers: ['royal','vault'] },
  { slug: 'vault', name: 'The Vault', threshold: 1_000_000_000_000, minBet: 1_000_000_000_000, maxBet: 10_000_000_000_000, stakeTiers: ['vault'] }
];

export const REFERENCE_PRICES = [
  { slug: 'coffee', name: '커피', emoji: '☕', price: 5_000 },
  { slug: 'chicken', name: '치킨', emoji: '🍗', price: 25_000 },
  { slug: 'laptop', name: '노트북', emoji: '💻', price: 2_000_000 },
  { slug: 'car', name: '4천만원 자동차', emoji: '🚗', price: 40_000_000 },
  { slug: 'supercar', name: '3억원 슈퍼카', emoji: '🏎️', price: 300_000_000 },
  { slug: 'apartment', name: '7억원 아파트', emoji: '🏠', price: 700_000_000 },
  { slug: 'building', name: '20억원 건물', emoji: '🏢', price: 2_000_000_000 }
];
