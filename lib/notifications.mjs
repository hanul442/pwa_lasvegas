// Push notifications that bring players back: the daily bonus, free chips and missions waiting
// to be collected, and a nudge for anyone who hasn't been around for a few days.
// A cron runs planPushes() every hour; it picks at most one message per player per slot and
// remembers what it sent, so a player hears from us at most twice a day and never at night.
import { dailyStatus, missionsStatus, rescueStatus, dayKey } from './engagement.mjs';
import { rechargeStatus } from './economy.mjs';
import { generateVapidKeys, sendPush } from './webpush.mjs';

const KST = 9 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_SUBS = 5;
export const DEFAULT_SUBJECT = 'https://pwa-lasvegas.kimwriter222.workers.dev';

const kstHour = now => new Date(now + KST).getUTCHours();

// 5000000 → "500만 원", 120000000 → "1억 2천만 원", the way the app shows chips.
export function formatWon(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const man = Math.floor(n / 1e4) % 1e4, eok = Math.floor(n / 1e8) % 1e4, jo = Math.floor(n / 1e12);
  const manText = man >= 1000 && man % 1000 === 0 ? `${man / 1000}천만` : `${man}만`;
  const parts = [jo && `${jo}조`, eok && `${eok}억`, man && manText].filter(Boolean);
  return parts.length ? `${parts.join(' ')} 원` : `${n.toLocaleString('ko-KR')}원`;
}

// ---------- keys and subscriptions ----------
export async function ensureVapid(state) {
  state.push ??= {};
  if (!state.push.vapid) state.push.vapid = await generateVapidKeys();
  return state.push.vapid;
}

function cleanSubscription(raw) {
  const endpoint = String(raw?.endpoint || '');
  const p256dh = String(raw?.keys?.p256dh || ''), auth = String(raw?.keys?.auth || '');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('INVALID_SUBSCRIPTION'); }
  if (url.protocol !== 'https:' || endpoint.length > 1000 || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw new Error('INVALID_SUBSCRIPTION');
  return { endpoint, keys: { p256dh, auth } };
}

function pushRecord(user) {
  user.push ??= { subs: [], sent: {}, lastSeenAt: null };
  user.push.subs ??= []; user.push.sent ??= {};
  return user.push;
}

// A device belongs to whoever signed in on it last, so its subscription moves between accounts.
export function subscribe(state, user, raw, now = Date.now()) {
  const sub = cleanSubscription(raw);
  for (const other of Object.values(state.users)) {
    if (other.push?.subs) other.push.subs = other.push.subs.filter(s => s.endpoint !== sub.endpoint);
  }
  const rec = pushRecord(user);
  rec.subs.push({ ...sub, createdAt: new Date(now).toISOString() });
  rec.subs = rec.subs.slice(-MAX_SUBS);
  rec.lastSeenAt = new Date(now).toISOString();
  return { devices: rec.subs.length };
}

export function unsubscribe(state, user, endpoint) {
  const rec = pushRecord(user);
  rec.subs = rec.subs.filter(s => s.endpoint !== String(endpoint || ''));
  return { devices: rec.subs.length };
}

export function markSeen(user, now = Date.now()) {
  pushRecord(user).lastSeenAt = new Date(now).toISOString();
}

export function removeGone(state, endpoints) {
  const gone = new Set(endpoints);
  for (const u of Object.values(state.users)) if (u.push?.subs) u.push.subs = u.push.subs.filter(s => !gone.has(s.endpoint));
}

// ---------- what to say ----------
export function lastActive(state, user) {
  const seen = user.push?.lastSeenAt ? Date.parse(user.push.lastSeenAt) : 0;
  const tx = state.ledger.findLast(x => x.userId === user.id);
  return Math.max(seen, tx ? Date.parse(tx.createdAt) : 0, user.createdAt ? Date.parse(user.createdAt) : 0);
}

const name = user => user.nickname || '손님';

function comebackMessage(user, days, daily) {
  const bonus = daily.claimed ? '' : ` 출석 보너스 ${formatWon(daily.reward)}도 그대로 있어요.`;
  if (days >= 14) return { title: `${name(user)}님, VEGAS가 많이 조용해요`, body: `${days}일째 자리가 비어 있어요. 딜러가 카드를 섞으면서 계속 문 쪽을 봐요.${bonus}` };
  if (days >= 7) return { title: '일주일 넘게 안 오셨네요', body: `${name(user)}님 자리 아직 아무도 안 앉혔어요. 한 판만 하고 가요.${bonus}` };
  return { title: '요즘 안 보이시네요', body: `${name(user)}님, ${days}일째 테이블이 심심해요. 칩은 그대로 기다리고 있어요.${bonus}` };
}

