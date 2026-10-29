// The economy before the RP season (2026-10-29): see tests/legacy-economy.mjs.
import './legacy-economy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, netWorth } from '../lib/state.mjs';
import { addLedger } from '../lib/economy.mjs';
import { tierFor, monthBoundary, rankView, rankStandings, settleFinishedRankSeason, RANK_TIERS } from '../lib/rank-season.mjs';

const OCT = Date.parse('2026-10-20T03:00:00Z'), NOV = Date.parse('2026-11-01T00:30:00+09:00');
const at = (t, fn) => { const real = Date.now; Date.now = () => t; try { return fn(); } finally { Date.now = real; } };

test('tiers climb by peak net worth, ten of them from 아이언 to 레전드', () => {
  assert.equal(RANK_TIERS.length, 10);
  assert.equal(tierFor(0).id, 'iron');
  assert.equal(tierFor(99_999_999).id, 'iron');
  assert.equal(tierFor(100_000_000).id, 'bronze');
  assert.equal(tierFor(999_999_999).id, 'bronze');
  assert.equal(tierFor(1_000_000_000).id, 'silver');
  assert.equal(tierFor(15_000_000_000).id, 'gold');
  assert.equal(tierFor(2_886e8).id, 'platinum');
  assert.equal(tierFor(5e11).id, 'emerald');
  assert.equal(tierFor(1e12).id, 'diamond');
  assert.equal(tierFor(5e13).id, 'grandmaster');
  assert.equal(tierFor(1e14).id, 'legend');
  for (let i = 1; i < RANK_TIERS.length; i++) assert.ok(RANK_TIERS[i].min > RANK_TIERS[i - 1].min);
  assert.equal(monthBoundary(Date.parse('2026-10-31T14:59:00Z')).id, 'rank-2026-10', '23:59 on the 31st in Seoul');
  assert.equal(monthBoundary(Date.parse('2026-10-31T15:00:00Z')).id, 'rank-2026-11', 'midnight in Seoul');
  assert.match(monthBoundary(OCT).name, /프리시즌/);
});

test('a month closes once: badges for the tier reached, then everyone starts again from nothing', () => {
  const state = defaultState();
  const u = state.users.hanseo, m = state.users.min;
  at(OCT, () => {
    settleFinishedRankSeason(state); // first look: the casino counts from October
    addLedger(state, u, { type: 'ADMIN_GRANT', amount: 300e9 });
    addLedger(state, u, { type: 'ADMIN_DEDUCT', amount: -250e9 }); // lost most of it: the peak stays
    u.loans = [{ id: 'l1', balance: 5e8 }];
  });
  const view = at(OCT, () => rankView(state, u));
  assert.equal(view.tier, 'platinum');
  assert.equal(view.next.id, 'emerald');
  assert.ok(view.season.preseason);
  assert.equal(at(OCT, () => rankStandings(state))[0].id, 'hanseo', 'demo players never rank');
  assert.ok(!at(OCT, () => rankStandings(state)).some(r => r.id === m.id));

  const locked = u.account.locked;
  const closed = at(NOV, () => settleFinishedRankSeason(state));
  assert.equal(closed.id, 'rank-2026-10');
  assert.equal(closed.podium[0].userId, 'hanseo');
  assert.equal(closed.podium[0].tier, 'platinum');
  assert.equal(u.badges[0].kind, 'RANK');
  assert.equal(u.badges[0].tier, 'platinum');
  assert.equal(u.badges[0].rank, 1);
  assert.equal(u.rankHistory[0].tier, 'platinum');
  assert.equal(u.rank.best.tier, 'platinum');
  // The fresh start: wallet and debt gone, floors shut down to the Gold Room.
  assert.equal(u.account.available, 0);
  assert.equal(u.account.locked, locked, 'chips on a table are left to come home');
  assert.deepEqual(u.loans, []);
  assert.deepEqual(u.account.unlockedFloors, ['gold-room']);
  assert.equal(state.ledger.at(-1).type, 'SEASON_RESET');
  assert.equal(at(NOV, () => rankView(state, u)).tier, 'iron');
  assert.equal(at(NOV, () => rankView(state, u)).season.preseason, false);
  // Only once.
  assert.equal(at(NOV + 3600e3, () => settleFinishedRankSeason(state)), null);
  assert.equal(state.users.min.badges?.some(b => b.kind === 'RANK') ?? false, false, 'demo players get no badge');
  assert.equal(netWorth(u), u.account.locked);
});

