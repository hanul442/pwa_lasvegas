// New players start with nothing: the first chips come from the bank (lib/bank.mjs) or a handout.
export const INITIAL_BANKROLL = 0;
export const RECHARGE_TARGET = 50_000_000;
export const RECHARGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const DAILY_RECHARGE_LIMIT = 3;
export const CHICKEN_PRICE = 25_000;

// Every amount the casino moves is a whole number of 100만 (한서's call): bets, payouts, blinds,
// loans, repayments, interest and handouts. A payout that works out between units (blackjack 3:2
// on 100만, the banker's 5%, a horse's 2.45배) goes up or down a unit at random, weighted so the
// average is exactly the quoted price (2026-10-24 review: plain rounding had made 100만 blackjack
// and banker bets beat the house, and flooring cut small horse bets to 62%).
export const MONEY_UNIT = 1_000_000;
export const roundMoney = x => Math.round(x / MONEY_UNIT) * MONEY_UNIT;
export const ceilMoney = x => Math.ceil(x / MONEY_UNIT) * MONEY_UNIT;
export const floorMoney = x => Math.floor(x / MONEY_UNIT) * MONEY_UNIT;
export const isMoney = x => Number.isSafeInteger(x) && x % MONEY_UNIT === 0;
// A fractional payout on `stake`: to the nearest 100만 when the stake is in 100만s (every real
// table), otherwise the old whole-won floor (bare engine tests with tiny stakes).
export const fairMoney = (exact, rand = Math.random) => {
  const lo = floorMoney(exact), frac = (exact - lo) / MONEY_UNIT;
  return frac > 1e-9 && rand() < frac ? lo + MONEY_UNIT : lo;
};
export const payout = (stake, exact, rand) => isMoney(stake) && stake > 0 ? fairMoney(exact, rand) : Math.floor(exact);

// Eight floors. Until the RP season (2026-10-29) each was ten times the one below, from 100만 in
// the Gold Room to 10조 on Olympus, and a floor opened at three of its smallest bets in net worth.
// Since then (한서 "간격 줄이기 (매 층 3배)") each is about three times the one below, from 1천만
// to 300억, and the RP tier opens them (lib/state.mjs). A floor's top bet is ten times its smallest.
// Tests of the old economy import tests/legacy-economy.mjs first, which keeps the old list.
export const LEGACY_ECONOMY = Boolean(globalThis.VEGAS_LEGACY_ECONOMY);
const FLOOR_LIST = LEGACY_ECONOMY ? [
  ['gold-room', '홀', 1_000_000],
  ['high-limit', '클럽', 10_000_000],
  ['salon-prive', '살롱', 100_000_000],
  ['penthouse', '펜트하우스', 1_000_000_000],
  ['sky-lounge', '스카이', 10_000_000_000],
  ['vault', '볼트', 100_000_000_000],
  ['crown', '크라운', 1_000_000_000_000],
  ['olympus', '올림포스', 10_000_000_000_000]
] : [
  ['gold-room', '홀', 10_000_000],
  ['high-limit', '클럽', 30_000_000],
  ['salon-prive', '살롱', 100_000_000],
  ['penthouse', '펜트하우스', 300_000_000],
  ['sky-lounge', '스카이', 1_000_000_000],
  ['vault', '볼트', 3_000_000_000],
  ['crown', '크라운', 10_000_000_000],
  ['olympus', '올림포스', 30_000_000_000]
];
export const UNLOCK_MULTIPLE = 3;

// Income stops growing with the floors at some point (2026-10-19 경제 점검, 한서 "3번빼고 다 진행"):
// pay, missions, achievements, weekly prizes and support count at most the Vault's smallest bet,
// and a loan's limit at most the Sky Lounge's, so the richest players don't snowball.
export const REWARD_BASE_CAP = 100_000_000_000; // 1천억
export const LOAN_BASE_CAP = 10_000_000_000; // 100억
// A new account sits in friends' rooms only up to the High Limit floor for its first week, so
// fresh accounts can't pass their handouts to a main account at big stakes.
export const NEW_ACCOUNT_DAYS = 7;
// The highest floor a week-old account may use for friends' rooms. By name, so it stays the High
// Limit when floor prices change (the RP season moved it from 1천만 to 3천만 and new accounts were
// held to the Gold Room).
export const NEW_ACCOUNT_ROOM_FLOOR = 'high-limit';
export const CEILING_MULTIPLE = 100;

// A bet belongs to the tier whose range holds it: from its floor's smallest bet up to the next
// floor's. A floor's table takes every tier its own range (smallest to ten times it) touches.
export const STAKE_TIERS = FLOOR_LIST.map(([slug, name, min], i) => ({
  slug, name, minBet: min, maxBet: i === FLOOR_LIST.length - 1 ? min * 10 : FLOOR_LIST[i + 1][2] - 1
}));