// Returns the message for one player at this hour, or null. Pure apart from reading the clock.
export function messageFor(state, user, now = Date.now()) {
  const rec = user.push;
  if (!rec?.subs?.length) return null;
  const hour = kstHour(now);
  if (hour < 9 || hour >= 22) return null; // nobody wants a casino at 3 a.m.
  const today = dayKey(now);
  const sent = rec.sent || {};
  const idle = now - lastActive(state, user);
  if (idle < 2 * HOUR) return null; // they're here, or were just here
  const daily = dailyStatus(user, now);

  const days = Math.floor(idle / DAY);
  if (days >= 3) {
    if (days > 30 || hour < 13) return null;
    const last = sent.comebackAt ? Date.parse(sent.comebackAt) : 0;
    if (now - last < 2 * DAY + 12 * HOUR) return null;
    return { slot: 'comeback', ...comebackMessage(user, days, daily), tag: 'comeback' };
  }

  if (hour >= 10 && hour < 19 && sent.morning !== today && !daily.claimed) {
    const streak = daily.streak > 0 ? `${daily.streak}일 연속 출석 중이에요. ` : '';
    return { slot: 'morning', title: `출석 보너스 ${formatWon(daily.reward)} 도착`, body: `${streak}${daily.day}일째 보너스가 기다려요. 들어와서 받기만 하면 돼요.`, tag: 'daily' };
  }

  if (hour >= 19 && sent.evening !== today) {
    const missions = missionsStatus(user, now);
    const waiting = missions.items.filter(m => m.done && !m.claimed);
    if (waiting.length) {
      const sum = waiting.reduce((n, m) => n + m.reward, 0);
      return { slot: 'evening', title: '안 받은 미션 보상이 있어요', body: `오늘 미션 ${waiting.length}개 깼어요. ${formatWon(sum)} 받아 가세요, 자정이 지나면 사라져요.`, tag: 'missions' };
    }
    const recharge = rechargeStatus(user);
    if (recharge.eligible) return { slot: 'evening', title: '무료 칩이 충전됐어요', body: `지갑이 거의 비었네요. ${formatWon(recharge.amount)} 무료 충전 받고 다시 앉아요.`, tag: 'free-chips' };
    if (rescueStatus(user, now).eligible) return { slot: 'evening', title: '행운 카드가 기다려요', body: '빈 지갑을 살릴 무료 카드 한 장이 준비됐어요. 한 장 골라 보세요.', tag: 'free-chips' };
    if (!daily.claimed && daily.streak > 0) return { slot: 'evening', title: `${daily.streak}일 연속 출석이 끊기려고 해요`, body: `자정 전에 들어와서 ${formatWon(daily.reward)} 받고 연속 출석 이어 가요.`, tag: 'daily' };
    if (!daily.claimed && sent.morning !== today) return { slot: 'evening', title: '오늘 출석 아직이에요', body: `${formatWon(daily.reward)} 보너스 받고 가세요.`, tag: 'daily' };
  }
  return null;
}

// Decides this hour's messages and records them as sent (call inside a state mutation).
export function planPushes(state, now = Date.now()) {
  const out = [];
  for (const user of Object.values(state.users)) {
    const msg = messageFor(state, user, now);
    if (!msg) continue;
    const { slot, ...message } = msg;
    if (slot === 'comeback') user.push.sent.comebackAt = new Date(now).toISOString();
    else user.push.sent[slot] = dayKey(now);
    out.push({ userId: user.id, subs: user.push.subs.map(s => ({ endpoint: s.endpoint, keys: s.keys })), message: { ...message, url: './' } });
  }
  return out;
}

async function deliver(plan, vapid, subject, fetchFn) {
  const gone = [];
  let sent = 0;
  await Promise.all(plan.flatMap(p => p.subs.map(async sub => {
    const r = await sendPush(sub, p.message, { vapid, subject, fetchFn });
    if (r.ok) sent++;
    if (r.gone) gone.push(sub.endpoint);
  })));
  return { sent, gone };
}

// One cron tick: plan inside the store's queue, send outside it, then forget dead devices.
export async function runPushRound(store, { now = Date.now(), fetchFn = fetch, subject } = {}) {
  const { plan, vapid, origin } = await store.mutate(async state => {
    const vapid = await ensureVapid(state);
    return { plan: planPushes(state, now), vapid, origin: state.push.origin };
  });
  if (!plan.length) return { players: 0, sent: 0, gone: 0 };
  const { sent, gone } = await deliver(plan, vapid, subject || origin || DEFAULT_SUBJECT, fetchFn);
  if (gone.length) await store.mutate(state => removeGone(state, gone));
  return { players: plan.length, sent, gone: gone.length };
}

// The "알림이 켜졌어요" confirmation, straight to one player's devices.
export async function sendTest(store, userId, { fetchFn = fetch, subject } = {}) {
  const { subs, vapid, origin } = await store.load().then(async state => ({ subs: state.users[userId]?.push?.subs || [], vapid: state.push?.vapid, origin: state.push?.origin }));
  if (!subs.length || !vapid) throw new Error('NO_PUSH_DEVICE');
  const message = { title: '알림이 켜졌어요', body: '출석 보너스, 무료 칩, 미션 보상이 생기면 알려 드릴게요.', tag: 'welcome', url: './' };
  const { sent, gone } = await deliver([{ subs, message }], vapid, subject || origin || DEFAULT_SUBJECT, fetchFn);
  if (gone.length) await store.mutate(state => removeGone(state, gone));
  return { sent };
}
