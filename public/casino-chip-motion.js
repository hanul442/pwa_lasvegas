const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function compactChipLabel(amount) {
  const n = Math.max(0, Number(amount) || 0);
  if (n >= 1e8) return `${Number((n / 1e8).toFixed(n >= 1e9 ? 0 : 1))}억`;
  if (n >= 1e4) return `${Number((n / 1e4).toFixed(n >= 1e6 ? 0 : 1))}만`;
  return Math.round(n).toLocaleString('ko-KR');
}

export function chipCount(amount, minUnit = 1) {
  const n = Math.max(0, Number(amount) || 0);
  if (!n) return 0;
  const unit = Math.max(1, Number(minUnit) || 1);
  const ratio = Math.max(1, n / unit);
  return Math.max(1, Math.min(6, 1 + Math.floor(Math.log2(ratio))));
}

export function chipSettlement(netPnl, stake) {
  const net = Number(netPnl) || 0;
  const wager = Math.max(0, Number(stake) || 0);
  if (net > 0) return {kind:'win', wagerMotion:'hold', payoutMotion:'pay', payoutAmount:net, returnedAmount:wager + net};
  if (net < 0) return {kind:'loss', wagerMotion:'sweep', payoutMotion:'none', payoutAmount:0, returnedAmount:0};
  return {kind:'push', wagerMotion:'return', payoutMotion:'none', payoutAmount:0, returnedAmount:wager};
}

function denominationClass(amount, minUnit) {
  const unit = Math.max(1, Number(minUnit) || 1);
  const ratio = Math.max(1, (Number(amount) || 0) / unit);
  if (ratio >= 20) return 'platinum';
  if (ratio >= 5) return 'violet';
  if (ratio >= 3) return 'gold';
  return 'ivory';
}

export function chipFaceMarkup(amount, minUnit = 1) {
  const cls = denominationClass(amount, minUnit);
  return `<span class="casino-chip-face ${cls}" aria-hidden="true"><i>${esc(compactChipLabel(amount))}</i></span>`;
}

export function chipStackMarkup({amount, minUnit = 1, motion = 'idle', role = 'wager', label = ''} = {}) {
  const n = Math.max(0, Number(amount) || 0);
  if (!n) return '';
  const count = chipCount(n, minUnit);
  const cls = denominationClass(n, minUnit);
  const chips = Array.from({length:count}, (_, index) => `<i class="casino-chip ${cls}" style="--chip-index:${index}" aria-hidden="true"></i>`).join('');
  const accessible = label || `${n.toLocaleString('ko-KR')} fictional CH`;
  return `<span class="casino-chip-stack ${esc(role)}" data-chip-motion="${esc(motion)}" aria-label="${esc(accessible)}">${chips}<b>${esc(compactChipLabel(n))}</b></span>`;
}
