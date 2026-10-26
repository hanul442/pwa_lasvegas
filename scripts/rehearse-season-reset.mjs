// 시즌 리셋 리허설: a casino full of players in every state a real one has at 23:40 on the last
// night of the month (open blackjack hands, Hold'em and 7포커 seats, a friends 섯다 room, loans,
// luxury, a guest), then the clock crosses midnight in Seoul and every account is checked.
// Run: node scripts/rehearse-season-reset.mjs [YYYY-MM] (default: the month before the next reset).
import { handleApi } from '../lib/api.mjs';
import { defaultState, netWorth, debtOf, seasonOwedOf } from '../lib/state.mjs';
import { addLedger } from '../lib/economy.mjs';
import { forceHotTable } from '../lib/hot-table.mjs';

forceHotTable('off');
const RealDate = Date;
const MONTH = process.argv[2] || '2026-10';
let clock = RealDate.parse(`${MONTH}-27T12:00:00+09:00`);
// Every `new Date()` and Date.now() in the app reads this clock.
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
};

let state = defaultState();
const store = {
  load: async () => structuredClone(state),
  mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; }
};
let keyN = 0;
const call = async (token, method, path, body) => {
  const headers = { authorization: token ? `Bearer ${token}` : undefined, 'x-idempotency-key': `rehearse-${String(keyN++).padStart(6, '0')}` };
  const res = await handleApi({ method, header: n => headers[n.toLowerCase()], body: async () => body ?? {} }, new URL(`http://x${path}`), store, { NODE_ENV: 'production', AUTH_REQUIRED: '1' });
  return res;
};
const must = async (who, ...a) => { const r = await call(...a); if (r.status >= 300) throw new Error(`${who} ${a[2]} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const grant = (uid, amount) => { addLedger(state, state.users[uid], { type: 'ADMIN_GRANT', amount, referenceType: 'ADMIN_PANEL' }); };
const 억 = 100_000_000;

const people = {};
async function signup(name) {
  const d = await must(name, null, 'POST', '/api/auth/signup', { username: name, password: 'pw-123456', terms: true });
  people[name] = { token: d.token, id: d.state.user.id };
  // Old enough to sit anywhere (accounts < 7 days are kept off high friend rooms).
  const u = state.users[people[name].id]; u.createdAt = `${MONTH}-01T00:00:00Z`;
  return people[name];
}
const notes = [];
const note = (who, what) => notes.push(`${who}: ${what}`);
const tryStep = async (who, label, fn) => { try { await fn(); note(who, label); } catch (e) { note(who, `${label} 실패 ${e.message}`); } };

// ---- 10/31 23:40 ----
const names = ['부자', '홀덤', '섯다방장', '섯다손님', '빚쟁이', '칠포커', '평범'];
for (const n of names) await signup(n);
const guest = await must('guest', null, 'POST', '/api/auth/guest', { terms: true });
people['게스트'] = { token: guest.token, id: guest.state.user.id };
await call(people['평범'].token, 'GET', '/api/state');
grant(people['부자'].id, 5000 * 억);
grant(people['홀덤'].id, 300 * 억);
grant(people['섯다방장'].id, 50 * 억);
grant(people['섯다손님'].id, 50 * 억);
grant(people['칠포커'].id, 300 * 억);
grant(people['게스트'].id, 2000 * 억);
grant(people['평범'].id, 20 * 억);

const P = n => people[n];
// Passes for every floor they've opened (normally bought as that floor's 꾸미기).
for (const p of Object.values(people)) { const a = state.users[p.id].account; a.floorPasses = [...a.unlockedFloors]; }
// ---- 10/27: loans (the bank stops lending in a month's last three days) ----
await tryStep('부자', '대출', () => must('부자', P('부자').token, 'POST', '/api/bank/borrow', { lender: 'lender', amount: 1 * 억, days: 7 }));
await tryStep('빚쟁이', '대출', async () => { grant(P('빚쟁이').id, 1 * 억); await must('빚쟁이', P('빚쟁이').token, 'POST', '/api/bank/borrow', { lender: 'lender', amount: 1 * 억, days: 7 }); });
clock = RealDate.parse(`${MONTH}-31T23:40:00+09:00`);
await tryStep('부자', '요트 구매', () => must('부자', P('부자').token, 'POST', '/api/shop/buy', { itemId: 'yacht' }));
let bjRound = null;
await tryStep('부자', '블랙잭 3박스 진행 중', async () => { const d = await must('부자', P('부자').token, 'POST', '/api/blackjack/v2/start', { stakes: [100 * 억, 100 * 억, 100 * 억], floor: 'sky-lounge' }); bjRound = d.round; });
let hold = null;
await tryStep('홀덤', '홀덤 바이인 앉음', async () => { const d = await must('홀덤', P('홀덤').token, 'POST', '/api/holdem/sit', { buyIn: 100 * 억, floor: 'penthouse' }); hold = d.session || d; });
let seven = null;
await tryStep('칠포커', '7포커 앉음', async () => { const d = await must('칠포커', P('칠포커').token, 'POST', '/api/sevenpoker/sit', { buyIn: 100 * 억, floor: 'penthouse' }); seven = d.session || d; });
let room = null;
await tryStep('섯다방장', '친구 섯다방 만들기', async () => { const d = await must('섯다방장', P('섯다방장').token, 'POST', '/api/rooms', { game: 'seotda', stake: 1 * 억, floor: 'salon-prive', size: 3 }); room = d.room; });
if (room) {
  await tryStep('섯다손님', '방 참가', () => must('섯다손님', P('섯다손님').token, 'POST', '/api/rooms/join', { code: room.code }));
  await tryStep('섯다방장', '판 시작', () => must('섯다방장', P('섯다방장').token, 'POST', '/api/rooms/start', { code: room.code }));
}
await tryStep('게스트', '바카라', () => must('게스트', P('게스트').token, 'POST', '/api/baccarat/play', { stake: 100 * 억, floor: 'sky-lounge', betType: 'PLAYER' }));

const before = {};
for (const [n, p] of Object.entries(people)) {
  const u = state.users[p.id];
  before[n] = { avail: u.account.available, locked: u.account.locked, debt: debtOf(u), worth: netWorth(u), luxury: (u.luxury || []).length, floors: (u.account.unlockedFloors || []).length, hand: JSON.stringify(u.handBook ?? null).length };
}

// ---- midnight in Seoul ----
clock = RealDate.parse(`${MONTH}-31T15:00:20Z`);
const after = {};
for (const [n, p] of Object.entries(people)) {
  const r = await call(p.token, 'GET', '/api/state');
  if (r.status !== 200) note(n, `상태 읽기 실패 ${r.status} ${JSON.stringify(r.data)}`);
}
for (const [n, p] of Object.entries(people)) {
  const u = state.users[p.id];
  after[n] = { avail: u.account.available, locked: u.account.locked, owed: seasonOwedOf(u), debt: debtOf(u), worth: netWorth(u), luxury: (u.luxury || []).length, floors: (u.account.unlockedFloors || []).length, badge: u.badges?.[0]?.kind === 'RANK' ? u.badges[0].tier : null, wrapped: (u.wrappedHistory || []).length, guest: Boolean(u.guest) };
}

// ---- 00:01: everyone finishes what was on the table ----
clock += 40_000;
if (bjRound) await tryStep('부자', '블랙잭 마저 치기', async () => {
  let round = bjRound, n = 0;
  while (round.status !== 'SETTLED' && n++ < 20) {
    const action = round.status === 'INSURANCE' ? 'NO_INSURANCE' : 'STAND';
    const d = await must('부자', P('부자').token, 'POST', '/api/blackjack/v2/action', { roundId: round.id, action, handIndex: round.activeHand });
    round = d.round;
  }
});
if (hold) await tryStep('홀덤', '홀덤 일어나기', async () => {
  const sid = hold.id || hold.sessionId || state.holdemSessions?.find?.(s => s.userId === P('홀덤').id)?.id;
  await must('홀덤', P('홀덤').token, 'POST', '/api/holdem/leave', { sessionId: sid });
});
if (seven) await tryStep('칠포커', '7포커 일어나기', async () => {
  const sid = seven.id || seven.sessionId;
  await must('칠포커', P('칠포커').token, 'POST', '/api/sevenpoker/leave', { sessionId: sid });
});
if (room) for (const n of ['섯다방장', '섯다손님']) await tryStep(n, '섯다방 나가기', () => must(n, P(n).token, 'POST', '/api/rooms/leave', { code: room.code }));
for (const [n, p] of Object.entries(people)) await tryStep(n, '11월 일급 받기', () => must(n, p.token, 'POST', '/api/daily/claim', {}));

// ---- checks ----
const problems = [];
for (const [n, p] of Object.entries(people)) {
  const u = state.users[p.id];
  const rows = state.ledger.filter(x => x.userId === u.id);
  let a = 0, l = 0;
  for (const tx of rows) {
    if (tx.availableBefore !== a || (tx.lockedBefore ?? l) !== l) { problems.push(`${n}: 장부 끊김 ${tx.type}`); break; }
    a = tx.availableAfter; l = tx.lockedAfter ?? l;
  }
  if (a !== u.account.available || l !== u.account.locked) problems.push(`${n}: 장부와 지갑 불일치`);
  if (u.account.available < 0) problems.push(`${n}: 칩이 음수`);
  const income = rows.filter(x => Date.parse(x.createdAt) >= RealDate.parse(`${MONTH}-31T15:00:00Z`) && ['DAILY_BONUS', 'PAY', 'REFERRAL', 'SUPPORT', 'WELFARE'].some(t => String(x.type).includes(t))).reduce((s, x) => s + Math.max(0, x.amount), 0);
  const worth = netWorth(u);
  // After the reset nobody should be worth more than what the new month already paid them.
  const fin = { avail: u.account.available, locked: u.account.locked, owed: seasonOwedOf(u), worth, income };
  if (worth > income) problems.push(`${n}: 리셋 뒤 순자산 ${worth / 억}억 > 새 달 수입 ${income / 억}억 (10월 칩이 남음)`);
  if (u.account.locked === 0 && seasonOwedOf(u) > 0) problems.push(`${n}: 테이블은 비었는데 갚을 시즌 칩 ${seasonOwedOf(u) / 억}억이 남음`);
  after[n].final = fin;
}
const fmt = o => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'number' && Math.abs(v) >= 억 ? (v / 억) + '억' : v}`).join(' ');
console.log('--- 10/31 23:40 ---'); for (const n in before) console.log(n.padEnd(6), fmt(before[n]));
console.log('--- 11/1 00:00 리셋 직후 ---'); for (const n in after) { const { final, ...r } = after[n]; console.log(n.padEnd(6), fmt(r)); }
console.log('--- 11/1 00:01 테이블 정리 + 일급 ---'); for (const n in after) console.log(n.padEnd(6), fmt(after[n].final));
console.log('--- 진행 ---'); for (const x of notes) console.log(' ', x);
console.log('--- 시즌 ---', JSON.stringify(state.meta.lastRankSeason?.podium?.map(p => [p.nickname, p.tier])));
console.log(problems.length ? `문제 ${problems.length}개:\n  ${problems.join('\n  ')}` : '문제 없음');
for (const n of process.env.SHOW?.split(",") || []) console.log(n, state.ledger.filter(x => x.userId === people[n].id).slice(-8).map(x => [x.type, x.amount / 억, x.createdAt]));
process.exit(problems.length ? 1 : 0);
