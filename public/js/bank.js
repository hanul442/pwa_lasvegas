// 지갑 (2026-10-29, after the bank closed): what I have, split into the wallet and the chips on a
// table, the free money I can take now (일급·정부 지원금·구제금융), and the chip history. A loan
// left from before the bank closed shows only while it is unpaid, so it can still be paid off.
// Every number comes from the server (lib/cashier.mjs, lib/engagement.mjs).
import { api, errorMessage } from './api.js';
import { el, formatCH, wonCH, formatMoney, sound } from './fx.js';
import { moneyOf } from './money.js';
import { chipsToWallet, claimDaily } from './lounge.js';
import { errorToast } from './notice.js';
import { renderLedger } from './ledger.js';

const DAY = 86_400_000;
const pct = rate => `${+(rate * 100).toFixed(2)}%`;
const won = n => `${wonCH(n)}원`;

function dueText(loan) {
  if (loan.overdue) return '연체 중 · 들어오는 칩에서 자동 회수';
  const ms = Date.parse(loan.dueAt) - Date.now();
  const d = Math.floor(ms / DAY), h = Math.floor(ms / 3_600_000) % 24;
  return d > 0 ? `만기까지 ${d}일 ${h}시간` : `만기까지 ${Math.max(0, Math.floor(ms / 3_600_000))}시간 ${Math.floor(ms / 60_000) % 60}분`;
}