test('a fresh casino first seen in a later month closes nothing', () => {
  const state = defaultState();
  state.users.hanseo.account.available = 5e9;
  assert.equal(at(NOV, () => settleFinishedRankSeason(state)), null);
  assert.equal(state.users.hanseo.account.available, 5e9);
});

test('a peak noted in a new month before the close still counts for the old month', () => {
  const state = defaultState();
  const u = state.users.hanseo;
  at(OCT, () => { settleFinishedRankSeason(state); addLedger(state, u, { type: 'ADMIN_GRANT', amount: 20e9 }); });
  // The new month's first balance change notes a peak before anything settles (a read path).
  at(NOV, () => addLedger(state, u, { type: 'ADMIN_GRANT', amount: 1e6 }));
  const closed = at(NOV, () => settleFinishedRankSeason(state));
  assert.equal(closed.podium[0].tier, 'gold');
});

test('the month that ended is due until closed, and the results show what the fresh start took', async () => {
  const { rankSeasonDue } = await import('../lib/rank-season.mjs');
  const state = defaultState();
  const u = state.users.hanseo;
  at(OCT, () => { settleFinishedRankSeason(state); addLedger(state, u, { type: 'ADMIN_GRANT', amount: 20e9 }); });
  assert.equal(rankSeasonDue(state, OCT), false);
  assert.equal(rankSeasonDue(state, NOV), true);
  const chips = u.account.available;
  at(NOV, () => settleFinishedRankSeason(state));
  assert.equal(rankSeasonDue(state, NOV), false);
  const last = at(NOV, () => rankView(state, u)).last;
  assert.equal(last.id, 'rank-2026-10');
  assert.equal(last.mine.tier, 'gold');
  assert.deepEqual(last.reset, { chips, loans: 0 });
});

test('the hourly cron closes the month at midnight, then the 1st announces each badge', async () => {
  const { messageFor, planPushes } = await import('../lib/notifications.mjs');
  const { prepareState } = await import('../lib/api.mjs');
  const state = defaultState();
  const u = state.users.hanseo;
  u.push = { subs: [{ endpoint: 'https://push.example.com/x', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } }], sent: {}, lastSeenAt: null };
  const LASTDAY = Date.parse('2026-10-31T13:00:00+09:00');
  at(OCT, () => { settleFinishedRankSeason(state); addLedger(state, u, { type: 'ADMIN_GRANT', amount: 20e9 }); });
  const warn = messageFor(state, u, LASTDAY);
  assert.equal(warn.slot, 'seasonEnd');
  assert.match(warn.title, /오늘 자정/);
  assert.match(warn.body, /골드/);
  at(LASTDAY, () => planPushes(state, LASTDAY));
  assert.equal(u.push.sent.seasonEnd, 'rank-2026-10');
  assert.notEqual(messageFor(state, u, LASTDAY + 3_600_000)?.slot, 'seasonEnd', 'once a season');
  // Nobody plays overnight: the cron's own prepare closes October.
  at(NOV, () => prepareState(state));
  assert.equal(u.rankHistory[0].season, 'rank-2026-10');
  const morning = Date.parse('2026-11-01T10:00:00+09:00');
  const result = messageFor(state, u, morning);
  assert.equal(result.slot, 'seasonStart');
  assert.match(result.title, /10월 시즌 결과: 골드/);
});
