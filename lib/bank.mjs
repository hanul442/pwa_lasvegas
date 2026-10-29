// The bank: chips come from loans. Four kinds of lender, from the 1금융권 bank down to the loan
// shark; which ones will lend depends on the player's credit grade. Interest compounds every
// midnight in Seoul. A loan past its due time is collected from the wallet automatically and
// costs credit; a player buried in debt can file for bankruptcy, which clears every loan,
// takes what is left in the wallet and drops credit to the bottom.
import { id, debtOf, netWorth, loanBase } from './state.mjs';
import { monthBoundary } from './rank-tier.mjs';
import { addLedger } from './economy.mjs';
import { MONEY_UNIT, isMoney, floorMoney } from './constants.mjs';
import { dayKey, pushFeed, autoBailout } from './engagement.mjs';

const DAY = 24 * 60 * 60 * 1000;

// limitMultiple: the most one loan can be, in smallest bets of the cheapest table the player may sit at.
export const LENDERS = [
  { slug: 'bank', tier: 1, name: '1금융권', house: 'Vegas Bank', maxGrade: 3, limitMultiple: 1_000, dailyRate: 0.005 },
  { slug: 'savings', tier: 2, name: '2금융권', house: 'Savings & Loan', maxGrade: 6, limitMultiple: 300, dailyRate: 0.02 },
  { slug: 'lender', tier: 3, name: '3금융권', house: 'Easy Credit', maxGrade: 8, limitMultiple: 100, dailyRate: 0.05 },
  { slug: 'shark', tier: 4, name: '사채', house: 'Back Room', maxGrade: 10, limitMultiple: 500, dailyRate: 0.2 }
];
// A longer loan costs a little more each day.
export const TERMS = [
  { days: 1, rateFactor: 1 },
  { days: 3, rateFactor: 1 },
  { days: 7, rateFactor: 1.1 },
  { days: 14, rateFactor: 1.25 }
];
export const MAX_LOANS = 5;
// No new loans in the last days of a month (2026-10-19 경제 점검): the season reset clears debt,
// so a loan taken just before it could be gambled with at no risk.
export const LOAN_FREEZE_DAYS = 3;
export function loanFreezeAt(now = Date.now()) {
  const ends = Date.parse(monthBoundary(now).endsAt);
  return now >= ends - LOAN_FREEZE_DAYS * DAY ? new Date(ends).toISOString() : null;
}

export const CREDIT_START = 500;
export const CREDIT_ON_TIME = 40;
export const CREDIT_OVERDUE = -120;
export const BANKRUPTCY_BAN_MS = 3 * DAY;
export const BANKRUPTCY_COOLDOWN_MS = 7 * DAY;

// Score 0–1000; 1등급 is the best, 10등급 the worst. A new player starts at 500 (6등급).
export function gradeOf(score) { return Math.max(1, Math.min(10, 11 - Math.floor(score / 100))); }

function credit(user) {
  if (!user.credit || typeof user.credit !== 'object') user.credit = { score: CREDIT_START };
  return user.credit;
}
function stats(user) {
  if (!user.bankStats || typeof user.bankStats !== 'object') user.bankStats = { loans: 0, onTime: 0, late: 0, collected: 0, bankruptcies: 0, borrowed: 0, interestPaid: 0, lenders: [] };
  return user.bankStats;
}
function loans(user) {
  if (!Array.isArray(user.loans)) user.loans = [];
  return user.loans;
}
function moveCredit(user, delta) {
  const c = credit(user);
  c.score = Math.max(0, Math.min(1000, c.score + delta));
  return c.score;
}

const dayStart = key => Date.parse(`${key}T00:00:00Z`) - 9 * 60 * 60 * 1000;

// Compounds a loan for every Seoul midnight since it was last brought up to date. The balance owed
// is always whole 100만s (한서's call); interest below 100만 waits in `carry` until it makes one.
export function accrue(loan, now = Date.now()) {
  const today = dayKey(now);
  let days = Math.round((dayStart(today) - dayStart(loan.accruedDay)) / DAY);
  if (!(days > 0)) return 0;
  days = Math.min(days, 400);
  const before = loan.balance + (loan.carry || 0);
  let exact = before;
  for (let k = 0; k < days; k++) exact = Math.ceil(exact * (1 + loan.rate));
  loan.balance = Math.max(MONEY_UNIT, floorMoney(exact));
  loan.carry = exact - loan.balance;
  loan.accruedDay = today;
  loan.interest = (loan.interest || 0) + (exact - before);
  return days;
}