// Bottom sheet shared by borrowing, repaying and bankruptcy.
function openSheet({ eyebrow, title, build, confirm, danger = false }) {
  const scrim = el('div', 'lounge-scrim');
  const sheet = el('section', 'lounge-sheet bank-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'bank-sheet-title');
  sheet.innerHTML = `<p class="lounge-eyebrow">${eyebrow}</p><h2 id="bank-sheet-title">${title}</h2>`;
  const body = el('div', 'bank-sheet-body');
  sheet.append(body);
  const actions = el('div', 'lounge-sheet-actions');
  const cancel = el('button', 'pill-button', '닫기');
  const go = el('button', `pill-button pill-button--solid${danger ? ' pill-button--danger' : ''}`);
  cancel.type = go.type = 'button';
  actions.append(cancel, go);
  sheet.append(actions);
  const refresh = build(body, label => { go.textContent = label.text; go.disabled = Boolean(label.disabled); });
  document.body.append(scrim, sheet);
  requestAnimationFrame(() => { scrim.classList.add('is-open'); sheet.classList.add('is-open'); (sheet.querySelector('input,button.segment') || go).focus({ preventScroll: true }); });
  const close = () => {
    scrim.classList.remove('is-open'); sheet.classList.remove('is-open');
    removeEventListener('keydown', onKey, true);
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 320);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', close);
  cancel.addEventListener('click', close);
  go.addEventListener('click', async () => {
    go.disabled = true;
    try { await confirm(go); close(); } catch (e) { go.disabled = false; showError(body, e); }
  });
  refresh?.();
  return close;
}

function showError(body, e) {
  let note = body.querySelector('.bank-error');
  if (!note) { note = el('p', 'bank-error'); note.setAttribute('role', 'alert'); body.append(note); }
  note.textContent = errorMessage(e);
}

// Every amount moves in whole 100만s (lib/bank.mjs); `exact` is one odd amount still allowed
// (paying off a loan to the last won).
const UNIT = 1_000_000;
const inUnits = (v, exact) => v > 0 && (v % UNIT === 0 || v === exact);
// Amount field with quick picks; onInput gets the whole-number amount.
function amountField(max, start, onInput, exact = null) {
  const wrap = el('div', 'bank-amount');
  const label = el('label', 'bank-label', '금액');
  const row = el('div', 'bank-amount-row');
  const input = el('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.id = 'bank-amount';
  label.htmlFor = input.id;
  input.value = String(start);
  const unit = el('span', 'bank-unit', '원');
  row.append(input, unit);
  const hint = el('small', 'bank-hint');
  const picks = el('div', 'bank-picks');
  for (const [text, share] of [['25%', 0.25], ['절반', 0.5], ['최대', 1]]) {
    const b = el('button', 'pill-button', text);
    b.type = 'button';
    b.addEventListener('click', () => { input.value = String(share === 1 && max === exact ? max : Math.max(UNIT, Math.floor(max * share / UNIT) * UNIT)); update(); });
    picks.append(b);
  }
  const value = () => Number(String(input.value).replace(/[^\d]/g, '')) || 0;
  const update = () => { const v = value(); hint.textContent = v ? formatMoney(v) : ''; onInput(v); };
  input.addEventListener('input', update);
  wrap.append(label, row, hint, picks);
  return { node: wrap, update };
}

function repaySheet(state, loan, onChanged) {
  const available = moneyOf(state);
  const max = available >= loan.balance ? loan.balance : Math.floor(available / UNIT) * UNIT;
  let amount = max;
  openSheet({
    eyebrow: `${loan.lenderName} · ${loan.house}`,
    title: `남은 빚 ${won(loan.balance)}`,
    build(body, setGo) {
      const note = el('p', 'bank-preview');
      note.innerHTML = loan.overdue ? '연체된 대출이에요. 다 갚아도 신용은 오르지 않아요.' : '만기 전에 다 갚으면 신용 점수가 올라요 (하루 한 번, 이자가 하루 이상 붙은 대출만).';
      const field = amountField(max, amount, v => { amount = v; draw(); }, loan.balance);
      body.append(field.node, note);
      function draw() {
        const bad = !inUnits(amount, loan.balance) || amount > max;
        setGo({ text: bad ? (max <= 0 ? '갚을 칩이 없어요' : amount > max ? `최대 ${won(max)}까지 갚을 수 있어요` : '100만원 단위로 넣어 주세요') : amount === loan.balance ? `${won(amount)} 다 갚기` : `${won(amount)} 갚기`, disabled: bad });
      }
      return draw;
    },
    async confirm() {
      const out = await api.repay(loan.id, amount);
      sound.chip();
      onChanged(out.state);
    }
  });
}

// Chips still on a table (a round not finished, a poker seat not left) are the player's but not in
// the wallet: the top bar shows the wallet, so the bank says where the rest is and how it comes back.
const GAME_NAMES = { blackjack: '블랙잭', matgo: '맞고', gostop: '고스톱', seotda: '섯다', poker: '홀덤', sevenpoker: '7포커', baccarat: '바카라' };
const resumable = state => (state.openRounds || []).find(r => !r.left) || null;
function heldLine(state) {
  const locked = state.user.account.locked;
  if (!(locked > 0)) return '';
  const open = state.openRounds || [], r = resumable(state), left = open.find(x => x.left);
  const where = r ? `${r.event ? '이벤트 테이블' : GAME_NAMES[r.game] || '테이블'}${r.room ? ` · 친구 방 ${r.room}` : ''}` : left ? `${GAME_NAMES[left.game] || '친구 방'} · 친구 방 ${left.room}` : '';
  const how = '판이 끝나면 지갑으로 돌아와요';
  return `<div class="bank-held"><span class="bank-held-text">테이블에 걸린 칩 <b>${won(locked)}</b><small>${where ? `${where} · ` : ''}${how}</small></span>${r ? '<button class="pill-button" type="button" data-held-go>테이블로 가기</button>' : ''}</div>`;
}
// app.js owns the tables; it opens the open round when asked.
function resumeTable(btn) { document.dispatchEvent(new CustomEvent('vegas:resume', { detail: { trigger: btn } })); }

// The money on hand: the wallet (lib/cashier.mjs account.wallet, plus chips held without a seat,
// which go back to it on the next change) and the chips at a table (in hand while seated, and
// any still in a round).
export function walletSplit(state) {
  const a = state.user.account, c = state.cashier || {};
  const seated = Boolean(c.on && c.seat);
  const inHand = Math.max(0, a.available || 0), locked = Math.max(0, a.locked || 0);
  const wallet = c.on ? Math.max(0, c.wallet || 0) + (seated ? 0 : inHand) : inHand;
  const table = (seated ? inHand : 0) + locked;
  return { wallet, table, total: wallet + table, seat: seated ? c.seat : null };
}

function walletHero(state) {
  const { wallet, table, total, seat } = walletSplit(state);
  const floor = seat ? (state.floors || []).find(f => f.slug === seat.floor) : null;
  const box = el('section', 'wallet-hero');
  box.innerHTML = `
    <p class="wallet-hero-kicker">가진 돈</p>
    <strong class="wallet-hero-total">${wonCH(total)}<span>원</span></strong>
    <dl class="wallet-split">
      <div><dt>지갑</dt><dd>${won(wallet)}</dd><small>테이블에 앉을 때 칩으로 바꿔요</small></div>
      <div><dt>테이블 칩</dt><dd>${won(table)}</dd><small>${floor ? `${floor.name}에 앉아 있어요 · 일어나면 지갑으로` : table > 0 ? '판이 끝나면 지갑으로 돌아와요' : '앉아 있는 테이블이 없어요'}</small></div>
    </dl>
    ${heldLine(state)}`;
  const go = box.querySelector('[data-held-go]');
  if (go) go.addEventListener('click', () => resumeTable(go));
  return box;
}

// Loans taken before the bank closed (2026-10-29): only to pay them off.
function loansBlock(state, onChanged) {
  const b = state.bank;
  const box = el('section', 'bank-block');
  box.innerHTML = `<header class="lounge-head"><h2>남은 대출</h2><small>${won(b.debt)}</small></header><p class="lounge-note">은행은 문을 닫았어요. 예전에 빌린 돈은 여기서 갚을 수 있어요.</p>`;
  const list = el('ul', 'loan-list');
  for (const loan of b.loans) {
    const li = el('li', `loan${loan.overdue ? ' is-overdue' : ''}`);
    li.innerHTML = `<div class="loan-text"><span class="loan-house">${loan.house} <small>${loan.lenderName}</small></span><strong>${won(loan.balance)}</strong><small>원금 ${won(loan.principal)} · 하루 ${pct(loan.rate)} · ${dueText(loan)}</small></div>`;
    const pay = el('button', 'pill-button', '갚기');
    pay.type = 'button';
    pay.addEventListener('click', () => repaySheet(state, loan, onChanged));
    li.append(pay);
    list.append(li);
  }
  box.append(list);
  return box;
}

// The server pays each support at most once per period, so retrying after a dropped connection
// can't pay twice.
export async function claimSupport(kind, btn, onChanged) {
  btn.disabled = true;
  try { const out = await api.supportClaim(kind); await chipsToWallet(btn, out.claim.amount); onChanged(out.state); }
  catch (e) { btn.disabled = false; errorToast(e, () => claimSupport(kind, btn, onChanged)); }
}

// The free support a broke player can take right now, as solid lobby buttons (구제금융 first).
export function supportButtons(state, onChanged) {
  const sup = state?.engagement?.support;
  if (!sup) return [];
  const free = [];
  if (sup.welfare?.qualified && !sup.welfare.claimed) free.push(['welfare', `구제금융 +${formatCH(sup.welfare.amount)}`]);
  if (sup.grant && !sup.grant.claimed && !sup.grant.closed) free.push(['grant', `정부 지원금 +${formatCH(sup.grant.amount)}`]);
  return free.map(([kind, label]) => {
    const b = el('button', 'pill-button pill-button--solid', label);
    b.type = 'button';
    b.addEventListener('click', () => claimSupport(kind, b, onChanged));
    return b;
  });
}

function payBlock(state, onChanged) {
  const eng = state.engagement, daily = eng.daily, sup = eng.support;
  const box = el('section', 'bank-block');
  box.innerHTML = `<header class="lounge-head"><h2>받을 수 있는 돈</h2><small>갚을 필요 없어요</small></header>`;
  const list = el('ul', 'pay-list');
  const row = (title, sub, label, enabled, run) => {
    const li = el('li', `pay-row${enabled ? ' is-ready' : ''}`);
    li.innerHTML = `<div class="mission-text"><span>${title}</span><small>${sub}</small></div>`;
    const btn = el('button', `pill-button${enabled ? ' pill-button--solid' : ''}`, label);
    btn.type = 'button';
    btn.disabled = !enabled;
    btn.addEventListener('click', () => run(btn));
    li.append(btn);
    list.append(li);
  };
  row('일급', `${daily.streak}일 연속 · 주급까지 ${daily.toWeekly}일 · 월급까지 ${daily.toMonthly}일`,
    daily.claimed ? '받음' : `+${formatCH(daily.reward)}`, !daily.claimed, btn => claimDaily(btn, onChanged));
  const claim = kind => btn => claimSupport(kind, btn, onChanged);
  row('정부 지원금', '일주일에 한 번 · 월요일에 새로', sup.grant.claimed ? '받음' : `+${formatCH(sup.grant.amount)}`, !sup.grant.claimed, claim('grant'));
  const w = sup.welfare, left = w.perDay - w.taken;
  // Say why it can't be taken, in the player's terms: chips still on a table, or chips in the wallet.
  if (w.claimed) row('구제금융', w.perDay === 1 ? '오늘 받았어요 · 내일 다시 받을 수 있어요' : `오늘 ${w.perDay}번 다 받았어요 · 내일 다시 받을 수 있어요`, '오늘 다 받음', false, () => {});
  else if (w.qualified) row('구제금융', `가진 돈이 ${won(w.below)}보다 적을 때 · ${w.perDay === 1 ? '하루 한 번' : `오늘 ${left}번 남음`}`, `+${formatCH(w.amount)}`, true, claim('welfare'));
  else if (w.reason === 'TABLE') {
    const r = resumable(state);
    row('구제금융', `테이블에 ${won(w.onTable)}이 걸려 있어요 · 판이 끝난 뒤 가진 돈이 ${won(w.below)}보다 적으면 받아요`, r ? '테이블로 가기' : '판 끝나면', Boolean(r), resumeTable);
  } else row('구제금융', `가진 돈이 1층 최소 베팅 ${won(w.below)}보다 적을 때 받아요 · 지금 ${won(moneyOf(state))}`, '대상 아님', false, () => {});
  box.append(list);
  return box;
}

export function renderBank(root, state, onChanged) {
  if (!state?.user) { root.textContent = '불러오는 중…'; return; }
  const history = el('section', 'bank-block wallet-history');
  renderLedger(history, state);
  root.replaceChildren(...[
    walletHero(state),
    state.engagement ? payBlock(state, onChanged) : null,
    state.bank?.loans?.length ? loansBlock(state, onChanged) : null,
    history
  ].filter(Boolean));
}
