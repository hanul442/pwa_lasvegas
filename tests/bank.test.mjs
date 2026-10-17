import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newUser, netWorth, debtOf } from '../lib/state.mjs';
import { LENDERS, MAX_LOANS, CREDIT_OVERDUE, CREDIT_ON_TIME, gradeOf, borrow, repay, processLoans, fileBankruptcy, bankruptcyStatus, bankView, lenderOffer } from '../lib/bank.mjs';
import { achievementsView, claimAchievement } from '../lib/achievements.mjs';
import { settleHouseGame } from '../lib/economy.mjs';
import { handleApi } from '../lib/api.mjs';

const DAY = 86_400_000;
// 2026-10-14 12:00 in Seoul.
const NOON = Date.parse('2026-10-14T03:00:00Z');
const lender = slug => LENDERS.find(l => l.slug === slug);

function rookie() {
  const state = defaultState();
  const u = newUser(state, 'rookie', 'ROOKIE');
  return { state, u };
}

test('credit grades run from 1 (best) to 10, and a new player starts at 6', () => {
  assert.equal(gradeOf(1000), 1);
  assert.equal(gradeOf(900), 2);
  assert.equal(gradeOf(500), 6);
  assert.equal(gradeOf(100), 10);
  assert.equal(gradeOf(0), 10);
  const { u } = rookie();
  assert.equal(bankView(u, NOON).credit.grade, 6);
});

test('a 6등급 newcomer is turned away by the bank but not by savings, lenders or sharks', () => {
  const { u } = rookie();
  const offers = Object.fromEntries(LENDERS.map(l => [l.slug, lenderOffer(u, l, NOON)]));
  assert.equal(offers.bank.eligible, false);
  assert.match(offers.bank.reason, /3등급/);
  assert.equal(offers.savings.eligible, true);
  assert.equal(offers.shark.eligible, true);
  // Limits are counted in the Gold Room's 100만 smallest bet.
  assert.equal(offers.savings.limit, 1_000_000 * lender('savings').limitMultiple);
  assert.equal(offers.shark.limit, 1_000_000 * lender('shark').limitMultiple);
});

test('borrowing pays out through the ledger and leaves net worth where it was', () => {
  const { state, u } = rookie();
  const loan = borrow(state, u, { lender: 'savings', amount: 200_000_000, days: 7 }, NOON);
  assert.equal(u.account.available, 200_000_000);
  assert.equal(debtOf(u), 200_000_000);
  assert.equal(netWorth(u), 0);
  assert.equal(loan.rate, 0.022, '7 days costs a little more a day');
  assert.equal(state.ledger.at(-1).type, 'LOAN_DISBURSE');
  assert.equal(u.account.qualifiedPnl, 0, 'a loan is not winnings');
  assert.throws(() => borrow(state, u, { lender: 'savings', amount: 300_100_000, days: 7 }, NOON), /LOAN_OVER_LIMIT/);
  assert.throws(() => borrow(state, u, { lender: 'savings', amount: 10_000_000, days: 5 }, NOON), /INVALID_TERM/);
});

test('no more than five loans at once', () => {
  const { state, u } = rookie();
  for (let k = 0; k < MAX_LOANS; k++) borrow(state, u, { lender: 'shark', amount: 1_000_000, days: 1 }, NOON);
  assert.throws(() => borrow(state, u, { lender: 'shark', amount: 1_000_000, days: 1 }, NOON), /LOAN_REFUSED/);
  assert.match(lenderOffer(u, lender('shark'), NOON).reason, /5건/);
});

test('interest compounds at each Seoul midnight', () => {
  const { state, u } = rookie();
  const loan = borrow(state, u, { lender: 'shark', amount: 100_000_000, days: 14 }, NOON);
  processLoans(state, u, NOON + 6 * 60 * 60 * 1000); // 18:00, same day
  assert.equal(loan.balance, 100_000_000);
  processLoans(state, u, NOON + DAY);
  assert.equal(loan.balance, 125_000_000, '25% a day for a 14-day 사채');
  processLoans(state, u, NOON + 3 * DAY);
  // 195,312,500 owed: the balance shows whole 100만s and the 312,500 waits for the next midnight.
  assert.equal(loan.balance, 195_000_000);
  assert.equal(loan.carry, 312_500);
  assert.equal(bankView(u, NOON + 4 * DAY).loans[0].balance, Math.floor(Math.ceil(195_312_500 * 1.25) / 1_000_000) * 1_000_000, 'the view shows interest still to be booked');
  assert.throws(() => borrow(state, u, { lender: 'shark', amount: 1_500_000, days: 1 }, NOON + 3 * DAY), /AMOUNT_NOT_IN_UNITS/);
});

