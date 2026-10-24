// The bank screen, simplest first: what I hold and owe, the free money I can take now, my
// loans, the four lenders as one-line rows, bankruptcy, and past loans folded away. Every number comes from the server (lib/bank.mjs).
import { api, errorMessage } from './api.js';
import { el, formatCH, formatMoney, sound } from './fx.js';
import { chipsToWallet, claimDaily } from './lounge.js';
import { errorToast } from './notice.js';

const DAY = 86_400_000;
const pct = rate => `${+(rate * 100).toFixed(2)}%`;
const won = n => `${formatCH(n)}원`;

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

function borrowSheet(state, offer, onChanged) {
  const bank = state.bank;
  let days = 7, amount = offer.limit;
  openSheet({
    eyebrow: `${offer.name} · ${offer.house}`,
    title: `최대 ${won(offer.limit)}까지 빌려줘요`,
    build(body, setGo) {
      const preview = el('p', 'bank-preview');
      const field = amountField(offer.limit, amount, v => { amount = v; draw(); });
      const termLabel = el('p', 'bank-label', '상환 기한');
      const terms = el('div', 'segmented bank-terms');
      terms.setAttribute('role', 'radiogroup');
      terms.setAttribute('aria-label', '상환 기한');
      const buttons = bank.terms.map(t => {
        const b = el('button', 'segment', `${t.days}일`);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => { days = t.days; draw(); });
        terms.append(b);
        return [t, b];
      });
      body.append(field.node, termLabel, terms, preview);
      function draw() {
        const term = bank.terms.find(t => t.days === days);
        const rate = Math.round(offer.dailyRate * term.rateFactor * 10_000) / 10_000;
        buttons.forEach(([t, b]) => b.setAttribute('aria-checked', String(t.days === days)));
        let owe = amount;
        for (let k = 0; k < days; k++) owe = Math.ceil(owe * (1 + rate));
        owe = Math.max(UNIT, Math.floor(owe / UNIT) * UNIT);
        preview.innerHTML = `하루 <b>${pct(rate)}</b> 복리 · 자정마다 이자가 붙어요<br>${days}일 뒤 갚을 돈 약 <b>${won(owe)}</b>. 못 갚으면 들어오는 칩에서 자동으로 가져가고 신용이 떨어져요.`;
        const bad = !inUnits(amount) || amount > offer.limit;
        setGo({ text: bad ? (amount > offer.limit ? '한도를 넘었어요' : amount > 0 ? '100만 원 단위로 넣어 주세요' : '금액을 넣어 주세요') : `${won(amount)} 빌리기`, disabled: bad });
      }
      return draw;
    },
    async confirm(go) {
      const out = await api.borrow(offer.slug, amount, days);
      sound.chips(5);
      await chipsToWallet(go, amount);
      onChanged(out.state);
    }
  });
}

