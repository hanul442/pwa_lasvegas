// 칩 내역 on the profile: every ledger row the server sends (the latest 50), grouped by day, each
// with its time, what it was (the game in Korean), the amount and the balance after it.
// A filter narrows it to 게임, 보너스 or 은행.
import { el, formatCH } from './fx.js';
import { gameName } from './names.js';

const LABEL = { INITIAL_GRANT: '시작 칩', GAME_WIN: '승리', GAME_LOSS: '패배', GAME_PUSH: '무승부', BET_LOCK: '베팅', BET_SETTLE: '정산', AUTO_RECHARGE: '칩 충전', BANKRUPTCY: '파산', ADMIN_GRANT: '지급', ADMIN_DEDUCT: '회수', DAILY_BONUS: '일급', MISSION_REWARD: '미션 보상', SEASON_REWARD: '시즌 보상', RESCUE_GRANT: '럭키 카드', JACKPOT_WIN: '잭팟', EVENT_BONUS: '이벤트 보너스', LOAN_DISBURSE: '대출', LOAN_REPAY: '상환', LOAN_COLLECT: '자동 회수', BANKRUPTCY_SEIZURE: '파산 압류', DEBT_DISCHARGED: '빚 탕감', WEEKLY_PAY: '주급', MONTHLY_PAY: '월급', GOV_GRANT: '정부 지원금', WELFARE: '구제금융', ACHIEVEMENT: '업적', CHALLENGE_PRIZE: '대결 상금', PURCHASE: '구매', RESALE: '되팔기', LUXURY_REFUND: '사치품 환불', SEASON_RESET: '시즌 초기화', INVITE_REWARD: '친구 초대' };
const BANK = new Set(['LOAN_DISBURSE', 'LOAN_REPAY', 'LOAN_COLLECT', 'BANKRUPTCY', 'BANKRUPTCY_SEIZURE', 'DEBT_DISCHARGED']);
const FILTERS = [['all', '전체'], ['game', '게임'], ['bonus', '보너스'], ['bank', '은행']];

export function ledgerKind(x) {
  if (BANK.has(x.type)) return 'bank';
  if (/^(GAME|BET)_/.test(x.type) || x.type === 'JACKPOT_WIN') return 'game';
  return 'bonus';
}

const TZ = 'Asia/Seoul';
const dayOf = iso => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: TZ });
const timeOf = iso => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const signed = n => `${n > 0 ? '+' : ''}${formatCH(n)}`;

let filter = 'all';

export function renderLedger(box, state) {
  const rows = state?.ledger || [];
  const head = el('h2', 'sub-head', `칩 내역 <small>최근 ${rows.length}건</small>`);
  const seg = el('div', 'segmented ledger-filter');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', '칩 내역 종류');
  const list = el('ul', 'ledger');
  const paint = () => {
    seg.querySelectorAll('.segment').forEach(b => b.setAttribute('aria-checked', String(b.dataset.filter === filter)));
    const shown = rows.filter(x => filter === 'all' || ledgerKind(x) === filter);
    const items = [];
    let day = '';
    for (const x of shown) {
      const d = x.createdAt ? dayOf(x.createdAt) : '';
      if (d !== day) { day = d; items.push(el('li', 'ledger-day', d)); }
      const li = el('li', 'ledger-row');
      // A locked game's settle row hands the stake back as well; its result line says what was won or lost.
      const pnl = /^GAME_/.test(x.type) && Number.isFinite(x.rawPnlDelta) && x.rawPnlDelta !== x.amount ? x.rawPnlDelta : null;
      const what = `${LABEL[x.type] || x.type}${x.metadata?.game ? ` · ${gameName(x.metadata.game)}` : ''}${x.referenceType === 'SHOP' && x.metadata?.name ? ` · ${x.metadata.name}` : ''}${pnl !== null ? ` <small>손익 ${signed(pnl)}</small>` : ''}`;
      li.innerHTML = `<time datetime="${x.createdAt || ''}">${x.createdAt ? timeOf(x.createdAt) : ''}</time><span class="ledger-what">${what}</span><span class="ledger-amt"><b class="${x.amount > 0 ? 'pos' : x.amount < 0 ? 'neg' : ''}">${signed(x.amount)}</b>${Number.isFinite(x.availableAfter) ? `<small>잔액 ${formatCH(x.availableAfter)}</small>` : ''}</span>`;
      items.push(li);
    }
    if (!items.length) items.push(el('li', '', `<span>${rows.length ? '이 종류의 기록은 아직 없어요' : '아직 기록이 없어요'}</span>`));
    list.replaceChildren(...items);
  };
  seg.append(...FILTERS.map(([key, label]) => {
    const b = el('button', 'segment', label);
    b.type = 'button';
    b.dataset.filter = key;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { filter = key; paint(); });
    return b;
  }));
  paint();
  box.replaceChildren(head, seg, list);
}