test('a loan past due is collected from the wallet and costs credit once', () => {
  const { state, u } = rookie();
  const loan = borrow(state, u, { lender: 'savings', amount: 100_000_000, days: 1 }, NOON);
  settleHouseGame(state, u, { game: 'Roulette', stake: 90_000_000, netPnl: -90_000_000, roundId: 'r1' });
  assert.equal(u.account.available, 10_000_000);
  processLoans(state, u, NOON + DAY + 1);
  assert.equal(loan.overdue, true);
  assert.equal(u.credit.score, 500 + CREDIT_OVERDUE);
  assert.equal(u.account.available, 0, 'everything in the wallet went to the lender');
  assert.equal(loan.balance, 102_000_000 - 10_000_000);
  assert.equal(state.ledger.at(-1).type, 'LOAN_COLLECT');
  processLoans(state, u, NOON + DAY + 2);
  assert.equal(u.credit.score, 500 + CREDIT_OVERDUE, 'the penalty is charged once');
  assert.match(lenderOffer(u, lender('savings'), NOON + DAY + 2).reason, /연체/);
  assert.equal(lenderOffer(u, lender('shark'), NOON + DAY + 2).eligible, true, 'a shark lends to anyone');
  // Chips that come in later go to the overdue loan.
  u.account.available = 500_000_000;
  processLoans(state, u, NOON + DAY + 3);
  assert.equal(u.loans.length, 0);
  assert.equal(u.loanHistory[0].outcome, 'COLLECTED');
});

test('repaying on time builds credit, but only for a loan that carried interest, once a day', () => {
  const { state, u } = rookie();
  const quick = borrow(state, u, { lender: 'savings', amount: 10_000_000, days: 3 }, NOON);
  assert.deepEqual(repay(state, u, { loanId: quick.id }, NOON + 1000), { paid: 10_000_000, closed: true, creditGain: 0 });
  const loan = borrow(state, u, { lender: 'savings', amount: 100_000_000, days: 3 }, NOON);
  u.account.available += 50_000_000; // winnings
  const part = repay(state, u, { loanId: loan.id, amount: 40_000_000 }, NOON + DAY);
  assert.equal(part.closed, false);
  assert.equal(loan.balance, 102_000_000 - 40_000_000);
  const full = repay(state, u, { loanId: loan.id }, NOON + DAY + 1000);
  assert.equal(full.closed, true);
  assert.equal(full.creditGain, CREDIT_ON_TIME);
  assert.equal(u.credit.score, 500 + CREDIT_ON_TIME);
  assert.equal(u.bankStats.onTime, 2);
  assert.throws(() => repay(state, u, { loanId: loan.id }, NOON + DAY), /LOAN_NOT_FOUND/);
});

test('bankruptcy wipes the debt, takes the wallet, sinks credit and bars the banks for a while', () => {
  const { state, u } = rookie();
  borrow(state, u, { lender: 'shark', amount: 500_000_000, days: 1 }, NOON);
  borrow(state, u, { lender: 'savings', amount: 300_000_000, days: 7 }, NOON);
  assert.equal(bankruptcyStatus(u, NOON).eligible, false, 'chips still cover the debt');
  settleHouseGame(state, u, { game: 'Roulette', stake: 700_000_000, netPnl: -700_000_000, roundId: 'r1' });
  const status = bankruptcyStatus(u, NOON);
  assert.equal(status.eligible, true);
  const out = fileBankruptcy(state, u, NOON);
  // The wallet is seized, then the day's 구제금융 of 10억 is paid straight in (한서's call).
  assert.deepEqual(out, { discharged: 800_000_000, seized: 100_000_000, bailout: 1_000_000_000 });
  assert.equal(u.account.available, 1_000_000_000);
  assert.equal(state.ledger.at(-1).type, 'WELFARE');
  assert.equal(debtOf(u), 0);
  assert.equal(u.credit.score, 0);
  assert.equal(gradeOf(u.credit.score), 10);
  assert.equal(lenderOffer(u, lender('lender'), NOON + DAY).eligible, false);
  assert.equal(lenderOffer(u, lender('shark'), NOON + DAY).eligible, true);
  assert.ok(state.feed.some(f => f.type === 'PERSONAL_BANKRUPTCY'));
  borrow(state, u, { lender: 'shark', amount: 10_000_000, days: 1 }, NOON + DAY);
  u.account.available = 0;
  assert.match(bankruptcyStatus(u, NOON + 2 * DAY).reason, /7일/);
  // The achievement for starting over can be claimed.
  assert.equal(achievementsView(u).find(a => a.id === 'bankrupt').done, true);
});

test('floors open on net worth, so borrowed chips do not open the next floor', () => {
  const { state, u } = rookie();
  borrow(state, u, { lender: 'shark', amount: 500_000_000, days: 1 }, NOON);
  assert.deepEqual(u.account.unlockedFloors, ['gold-room']);
});

