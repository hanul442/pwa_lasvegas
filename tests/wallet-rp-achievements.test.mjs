// 지갑 정리 (2026-10-29): the bank's achievements are retired, floor achievements follow RP tiers,
// and RP achievements (tier, 승급전, weekly league) are kept for good in user.rpRecord.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultState, newUser } from '../lib/state.mjs';
import { addLedger } from '../lib/economy.mjs';
import { noteRp, rpOf, rpRecordOf, rpBestTier } from '../lib/rank-points.mjs';
import { achievementsView, claimAchievement } from '../lib/achievements.mjs';
import { joinLeagues, settleLeagues } from '../lib/rank-league.mjs';

const view = u => Object.fromEntries(achievementsView(u).map(a => [a.id, a]));

test('a rich new player gets no floor achievements; RP opens them', () => {
  const state = defaultState();
  const u = newUser(state, 'u', 'UUU');
  addLedger(state, u, { type: 'ADMIN_GRANT', amount: 500e9 });
  let v = view(u);
  assert.equal(v['floor-high-limit'].done, false, 'net worth no longer opens floor achievements');
  assert.equal(v['rp-bronze'].done, false);
  noteRp(u, { game: 'Baccarat', stake: 1e7, netPnl: 1e7 });
  u.rp.points = u.rp.peak = 360; // gold: High Limit and Salon Privé
  noteRp(u, { game: 'Baccarat', stake: 1e7, netPnl: 0 });
  v = view(u);
  assert.equal(v['rp-bronze'].done, true);
  assert.equal(v['floor-high-limit'].done, true);
  assert.equal(v['floor-salon-prive'].done, true);
  assert.equal(v['floor-penthouse'].done, false);
  assert.equal(rpRecordOf(u).tier, 3);
  // Dropping back (a season's carry) keeps what was reached.
  u.rp.points = u.rp.peak = 0;
  assert.equal(rpBestTier(u), 3);
  assert.equal(view(u)['floor-salon-prive'].done, true);
  assert.ok(claimAchievement(state, u, 'floor-high-limit').amount > 0);
});

test('bank achievements are hidden unless already claimed, and cannot be claimed', () => {
  const state = defaultState();
  const u = newUser(state, 'u', 'UUU');
  assert.equal(view(u)['loan-first'], undefined);
  u.bankStats = { loans: 1 };
  assert.throws(() => claimAchievement(state, u, 'loan-first'), /ACHIEVEMENT_NOT_FOUND/);
  u.achievements = ['loan-first'];
  assert.equal(view(u)['loan-first'].claimed, true, 'one taken before the bank closed stays');
});

test('승급전 wins and league promotions are counted for good', () => {
  const state = defaultState();
  const u = newUser(state, 'u', 'UUU');
  noteRp(u, { game: 'Baccarat', stake: 1e7, netPnl: 1e7 });
  u.rp.points = 95;
  u.rp.promo = { active: true, target: 'bronze', wins: 2, losses: 0, minStake: 1e7, fee: 0 };
  noteRp(u, { game: 'Baccarat', stake: 1e7, netPnl: 1e7 });
  assert.equal(rpRecordOf(u).promoWins, 1);
  assert.equal(view(u)['promo-1'].done, true);

  const MON = Date.parse('2026-11-02T01:00:00Z'), DAY = 86_400_000;
  rpOf(u, MON).points = 2300; // 레전드: no ceiling, so the big week counts in full
  for (let i = 0; i < 40; i++) noteRp(u, { stake: 1e6, netPnl: 30e6 }, MON + (i % 7) * DAY); // a big week
  joinLeagues(state, MON + 6 * DAY);
  settleLeagues(state, MON + 7 * DAY + 1000);
  const r = rpRecordOf(u);
  assert.equal(r.leagueUps, 1, 'a big week tops the group');
  assert.equal(r.podiums, 1);
  assert.equal(r.league, 1);
  const v = view(u);
  assert.equal(v['league-up'].done, true);
  assert.equal(v['league-podium'].done, true);
  assert.equal(v['league-elite'].done, false);
});

test('the wallet page shows only money, free pay and chip history; no bank or old-economy text', async () => {
  const read = p => readFile(new URL(`../public/${p}`, import.meta.url), 'utf8');
  const [bank, html, app] = await Promise.all([read('js/bank.js'), read('index.html'), read('app.js')]);
  assert.doesNotMatch(html, /모자라면 빌려요|이번 달 최고 순자산|그 층 입장권/);
  assert.match(html, /<h1 id="bank-title">지갑<\/h1>/);
  assert.doesNotMatch(bank, /borrowSheet|bankruptcySheet|lendersBlock|신용 <b>/);
  assert.match(bank, /renderLedger/);
  assert.doesNotMatch(app, /data-ledger|renderBankFloor/);
});
