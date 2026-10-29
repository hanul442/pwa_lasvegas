// 캐셔 (lib/cashier.mjs, since the RP season of 2026-10-29): sitting at a table buys its chips with
// money from the wallet, like changing cash at a real table; getting up cashes the rest back in.
import { el, formatCH, sound, haptic } from './fx.js';
import { api } from './api.js';
import { errorToast, toast } from './notice.js';
import { createChip } from './chips.js';

let open = null;

// Resolves with the new state once chips are bought, or null when the player backs out.
export function buyInSheet(state, tier) {
  if (open) return open;
  const range = state?.cashier?.floors?.[tier.slug];
  if (!range || range.max < tier.min) {
    toast(`${tier.name}에 앉으려면 최소 ${formatCH(tier.min)}원이 필요해요.`);
    return Promise.resolve(null);
  }
  open = new Promise(resolve => {
    const scrim = el('div', 'lounge-scrim');
    const sheet = el('section', 'lounge-sheet buyin-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'buyin-title');
    const step = tier.min;
    let amount = Math.max(range.min, Math.min(range.default, range.max));
    const inHand = state.user.account.available;
    sheet.innerHTML = `<p class="lounge-eyebrow">바이인 · ${tier.name}</p>
      <h2 id="buyin-title" data-buyin-amount></h2>
      <p class="lounge-note">가진 돈에서 이 테이블 칩을 사요. 일어나면 남은 칩은 그대로 돈으로 돌아가요.${inHand > 0 ? ` 지금 손에 든 칩 ${formatCH(inHand)}원도 같이 써요.` : ''}</p>
      <div class="buyin-chips" aria-hidden="true"></div>
      <label class="buyin-range"><span class="sr-only">바이인 금액</span><input type="range" min="${range.min}" max="${range.max}" step="${step}" value="${amount}"></label>
      <p class="buyin-scale"><span>${formatCH(range.min)}</span><span>가진 돈 ${formatCH(range.wallet)}원</span><span>${formatCH(range.max)}</span></p>
      <div class="buyin-picks"></div>`;
    const input = sheet.querySelector('input');
    const title = sheet.querySelector('[data-buyin-amount]');
    const chips = sheet.querySelector('.buyin-chips');
    const picks = sheet.querySelector('.buyin-picks');
    const paint = () => {
      title.textContent = `${formatCH(amount)}원`;
      chips.replaceChildren(...[10, 5, 2, 1].map(k => tier.min * k).filter(v => v <= amount).slice(0, 4).map((v, i) => { const c = createChip(v); c.style.setProperty('--i', i); return c; }));
      buy.textContent = `${formatCH(amount)}원 바이인`;
      for (const b of picks.children) b.classList.toggle('is-active', Number(b.dataset.amount) === amount);
    };
    for (const k of [20, 50, 100]) {
      const v = Math.min(range.max, Math.max(range.min, tier.min * k));
      if ([...picks.children].some(b => Number(b.dataset.amount) === v)) continue;
      const b = el('button', 'pill-button buyin-pick', `${k}번어치`);
      b.type = 'button';
      b.dataset.amount = v;
      b.setAttribute('aria-label', `최소 베팅 ${k}번어치, ${formatCH(v)}원`);
      b.addEventListener('click', () => { amount = v; input.value = v; sound.tick?.(); paint(); });
      picks.append(b);
    }
    const actions = el('div', 'lounge-sheet-actions');
    const later = el('button', 'pill-button', '나가기');
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
    later.addEventListener('click', () => close(null));
    buy.addEventListener('click', async () => {
      buy.disabled = true;
      try {
        const out = await api.buyIn(tier.slug, amount);
        sound.chip?.(); haptic?.([12, 30, 12]);
        close(out.state);
      } catch (e) { buy.disabled = false; errorToast(e); }
    });
  });
  return open;
}

// Getting up: what is left in hand goes back to the wallet. Quiet unless something came back.
export async function cashOutQuiet(state) {
  if (!state?.cashier?.on || !(state.user?.account?.available > 0)) return null;
  try {
    const out = await api.cashOut();
    if (out.cashOut?.amount > 0) toast(`칩 ${formatCH(out.cashOut.amount)}원을 돈으로 바꿨어요`);
    return out.state;
  } catch { return null; }
}