export function stakeTierFor(stake) {
  if (!Number.isSafeInteger(stake) || stake <= 0) return null;
  return STAKE_TIERS.find(tier => stake >= tier.minBet && stake <= tier.maxBet) ?? null;
}

// The higher the floor, the harder the table (한서's call): AI players get sharper and make fewer
// mistakes, and from the Penthouse up the blackjack dealer hits soft 17. `level` runs 0 (Gold Room)
// to 5 (The Vault); `skill` is the same on a 0–1 scale; the lobby shows `stars` out of five.
export const DIFFICULTY_STARS = [1, 2, 3, 4, 5, 5, 5, 5];
// The AI is already at its sharpest in the Vault; the floors above it play the same.
export const TOP_SKILL_LEVEL = 5;
export const H17_FROM_LEVEL = 3;
export function levelForStake(stake) {
  const i = STAKE_TIERS.findIndex(t => stake >= t.minBet && stake <= t.maxBet);
  return i < 0 ? 0 : i;
}
// How well the AI at a table plays, 0–1, from what is being bet there. Bare engine tests with
// tiny stakes get the sharpest AI, which is how the engines always played.
export const aiSkillForStake = stake => (isMoney(stake) ? skillOf(levelForStake(stake)) : 1);
// A table's level by its floor when known (a floor's top bet already reads as the next tier).
export const levelForFloor = (slug, stake) => { const i = FLOOR_LIST.findIndex(f => f[0] === slug); return i < 0 ? levelForStake(stake) : i; };
// A card round's AI skill: by its casino floor (`venue`) when the round knows it, else by its stake.
export const aiSkillFor = round => (round?.venue ? skillOf(levelForFloor(round.venue, round.stake)) : aiSkillForStake(round?.stake));
export const skillOf = level => Math.max(0, Math.min(1, (Number(level) || 0) / TOP_SKILL_LEVEL));

// Floor names (2026-10-30, 한서 "이름도 다 정비"): one Korean word for sentences and an English
// wordmark with the floor number for signs, from 1F HALL to 8F OLYMPUS. Slugs never change.
export const FLOOR_EN = { 'gold-room': 'HALL', 'high-limit': 'CLUB', 'salon-prive': 'SALON', penthouse: 'PENTHOUSE', 'sky-lounge': 'SKY', vault: 'VAULT', crown: 'CROWN', olympus: 'OLYMPUS' };

export const FLOORS = FLOOR_LIST.map(([slug, name, min], i) => ({
  slug, name, en: FLOOR_EN[slug], no: i + 1, minBet: min, maxBet: min * 10,
  threshold: i === 0 ? 0 : min * UNLOCK_MULTIPLE,
  ceiling: i === FLOOR_LIST.length - 1 ? null : min * CEILING_MULTIPLE,
  stakeTiers: FLOOR_LIST.filter(f => f[2] >= min && f[2] <= min * 10).map(f => f[0])
}));

// Table chips (public/js/money.js chipValueFor): one chip is a hundredth of the floor's smallest bet,
// so every floor reads 100–1,000칩. 한서 2026-10-31 "소숫점으로 거는거 하지말랫지": a table never shows
// part of a chip. Amounts also stay in whole 100만s, so a table moves in its "unit": the smallest
// amount that is both whole chips and whole 100만s (홀 10칩, 클럽 10칩 = 300만, 살롱 and up 1칩).
export const CHIPS_PER_MIN_BET = 100;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const floorOf = f => (typeof f === 'string' ? FLOORS.find(x => x.slug === f) : f) || null;
export const chipValueOf = f => { const fl = floorOf(f); return fl ? fl.minBet / CHIPS_PER_MIN_BET : MONEY_UNIT; };
export function tableUnitOf(f) {
  const chip = chipValueOf(f);
  return Number.isSafeInteger(chip) && chip > 0 ? (chip / gcd(chip, MONEY_UNIT)) * MONEY_UNIT : MONEY_UNIT;
}
// A between-units amount goes to a neighbouring unit at random, weighted so the average is exact.
export const fairTo = (exact, unit, rand = Math.random) => {
  const lo = Math.floor(exact / unit) * unit, frac = (exact - lo) / unit;
  return frac > 1e-9 && rand() < frac ? lo + unit : lo;
};

export const REFERENCE_PRICES = [
  { slug: 'coffee', name: '커피', emoji: '☕', price: 5_000 },
  { slug: 'chicken', name: '치킨', emoji: '🍗', price: 25_000 },
  { slug: 'laptop', name: '노트북', emoji: '💻', price: 2_000_000 },
  { slug: 'car', name: '4천만원 자동차', emoji: '🚗', price: 40_000_000 },
  { slug: 'supercar', name: '3억원 슈퍼카', emoji: '🏎️', price: 300_000_000 },
  { slug: 'apartment', name: '7억원 아파트', emoji: '🏠', price: 700_000_000 },
  { slug: 'building', name: '20억원 건물', emoji: '🏢', price: 2_000_000_000 }
];
