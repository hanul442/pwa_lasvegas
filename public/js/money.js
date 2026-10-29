// Money as the app writes it, everywhere: chips and buttons (formatCH: 1억 2천만, 2.5조) and
// sentences (formatMoney: 7억 2천만원). Pure functions with no DOM, so the server imports this
// same file for push notifications, banners and feed text; nothing shows a raw 1000000000.
// Chips read like Korean money: 1억 2천만, 3500만, 10만. Short enough for chips and buttons.
export function formatCH(value) {
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