function closeLoan(user, loan, outcome, now) {
  user.loans = loans(user).filter(l => l !== loan);
  const history = Array.isArray(user.loanHistory) ? user.loanHistory : [];
  history.unshift({ id: loan.id, lender: loan.lender, principal: loan.principal, interest: loan.interest || 0, outcome, closedAt: new Date(now).toISOString() });
  user.loanHistory = history.slice(0, 20);
}

// Interest, overdue penalties and collection for one player. Safe to run on every request.
export function processLoans(state, user, now = Date.now()) {
  const list = loans(user);
  if (!list.length) return;
  for (const loan of [...list]) {
    accrue(loan, now);
    if (now < Date.parse(loan.dueAt)) continue;
    if (!loan.overdue) {
      loan.overdue = true;
      moveCredit(user, CREDIT_OVERDUE);
      stats(user).late++;
    }
    // Collection takes whole 100만s, or the whole debt when the player has it.
    const take = user.account.available >= loan.balance ? loan.balance : floorMoney(user.account.available);
    if (take > 0) {
      addLedger(state, user, { type: 'LOAN_COLLECT', amount: -take, referenceType: 'LOAN', referenceId: loan.id, metadata: { lender: loan.lender } });
      loan.balance -= take;
      loan.collected = (loan.collected || 0) + take;
      stats(user).collected += take;
    }
    if (loan.balance === 0) closeLoan(user, loan, 'COLLECTED', now);
  }
}

export function processAllLoans(state, now = Date.now()) {
  for (const user of Object.values(state.users || {})) if (Array.isArray(user.loans) && user.loans.length) processLoans(state, user, now);
}

function banned(user, now) { return user.credit?.bannedUntil && now < Date.parse(user.credit.bannedUntil); }

export function lenderOffer(user, lender, now = Date.now()) {
  const grade = gradeOf(credit(user).score);
  const limit = loanBase(user) * lender.limitMultiple;
  let reason = null;
  if (loanFreezeAt(now)) reason = `월말 ${LOAN_FREEZE_DAYS}일은 새 대출이 안 돼요 · 다음 시즌에 다시 열려요`;
  else if (loans(user).length >= MAX_LOANS) reason = `대출은 최대 ${MAX_LOANS}건까지예요`;
  else if (lender.tier < 4 && banned(user, now)) reason = '파산 후 3일 동안은 제도권 대출이 막혀요';
  else if (lender.tier < 4 && loans(user).some(l => l.overdue)) reason = '연체 중이라 빌려주지 않아요';
  else if (grade > lender.maxGrade) reason = `신용 ${lender.maxGrade}등급 이상만 받아요`;
  return { ...lender, limit, eligible: !reason, reason };
}

export function borrow(state, user, { lender: slug, amount, days }, now = Date.now()) {
  const lender = LENDERS.find(l => l.slug === slug);
  if (!lender) throw new Error('LENDER_NOT_FOUND');
  const term = TERMS.find(t => t.days === Number(days));
  if (!term) throw new Error('INVALID_TERM');
  processLoans(state, user, now);
  const offer = lenderOffer(user, lender, now);
  if (!offer.eligible) throw Object.assign(new Error('LOAN_REFUSED'), { detail: offer.reason });
  const principal = Number(amount);
  if (!Number.isSafeInteger(principal) || principal <= 0) throw new Error('INVALID_AMOUNT');
  if (principal > offer.limit) throw new Error('LOAN_OVER_LIMIT');
  if (!isMoney(principal)) throw new Error('AMOUNT_NOT_IN_UNITS');
  const loan = {
    id: id('loan'), lender: lender.slug, principal, balance: principal, interest: 0,
    rate: Math.round(lender.dailyRate * term.rateFactor * 10_000) / 10_000, days: term.days,
    createdAt: new Date(now).toISOString(), dueAt: new Date(now + term.days * DAY).toISOString(),
    accruedDay: dayKey(now), overdue: false
  };
  loans(user).push(loan);
  const s = stats(user);
  s.loans++; s.borrowed += principal;
  if (!s.lenders.includes(lender.slug)) s.lenders.push(lender.slug);
  addLedger(state, user, { type: 'LOAN_DISBURSE', amount: principal, referenceType: 'LOAN', referenceId: loan.id, metadata: { lender: lender.slug, days: term.days } });
  return loan;
}