test('achievements pay once, counted in the table base', () => {
  const { state, u } = rookie();
  borrow(state, u, { lender: 'shark', amount: 10_000_000, days: 1 }, NOON);
  const first = claimAchievement(state, u, 'loan-first');
  assert.equal(first.amount, 3 * 1_000_000);
  assert.throws(() => claimAchievement(state, u, 'loan-first'), /ACHIEVEMENT_ALREADY_CLAIMED/);
  assert.throws(() => claimAchievement(state, u, 'grade-1'), /ACHIEVEMENT_NOT_DONE/);
  assert.equal(achievementsView(u).find(a => a.id === 'loan-first').claimed, true);
});

test('the bank over the API: borrow, play, repay, outgrow a floor', async () => {
  let state = defaultState();
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, who = 'rookie') => handleApi({ method, header: n => ({ 'x-player-id': who })[n], body: async () => body ?? {} }, new URL(`http://x${path}`), store, {});
  newUser(state, 'rookie', 'ROOKIE');
  const refused = await call('POST', '/api/bank/borrow', { lender: 'bank', amount: 10_000_000, days: 1 });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error, 'LOAN_REFUSED');
  assert.match(refused.data.detail, /3등급/);
  const got = await call('POST', '/api/bank/borrow', { lender: 'shark', amount: 100_000_000, days: 1 });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.state.bank.loans.length, 1);
  assert.equal(got.data.state.bank.netWorth, 0);
  const loanId = got.data.loan.id;
  assert.equal((await call('POST', '/api/sicbo/play', { stake: 1_000_000, floor: 'gold-room', betType: 'BIG' })).status, 200);
  const paid = await call('POST', '/api/bank/repay', { loanId, amount: 50_000_000 });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.state.bank.loans[0].balance, 50_000_000);
  // The seeded 10억 profile is far too rich for the Gold Room.
  const outgrown = await call('POST', '/api/sicbo/play', { stake: 1_000_000, floor: 'gold-room', betType: 'BIG' }, 'hanseo');
  assert.equal(outgrown.status, 403);
  assert.equal(outgrown.data.error, 'FLOOR_OUTGROWN');
  // Every way to bet is shut, the multi-spot roulette table included.
  const spin = await call('POST', '/api/roulette/spin', { floor: 'gold-room', bets: [{ betType: 'RED', stake: 1_000_000 }] }, 'hanseo');
  assert.equal(spin.status, 403);
  assert.equal(spin.data.error, 'FLOOR_OUTGROWN');
  const support = await call('POST', '/api/support/claim', { kind: 'grant' });
  assert.equal(support.status, 200);
  assert.equal(support.data.claim.amount, 5_000_000);
});

test('going broke at a table pays the 구제금융 on the spot, ten times a day', () => {
  const { state, u } = rookie();
  for (let k = 0; k < 10; k++) {
    u.account.available = 1_000_000;
    settleHouseGame(state, u, { game: 'Roulette', stake: 1_000_000, netPnl: -1_000_000, roundId: `bust-${k}` });
    assert.equal(u.bankruptcies[0].bailout, 1_000_000_000, `bust ${k + 1}`);
    assert.equal(u.account.available, 1_000_000_000);
    u.account.available = 0;
  }
  u.account.available = 1_000_000;
  settleHouseGame(state, u, { game: 'Roulette', stake: 1_000_000, netPnl: -1_000_000, roundId: 'bust-11' });
  assert.equal(u.bankruptcies[0].bailout, 0, 'the eleventh bust of the day gets nothing');
  assert.equal(u.account.available, 0);
});

test('a 구제금융 paid without asking comes back in the state once, for the popup (한서)', async () => {
  let state = defaultState();
  const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
  const call = (method, path, body, who = 'rookie') => handleApi({ method, header: n => ({ 'x-player-id': who })[n], body: async () => body ?? {} }, new URL(`http://x${path}`), store, {});
  const u = newUser(state, 'rookie', 'ROOKIE');
  newUser(state, 'asker', 'ASKER');
  // Asked for at the bank: the player pressed the button, so there is nothing to pop up.
  assert.equal((await call('POST', '/api/support/claim', { kind: 'welfare' }, 'asker')).status, 200);
  assert.equal((await call('GET', '/api/state', null, 'asker')).data.latestBailout, null);
  assert.equal((await call('GET', '/api/state')).data.latestBailout, null);
  u.account.available = 1_000_000;
  settleHouseGame(state, u, { game: 'Roulette', stake: 1_000_000, netPnl: -1_000_000, roundId: 'bust' });
  const bail = (await call('GET', '/api/state')).data.latestBailout;
  assert.equal(bail.amount, 1_000_000_000);
  assert.equal(bail.nth, 1);
  assert.equal(bail.perDay, 10);
  assert.ok(bail.id && bail.createdAt);
});