function repaySheet(state, loan, onChanged) {
  const available = state.user.account.available;
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
        setGo({ text: bad ? (max <= 0 ? '갚을 칩이 없어요' : amount > max ? `최대 ${won(max)}까지 갚을 수 있어요` : '100만 원 단위로 넣어 주세요') : amount === loan.balance ? `${won(amount)} 다 갚기` : `${won(amount)} 갚기`, disabled: bad });
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

function bankruptcySheet(state, onChanged) {
  const bank = state.bank;
  openSheet({
    eyebrow: '개인 파산',
    title: `빚 ${won(bank.debt)}을 없앨까요?`,
    danger: true,
    build(body, setGo) {
      const welfare = state.engagement?.support?.welfare;
      body.innerHTML = `<ul class="bank-terms-list">
        <li>모든 대출이 사라져요.</li>
        <li>지갑에 남은 ${won(state.user.account.available)}은 압류돼요.</li>
        <li>신용이 10등급(0점)으로 떨어지고, 3일 동안 1·2·3금융권을 쓸 수 없어요. 사채는 빌려줘요.</li>
        <li>파산은 7일에 한 번만 신청할 수 있어요.</li>
        ${welfare && !welfare.claimed ? `<li>파산하면 구제금융 ${won(welfare.amount)}이 바로 들어와요 (하루 ${welfare.perDay}번까지).</li>` : ''}</ul>`;
      setGo({ text: '파산 신청하기' });
    },
    async confirm(go) {
      const out = await api.bankruptcy();
      sound.lose?.();
      if (out.result?.bailout) await chipsToWallet(go, out.result.bailout);
      onChanged(out.state);
    }
  });
}

function creditBlock(state) {
  const b = state.bank, a = state.user.account;
  const box = el('section', 'bank-hero');
  const score = Math.max(0, Math.min(1000, b.credit.score));
  const ban = b.credit.bannedUntil && Date.parse(b.credit.bannedUntil) > Date.now()
    ? `<p class="bank-flag">파산 후 ${Math.ceil((Date.parse(b.credit.bannedUntil) - Date.now()) / 3_600_000)}시간 동안 제도권 대출이 막혀 있어요</p>` : '';
  box.innerHTML = `
    <dl class="bank-sums">
      <div><dt>지갑</dt><dd>${won(a.available)}</dd></div>
      <div><dt>빚</dt><dd class="${b.debt > 0 ? 'neg' : ''}">${b.debt > 0 ? '-' : ''}${won(b.debt)}</dd></div>
      <div><dt>순자산</dt><dd>${won(b.netWorth)}</dd></div>
    </dl>
    ${heldLine(state)}
    <div class="bank-grade"><span>신용 <b>${b.credit.grade}등급</b></span><span class="bank-score" aria-label="신용 점수 ${score}점, 1000점 만점"><i style="width:${score / 10}%"></i></span><small>${score} / 1000</small></div>${ban}`;
  const go = box.querySelector('[data-held-go]');
  if (go) go.addEventListener('click', () => resumeTable(go));
  return box;
}

// Chips still on a table (a round not finished, a poker seat not left) are the player's but not in
// the wallet: the top bar shows the wallet, so the bank says where the rest is and how it comes back.
const GAME_NAMES = { blackjack: '블랙잭', matgo: '맞고', gostop: '고스톱', seotda: '섯다', poker: '홀덤', sevenpoker: '7포커' };
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

function loansBlock(state, onChanged) {
  const b = state.bank;
  const box = el('section', 'bank-block');
  box.innerHTML = `<header class="lounge-head"><h2>내 대출</h2><small>${b.loans.length} / ${b.maxLoans}건</small></header>`;
  if (!b.loans.length) { box.append(el('p', 'lounge-note', '지금은 빚이 없어요.')); return box; }
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

function lendersBlock(state, onChanged) {
  const b = state.bank;
  const box = el('section', 'bank-block');
  box.innerHTML = `<header class="lounge-head"><h2>빌리기</h2><small>제때 갚으면 신용이 올라요</small></header>`;
  const list = el('ul', 'lender-list');
  for (const offer of b.lenders) {
    const li = el('li');
    const card = el('button', `lender lender--${offer.slug}`);
    card.type = 'button';
    card.disabled = !offer.eligible;
    card.innerHTML = `<span class="lender-main"><strong>${offer.house}</strong>
      <span class="lender-terms"><b>하루 ${pct(offer.dailyRate)}</b><span>최대 ${won(offer.limit)}</span></span>
      ${offer.eligible ? '' : `<small>${offer.reason}</small>`}</span><span class="lender-go" aria-hidden="true">${offer.eligible ? '빌리기' : `${offer.maxGrade}등급↑`}</span>`;
    card.setAttribute('aria-label', `${offer.house}, 하루 ${pct(offer.dailyRate)}, 최대 ${won(offer.limit)}${offer.eligible ? ', 빌리기' : `, ${offer.reason}`}`);
    card.addEventListener('click', () => borrowSheet(state, offer, onChanged));
    li.append(card);
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
  if (sup.grant && !sup.grant.claimed) free.push(['grant', `정부 지원금 +${formatCH(sup.grant.amount)}`]);
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
  box.innerHTML = `<header class="lounge-head"><h2>무료로 받기</h2><small>갚을 필요 없는 돈</small></header>`;
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
  if (w.claimed) row('구제금융', `오늘 ${w.perDay}번 다 받았어요 · 내일 다시 받을 수 있어요`, '오늘 다 받음', false, () => {});
  else if (w.qualified) row('구제금융', `칩 ${won(w.below)} 미만일 때 · 오늘 ${left}번 남음`, `+${formatCH(w.amount)}`, true, claim('welfare'));
  else if (w.reason === 'TABLE') {
    const r = resumable(state);
    row('구제금융', `테이블에 ${won(w.onTable)}이 걸려 있어요 · 판이 끝난 뒤 칩이 ${won(w.below)} 밑이면 받아요`, r ? '테이블로 가기' : '판 끝나면', Boolean(r), resumeTable);
  } else row('구제금융', `칩이 ${won(w.below)} 미만일 때 받아요 · 지금 지갑에 ${won(state.user.account.available)}`, '대상 아님', false, () => {});
  box.append(list);
  return box;
}

function bankruptcyBlock(state, onChanged) {
  const b = state.bank;
  if (!b.debt) return null;
  const box = el('section', 'bank-block bank-block--bust');
  box.innerHTML = `<header class="lounge-head"><h2>파산 신청</h2><small>빚이 가진 칩보다 많을 때</small></header><p class="lounge-note">${b.bankruptcy.eligible ? '빚을 모두 없애는 대신 지갑은 압류되고 신용이 바닥으로 떨어져요.' : b.bankruptcy.reason + '.'}</p>`;
  const btn = el('button', 'pill-button pill-button--danger', '파산 신청');
  btn.type = 'button';
  btn.disabled = !b.bankruptcy.eligible;
  btn.addEventListener('click', () => bankruptcySheet(state, onChanged));
  box.append(btn);
  return box;
}

const OUTCOME = { ON_TIME: '완납', LATE: '연체 후 완납', COLLECTED: '자동 회수', DISCHARGED: '파산 면책' };
function historyBlock(state) {
  const rows = state.bank.history || [];
  if (!rows.length) return null;
  const box = el('details', 'bank-block bank-history');
  box.innerHTML = `<summary class="lounge-head"><h2>지난 대출</h2><small>${rows.length}건</small></summary>`;
  const list = el('ul', 'ledger');
  for (const h of rows) {
    const lender = state.bank.lenders.find(l => l.slug === h.lender);
    list.append(el('li', '', `<span>${lender?.house || h.lender} · ${OUTCOME[h.outcome] || h.outcome}</span><b>${won(h.principal)}${h.interest ? ` <small>이자 ${won(h.interest)}</small>` : ''}</b>`));
  }
  box.append(list);
  return box;
}

export function renderBank(root, state, onChanged) {
  if (!state?.bank) { root.textContent = '불러오는 중…'; return; }
  root.replaceChildren(...[
    creditBlock(state),
    payBlock(state, onChanged),
    state.bank.loans.length ? loansBlock(state, onChanged) : null,
    lendersBlock(state, onChanged),
    bankruptcyBlock(state, onChanged),
    historyBlock(state)
  ].filter(Boolean));
}