export function repay(state, user, { loanId, amount }, now = Date.now()) {
  processLoans(state, user, now);
  const loan = loans(user).find(l => l.id === loanId);
  if (!loan) throw new Error('LOAN_NOT_FOUND');
  const pay = amount == null ? loan.balance : Number(amount);
  if (!Number.isSafeInteger(pay) || pay <= 0) throw new Error('INVALID_AMOUNT');
  if (pay > loan.balance) throw new Error('REPAY_OVER_BALANCE');
  if (!isMoney(pay) && pay !== loan.balance) throw new Error('AMOUNT_NOT_IN_UNITS');
  if (pay > user.account.available) throw new Error('INSUFFICIENT_BANKROLL');
  addLedger(state, user, { type: 'LOAN_REPAY', amount: -pay, referenceType: 'LOAN', referenceId: loan.id, metadata: { lender: loan.lender } });
  loan.balance -= pay;
  let creditGain = 0;
  if (loan.balance === 0) {
    const s = stats(user);
    s.interestPaid += loan.interest || 0;
    if (!loan.overdue) {
      s.onTime++;
      // Only a loan that carried interest through a midnight builds credit, at most once a day,
      // so borrowing and repaying a few won on the spot doesn't farm a better grade.
      const c = credit(user);
      if ((loan.interest || 0) > 0 && c.lastGainDay !== dayKey(now)) {
        creditGain = CREDIT_ON_TIME;
        moveCredit(user, creditGain);
        c.lastGainDay = dayKey(now);
      }
    }
    closeLoan(user, loan, loan.overdue ? 'LATE' : 'ON_TIME', now);
  }
  return { paid: pay, closed: loan.balance === 0, creditGain };
}

export function bankruptcyStatus(user, now = Date.now()) {
  const debt = debtOf(user);
  const held = user.account.available + user.account.locked;
  const last = user.credit?.lastBankruptcyAt ? Date.parse(user.credit.lastBankruptcyAt) : 0;
  const cooldownUntil = last ? new Date(last + BANKRUPTCY_COOLDOWN_MS).toISOString() : null;
  let reason = null;
  if (debt === 0) reason = '갚을 빚이 없어요';
  else if (debt <= held) reason = '가진 칩으로 빚을 다 갚을 수 있어요';
  else if (user.account.locked > 0) reason = '테이블에서 일어난 뒤에 신청할 수 있어요';
  else if (last && now < last + BANKRUPTCY_COOLDOWN_MS) reason = '파산은 7일에 한 번만 신청할 수 있어요';
  return { eligible: !reason, reason, debt, cooldownUntil };
}

export function fileBankruptcy(state, user, now = Date.now()) {
  processLoans(state, user, now);
  const status = bankruptcyStatus(user, now);
  if (!status.eligible) throw Object.assign(new Error('BANKRUPTCY_NOT_AVAILABLE'), { detail: status.reason });
  const seized = user.account.available;
  if (seized > 0) addLedger(state, user, { type: 'BANKRUPTCY_SEIZURE', amount: -seized, referenceType: 'BANKRUPTCY', metadata: { debt: status.debt } });
  for (const loan of [...loans(user)]) closeLoan(user, loan, 'DISCHARGED', now);
  user.loans = [];
  const c = credit(user);
  c.score = 0;
  c.lastBankruptcyAt = new Date(now).toISOString();
  c.bannedUntil = new Date(now + BANKRUPTCY_BAN_MS).toISOString();
  stats(user).bankruptcies++;
  // The ledger row above already moved the chips; this zero row records the debt that was wiped.
  addLedger(state, user, { type: 'DEBT_DISCHARGED', amount: 0, referenceType: 'BANKRUPTCY', metadata: { debt: status.debt } });
  pushFeed(state, { type: 'PERSONAL_BANKRUPTCY', actorId: user.id, amount: status.debt });
  // A clean slate comes with the day's 구제금융, paid straight in (한서's call).
  const bailout = autoBailout(state, user, now);
  return { discharged: status.debt, seized, bailout };
}

export function bankView(user, now = Date.now()) {
  const c = credit(user);
  const list = loans(user).map(l => {
    const copy = { ...l };
    accrue(copy, now);
    const lender = LENDERS.find(x => x.slug === l.lender);
    return { ...copy, lenderName: lender?.name, house: lender?.house, overdue: copy.overdue || now >= Date.parse(copy.dueAt) };
  });
  const debt = list.reduce((s, l) => s + l.balance, 0);
  return {
    credit: { score: c.score, grade: gradeOf(c.score), bannedUntil: c.bannedUntil ?? null },
    loans: list,
    debt,
    netWorth: user.account.available + user.account.locked - debt,
    maxLoans: MAX_LOANS,
    base: loanBase(user),
    terms: TERMS,
    lenders: LENDERS.map(l => lenderOffer(user, l, now)),
    bankruptcy: bankruptcyStatus(user, now),
    stats: { ...stats(user) },
    history: (user.loanHistory || []).slice(0, 10)
  };
}
