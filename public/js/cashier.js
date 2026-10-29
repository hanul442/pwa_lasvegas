// 캐셔 (lib/cashier.mjs, since the RP season of 2026-10-29): sitting at a table buys its chips with
// money from the wallet, like changing cash at a real table; getting up cashes the rest back in.
import { el, wonCH, chipCount, inTableUnits, setTableUnits, sound, haptic } from './fx.js';
import { api, playerId } from './api.js';
import { errorToast, toast } from './notice.js';
import { createChip } from './chips.js';

let open = null;

// The last amount bought at each floor, so the next sit starts there (per player, this phone).
const lastKey = slug => `vegas:buyin:${playerId()}:${slug}`;
const lastAmount = slug => { try { return Number(localStorage.getItem(lastKey(slug))) || 0; } catch { return 0; } };
const keepAmount = (slug, v) => { try { localStorage.setItem(lastKey(slug), String(v)); } catch {} };

// Resolves with the new state once chips are bought, or null when the player backs out.
// mode: 'sit' (sitting down), 'topup' (more chips from the seat, the table's +), 'rebuy' (the
// stack ran under the table's smallest bet). With 'rebuy' the other button gets up from the table.
// `event`: an event table, which asks the player to hold its entry (state.eventEntry) and sells its
// chips whatever floor the event stands on.
export function buyInSheet(state, tier, { mode = 'sit', event = null, onLeave = null } = {}) {
  if (open) return open;
  const range = state?.cashier?.floors?.[tier.slug];
  if (!range || range.max < tier.min) {
    if (range && range.inHand > 0 && range.wallet >= tier.min) toast(`이미 ${tier.name} 최대 바이인(최소 베팅 100번어치)만큼 칩이 있어요.`);
    else toast(`지갑에 돈이 모자라요. ${tier.name}은 최소 ${wonCH(tier.min)}원부터예요.`);
    return Promise.resolve(null);
  }
  open = new Promise(resolve => {
    const scrim = el('div', 'lounge-scrim buyin-scrim');
    const sheet = el('section', 'lounge-sheet buyin-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'buyin-title');
    const step = tier.min;
    const fit = v => Math.max(range.min, Math.min(v, range.max));
    const entry = event ? (state.events || []).concat(state.eventsAlways || []).find(e => e.id === event)?.entry || 0 : 0;
    const fee = event ? state.eventFees?.[event] : null;
    const remembered = event ? 0 : lastAmount(tier.slug);
    const inHand = range.inHand || 0;
    let amount = fit(mode === 'topup' ? tier.min * 50 - inHand : Math.max(remembered || range.default, Math.ceil((entry - inHand) / step) * step));
    const eyebrow = mode === 'rebuy' ? `칩이 떨어졌어요 · ${tier.name}` : mode === 'topup' ? `칩 더 사기 · ${tier.name}` : `바이인 · ${tier.name}`;
    const note = (mode === 'rebuy'
      ? `남은 칩 ${chipCount(inHand)}칩으로는 최소 베팅 ${chipCount(tier.min)}칩을 못 걸어요. 지갑에서 칩을 더 사면 이 자리에서 계속해요.`
      : inHand > 0
        ? `지금 칩 ${chipCount(inHand)}칩에 더해요. 일어나면 남은 칩은 전부 지갑으로 돌아가요.`
        : '지갑 돈으로 테이블 칩을 사요. 1칩은 100만원이고, 일어나면 남은 칩은 전부 지갑으로 돌아가요.')
      + (entry ? ` 이벤트 테이블은 칩 ${chipCount(entry)}칩 이상을 들고 앉아야 해요.` : '')
      + (fee && !fee.paid ? ` 첫 판에 입장료 ${chipCount(fee.fee)}칩을 내요 (${fee.per === 'day' ? '하루' : '이번 주'} 한 번).` : '');
    sheet.innerHTML = `<p class="lounge-eyebrow">${eyebrow}</p>
      <h2 id="buyin-title"><span data-buyin-amount></span> <small data-buyin-won></small></h2>
      <p class="lounge-note">${note}</p>
      <div class="buyin-chips" aria-hidden="true"></div>
      <label class="buyin-range"><span class="sr-only">바이인 금액</span><input type="range" min="${range.min}" max="${range.max}" step="${step}" value="${amount}"></label>
      <p class="buyin-scale"><span>${chipCount(range.min)}칩</span><span>지갑 ${wonCH(range.wallet)}원</span><span>${chipCount(range.max)}칩</span></p>
      <div class="buyin-picks"></div>`;
    const input = sheet.querySelector('input');
    const title = sheet.querySelector('[data-buyin-amount]');
    const won = sheet.querySelector('[data-buyin-won]');
    const chips = sheet.querySelector('.buyin-chips');
    const picks = sheet.querySelector('.buyin-picks');
    const paint = () => {
      title.textContent = `${chipCount(amount)}칩`;
      won.textContent = `${wonCH(amount)}원`;
      // The chips as the table will show them (in chips, js/money.js), wherever the sheet opens.
      const units = inTableUnits();
      setTableUnits(true);
      try { chips.replaceChildren(...[10, 5, 2, 1].map(k => tier.min * k).filter(v => v <= amount).slice(0, 4).map((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); return c; })); } finally { setTableUnits(units); }
      buy.textContent = mode === 'sit' ? `${chipCount(amount)}칩 바이인` : `${chipCount(amount)}칩 더 사기`;
      for (const b of picks.children) b.classList.toggle('is-active', Number(b.dataset.amount) === amount);
    };
    // Quick picks: the last amount bought here (when it differs), then 20 / 50 / 100 smallest bets
    // (as a top-up: what brings the stack to that many).
    const options = [];
    if (remembered && fit(remembered) === remembered) options.push([remembered, '지난번', `지난번 금액 ${chipCount(remembered)}칩`]);
    for (const k of [20, 50, 100]) {
      const v = fit(tier.min * k - inHand);
      options.push([v, inHand > 0 ? `${k}번어치로` : `${k}번어치`, `최소 베팅 ${k}번어치${inHand > 0 ? '가 되게' : ''}, ${chipCount(v)}칩`]);
    }
    for (const [v, label, aria] of options) {
      if ([...picks.children].some(b => Number(b.dataset.amount) === v)) continue;
      const b = el('button', 'pill-button buyin-pick', label);
      b.type = 'button';
      b.dataset.amount = v;
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => { amount = v; input.value = v; sound.tick?.(); paint(); });
      picks.append(b);
    }
    const actions = el('div', 'lounge-sheet-actions');
    const later = el('button', 'pill-button', mode === 'rebuy' ? '일어나기' : mode === 'topup' ? '닫기' : '나가기');
    const buy = el('button', 'pill-button pill-button--solid', '');
    later.type = buy.type = 'button';
    actions.append(later, buy);
    sheet.append(actions);
    input.addEventListener('input', () => { amount = Number(input.value); paint(); });
    paint();
    document.body.append(scrim, sheet);
    requestAnimationFrame(() => { scrim.classList.add('is-open'); sheet.classList.add('is-open'); buy.focus({ preventScroll: true }); });
    let done = false;
    const close = result => {
      if (done) return;
      done = true;
      open = null;
      scrim.classList.remove('is-open'); sheet.classList.remove('is-open');
      removeEventListener('keydown', onKey, true);
      setTimeout(() => { scrim.remove(); sheet.remove(); }, 320);
      resolve(result);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    addEventListener('keydown', onKey, true);
    scrim.addEventListener('click', () => close(null));
    later.addEventListener('click', () => { close(null); if (mode === 'rebuy') onLeave?.(); });
    buy.addEventListener('click', async () => {
      buy.disabled = true;
      try {
        const out = await api.buyIn(tier.slug, amount, event);
        if (!event) keepAmount(tier.slug, amount);
        sound.chip?.(); haptic?.([12, 30, 12]);
        close(out.state);
      } catch (e) { buy.disabled = false; errorToast(e); }
    });
  });
  return open;
}

// Getting up: what is left in hand goes back to the wallet. Quiet unless something came back.
export async function cashOutQuiet(state) {
  if (!state?.cashier?.on || !(state.cashier.seat || state.user?.account?.available > 0)) return null;
  try {
    const out = await api.cashOut();
    if (out.cashOut?.amount > 0) toast(`칩 ${chipCount(out.cashOut.amount)}개를 ${wonCH(out.cashOut.amount)}원으로 바꿔 지갑에 넣었어요`);
    return out.state;
  } catch { return null; }
}
