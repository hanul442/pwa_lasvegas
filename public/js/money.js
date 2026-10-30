// Money as the app writes it, everywhere: chips and buttons (formatCH: 1억 2천만, 2.5조) and
// sentences (formatMoney: 7억 2천만원). Pure functions with no DOM, so the server imports this
// same file for push notifications, banners and feed text; nothing shows a raw 1000000000.
// At a table money is counted in chips (한서 2026-10-29: "바이인해서 들어갔으면 거기서는 또 다른
// 액수 단위를 써야지"). One chip is a hundredth of the table's smallest bet, so every table reads the
// same: bets 100–1,000칩, chips 100·200·500·1,000 (한서 2026-10-30: "칩이 30 60 ㅇㅈㄹ로 되있으면
// 베팅을 어캐하라는걸까" about a fixed 100만 chip, then "치는 느낌이 나게 칩단위를 훨씬 줄여 … 같은
// 억이어도 칩이 더 많아지는거야" about the tenth it was). The client switches this on while a table
// is open (app.js, with that table's chip value); the server never does.
export const CHIP_WON = 1_000_000;
export const CHIPS_PER_MIN_BET = 100;
export const chipValueFor = minBet => Math.max(1, Math.round((Number(minBet) || 0) / CHIPS_PER_MIN_BET)) || CHIP_WON;
let tableUnits = false, chipWon = CHIP_WON;
export function setTableUnits(on, value = chipWon) { tableUnits = Boolean(on); if (value > 0) chipWon = value; }
export const inTableUnits = () => tableUnits;
export const tableChipWon = () => chipWon;
// A count of chips: 15, 9.5, 500, 3,000, then 12만 and 1.5억 for huge stacks. Amounts come in
// 100만s, so on a floor whose chip is worth more a small count can have a tenth (2800만 at 300만
// = 9.3); from 100 chips up it is rounded.
export function chipCount(value, per = chipWon) {
  const c = (Number(value) || 0) / per;
  const sign = c < 0 ? '-' : '', a = Math.abs(c);
  if (a < 100) return sign + (Math.round(a * 10) / 10).toLocaleString('ko-KR');
  if (a < 100_000) return sign + Math.round(a).toLocaleString('ko-KR');
  return sign + wonCH(a);
}
// The unit word after an amount: 원, or 칩 at a table. formatUnit(5e8) → "5억원" / "500칩".
export const unitWord = () => (tableUnits ? '칩' : '원');
export const formatUnit = value => `${formatCH(value)}${unitWord()}`;

// Chips read like Korean money: 1억 2천만, 3500만, 10만. Short enough for chips and buttons.
// At a table: a chip count (chipCount).
export function formatCH(value) { return tableUnits ? chipCount(value) : wonCH(value); }
export function wonCH(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 10_000) return sign + abs.toLocaleString('ko-KR');
  if (abs >= 1e12) return `${sign}${trim(abs / 1e12)}조`;
  if (abs < 1e6) return `${sign}${trim(abs / 1e4)}만`; // 2.5만, 35만
  const total = Math.round(abs / 1e4); // in 만
  const eok = Math.floor(total / 1e4), man = total % 1e4;
  if (eok >= 100 || (eok > 0 && man === 0)) return `${sign}${trim(abs / 1e8)}억`;
  // Keep two parts at most: 1억 2천만, 3억 8200만.
  if (eok > 0) return `${sign}${eok}억 ${manText(man)}`;
  return sign + manText(man);
}
function manText(man) {
  if (man >= 1000 && man % 1000 === 0) return `${man / 1000}천만`;
  return `${man}만`;
}
function trim(x) { return x >= 100 ? String(Math.round(x)) : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/\.?0+$/, ''); }

// Spelled out the way people say money: 7억 2천만원, 1조 3500억원, 2만 5천원, 800원.
// The two largest units are kept, so a big win reads at a glance.
export function formatMoney(value, unit = '원') {
  if (tableUnits && unit === '원') return `${chipCount(Math.abs(Number(value) || 0))}칩`;
  return formatWon(value, unit);
}
export function formatWon(value, unit = '원') {
  const n = Math.abs(Math.round(Number(value) || 0));
  if (n < 10_000) return `${n.toLocaleString('ko-KR')}${unit}`;
  const groups = [[1e12, '조'], [1e8, '억'], [1e4, '만'], [1, '']]
    .map(([size, name]) => [Math.floor(n / size) % 1e4, name]);
  groups[0][0] = Math.floor(n / 1e12);
  const parts = groups.filter(([v]) => v > 0).slice(0, 2)
    .map(([v, name]) => `${v >= 1000 && v % 1000 === 0 && v < 1e4 ? `${v / 1000}천` : v}${name}`);
  return `${parts.join(' ')}${unit}`;
}
// The slot jackpot written out in full down to 만, so every spin that feeds it shows:
// 50억 100만원, 5조 10억 2500만원, 3억 2천만원. Below 만 it does not move.
export function formatJackpot(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  if (n < 10_000) return formatMoney(n);
  const parts = [[Math.floor(n / 1e12), '조'], [Math.floor(n / 1e8) % 1e4, '억'], [Math.floor(n / 1e4) % 1e4, '만']]
    .filter(([v]) => v > 0)
    .map(([v, name]) => `${v >= 1000 && v % 1000 === 0 && v < 1e4 ? `${v / 1000}천` : v}${name}`);
  return `${parts.join(' ')}원`;
}
// "7억 2천만원 벌었어요" / "3만원 잃었어요" under a result.
export const moneyResult = net => (net > 0 ? `${formatMoney(net)} 벌었어요` : net < 0 ? `${formatMoney(net)} 잃었어요` : '');


// Everything a player can spend away from a table: chips in hand plus the wallet (lib/cashier.mjs,
// since the RP season of 2026-10-29). At a table the chips in hand are what can be bet.
export const moneyOf = st => Math.max(0, st?.user?.account?.available ?? 0) + Math.max(0, st?.user?.account?.wallet ?? 0);
