const MAX_ITEMS = 3;

function safeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildBankruptcyComparisonCard(bankruptcy) {
  if (!bankruptcy || !Array.isArray(bankruptcy.comparisons)) return null;

  const seen = new Set();
  const items = [];
  for (const comparison of bankruptcy.comparisons) {
    const slug = safeText(comparison?.slug);
    const name = safeText(comparison?.name);
    const emoji = safeText(comparison?.emoji);
    if (!slug || !name || !emoji || seen.has(slug)) continue;
    seen.add(slug);
    items.push({ slug, name, emoji });
    if (items.length >= MAX_ITEMS) break;
  }

  if (items.length === 0) return null;

  return {
    kind: 'ILLUSTRATIVE_SCALE',
    title: 'BANKRUPTCY SCALE',
    items,
    disclaimer: '재미용 숫자 규모 비유입니다. CH의 현금 가치, 환율, 환전 가능성 또는 실제 구매력을 뜻하지 않습니다.',
    policy: {
      cashEquivalent: false,
      exchangeRate: false,
      redeemable: false,
      exposesReferencePrice: false,
      exposesConversionCount: false
    }
  };
}
