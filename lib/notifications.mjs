// Push notifications that bring players back: the daily bonus, free chips and missions waiting
// to be collected, and a nudge for anyone who hasn't been around for a few days.
// A cron runs planPushes() every hour; it picks at most one message per player per slot and
// remembers what it sent, so a player hears from us at most twice a day and never at night.
// The hour's 핫 테이블 (lib/hot-table.mjs) opens on the same tick, so its push goes out with it.
import { dailyStatus, missionsStatus, supportStatus, dayKey } from './engagement.mjs';
import { generateVapidKeys, sendPush } from './webpush.mjs';
import { newsFor } from './news.mjs';
import { hotTableAt } from './hot-table.mjs';
import { monthBoundary, tierFor, RANK_TIERS } from './rank-tier.mjs';
import { rpEraFor, rpTierEraFor, rpPointsNow, rpTierFor, RP_CARRY_DROP } from './rank-points.mjs';
import { planNightlyPushes } from './nightly-tourney.mjs';
import { formatMoney } from '../public/js/money.js';

const KST = 9 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_SUBS = 5;
const HOT_PUSH_MIN_LEFT = 5 * 60 * 1000; // a late cron tick doesn't announce a table about to cool
export const DEFAULT_SUBJECT = 'https://pwa-lasvegas.kimwriter222.workers.dev';

const kstHour = now => new Date(now + KST).getUTCHours();

// 5000000 → "500만원", 120000000 → "1억 2천만원": the same formatter the app's screens use.
export const formatWon = value => formatMoney(Math.max(0, Number(value) || 0));

// ---------- keys and subscriptions ----------
export async function ensureVapid(state) {
  state.push ??= {};
  if (!state.push.vapid) state.push.vapid = await generateVapidKeys();
  return state.push.vapid;
}

// Chrome on Android hands over its keys as base64url *with* '=' padding, others without, and
// some as plain base64; store them all as unpadded base64url.
const b64urlKey = v => String(v || '').trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function cleanSubscription(raw) {
  const endpoint = String(raw?.endpoint || '');
  const p256dh = b64urlKey(raw?.keys?.p256dh), auth = b64urlKey(raw?.keys?.auth);
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
  const bonus = daily.claimed ? '' : ` 오늘 일급 ${formatWon(daily.reward)}도 그대로 있어요.`;
  if (days >= 14) return { title: `${name(user)}님, VEGAS가 많이 조용해요`, body: `${days}일째 자리가 비어 있어요. 딜러가 카드를 섞으면서 계속 문 쪽을 봐요.${bonus}` };
  if (days >= 7) return { title: '일주일 넘게 안 오셨네요', body: `${name(user)}님 자리 아직 아무도 안 앉혔어요. 한 판만 하고 가요.${bonus}` };
  return { title: '요즘 안 보이시네요', body: `${name(user)}님, ${days}일째 테이블이 심심해요. 칩은 그대로 기다리고 있어요.${bonus}` };
}

// 월간 랭크 시즌 (lib/rank-season.mjs): on the month's last day, a warning that everything but
// 꾸미기 and badges goes at midnight; on the 1st, the badge last month earned. Once each per season.
function seasonMessage(user, now, sent) {
  const season = monthBoundary(now);
  const hour = kstHour(now);
  const left = Date.parse(season.endsAt) - now;
  if (left <= DAY && hour >= 12 && sent.seasonEnd !== season.id && rpEraFor(season.id)) {
    const points = Math.floor(rpPointsNow(user, now)), tier = rpTierFor(points);
    return { slot: 'seasonEnd', season: season.id, title: `오늘 자정, ${season.name} 마감`, body: `${name(user)}님은 지금 ${tier.name} (RP ${points}). 자정에 시즌 배지를 받고, RP는 ${RP_CARRY_DROP}티어 아래에서 다시 시작해요. 돈은 그대로예요.`, tag: 'season' };
  }
  if (left <= DAY && hour >= 12 && sent.seasonEnd !== season.id) {
    const peak = user.rank?.season === season.id ? user.rank.peak || 0 : 0;
    const rp = rpTierEraFor(season.id), points = Math.floor(rpPointsNow(user, now));
    const tier = rp ? rpTierFor(points) : tierFor(peak);
    return { slot: 'seasonEnd', season: season.id, title: `오늘 자정, ${season.name.replace(' (프리시즌)', '')} 초기화`, body: `${name(user)}님은 지금 ${tier.name}${rp ? ` (RP ${points})` : peak ? ` (최고 ${formatWon(peak)})` : ''}. 자정에 칩·빚이 정리되고 모두 1층 홀부터 다시 시작해요. 꾸미기·배지는 남아요.`, tag: 'season' };
  }
  const result = (user.rankHistory || [])[0];
  const prevId = monthBoundary(Date.parse(season.startsAt) - DAY).id;
  if (result?.season === prevId && Date.parse(season.startsAt) + 2 * DAY > now && hour >= 10 && sent.seasonStart !== season.id) {
    const tier = RANK_TIERS.find(t => t.id === result.tier) || RANK_TIERS[0];
    return { slot: 'seasonStart', season: season.id, title: `${result.name.replace(' (프리시즌)', '')} 결과: ${tier.name}${result.rank <= 3 ? ` · 챌린저 ${result.rank}위` : ''}`, body: `${result.of}명 중 ${result.rank}위로 배지를 받았어요. ${rpEraFor(prevId) ? `새 시즌은 ${RP_CARRY_DROP}티어 아래에서 시작해요.` : '새 시즌이 열렸어요, 한 칸씩 다시 올라가요.'}`, tag: 'season' };
  }
  return null;
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
  const season = seasonMessage(user, now, sent);
  if (season && days <= 30) return season;
  if (days >= 3) {
    if (days > 30 || hour < 13) return null;
    const last = sent.comebackAt ? Date.parse(sent.comebackAt) : 0;
    if (now - last < 2 * DAY + 12 * HOUR) return null;
    return { slot: 'comeback', ...comebackMessage(user, days, daily), tag: 'comeback' };
  }

  if (hour >= 10 && hour < 19 && sent.morning !== today && !daily.claimed) {
    const streak = daily.streak > 0 ? `${daily.streak}일 연속 출근 중이에요. ` : '';
    return { slot: 'morning', title: `오늘 일급 ${formatWon(daily.reward)} 도착`, body: `${streak}${daily.pay?.weekly ? '오늘은 주급까지 같이 나와요. ' : ''}들어와서 받기만 하면 돼요.`, tag: 'daily' };
  }

  if (hour >= 19 && sent.evening !== today) {
    const missions = missionsStatus(user, now);
    const waiting = missions.items.filter(m => m.done && !m.claimed);
    if (waiting.length) {
      const sum = waiting.reduce((n, m) => n + m.reward, 0);
      return { slot: 'evening', title: '안 받은 미션 보상이 있어요', body: `오늘 미션 ${waiting.length}개 깼어요. ${formatWon(sum)} 받아 가세요, 자정이 지나면 사라져요.`, tag: 'missions' };
    }
    const welfare = supportStatus(user, now).welfare;
    if (welfare.qualified && !welfare.claimed && welfare.amount > 0) return { slot: 'evening', title: '구제금융이 기다려요', body: `가진 돈이 1층 최소 베팅보다 적어요. 지갑에서 구제금융 ${formatWon(welfare.amount)} 받고 다시 앉아요.`, tag: 'free-chips' };
    if (!daily.claimed && daily.streak > 0) return { slot: 'evening', title: `${daily.streak}일 연속 출근이 끊기려고 해요`, body: `자정 전에 들어와서 일급 ${formatWon(daily.reward)} 받고 주급·월급까지 이어 가요.`, tag: 'daily' };
    if (!daily.claimed && sent.morning !== today) return { slot: 'evening', title: '오늘 일급 아직 안 받았어요', body: `${formatWon(daily.reward)} 받고 가세요.`, tag: 'daily' };
  }

  // 핫 딜러 타임 (lib/hot-table.mjs): the hourly tick lands as a table turns hot. At most one a day,
  // never late in the window, and never on a day the morning reminder already went out, so a player
  // still hears from us at most twice a day.
  const hot = hotTableAt(now);
  if (hot && hot.endsAt - now >= HOT_PUSH_MIN_LEFT && hour >= 11 && sent.hot !== today && sent.morning !== today) {
    const pct = Math.round(hot.bonus * 100);
    return { slot: 'hot', title: `핫 테이블: 지금 ${hot.label} +${pct}%`, body: `${Math.round((hot.endsAt - now) / 60000)}분 동안 ${hot.label}에서 이기면 순수익의 ${pct}%를 더 드려요.`, tag: 'hot-table' };
  }
  return null;
}

// Decides this hour's messages and records them as sent (call inside a state mutation).
export function planPushes(state, now = Date.now()) {
  const out = [];
  for (const user of Object.values(state.users)) {
    const msg = messageFor(state, user, now);
    if (!msg) continue;
    const { slot, season, ...message } = msg;
    if (season) user.push.sent[slot] = season;
    else if (slot === 'comeback') user.push.sent.comebackAt = new Date(now).toISOString();
    else user.push.sent[slot] = dayKey(now);
    out.push({ userId: user.id, subs: user.push.subs.map(s => ({ endpoint: s.endpoint, keys: s.keys })), message: { ...message, url: './' } });
  }
  return out;
}

// Big news (lib/news.mjs) since the last state change, for players who aren't looking.
// Duels and your own season win always go out; floor-wide news at most every two hours,
// and not to someone who is playing right now (they get the in-app banner).
const NEWS_GAP = 2 * HOUR;
export function planNewsPushes(state, now = Date.now()) {
  state.push ??= {};
  const since = state.push.newsAt ? Date.parse(state.push.newsAt) : null;
  state.push.newsAt = new Date(now).toISOString();
  if (since === null || !state.push.vapid) return [];
  const hour = kstHour(now);
  if (hour < 9 || hour >= 22) return [];
  const out = [];
  for (const user of Object.values(state.users)) {
    if (!user.push?.subs?.length) continue;
    const items = newsFor(state, user.id, since).filter(n => n.push);
    let pick = items.find(n => n.mine || n.type.startsWith('DUEL'));
    if (!pick) {
      pick = items[0];
      const last = user.push.sent?.newsAt ? Date.parse(user.push.sent.newsAt) : 0;
      if (!pick || now - last < NEWS_GAP || now - lastActive(state, user) < 5 * 60 * 1000) continue;
      user.push.sent.newsAt = new Date(now).toISOString();
    }
    out.push({ userId: user.id, subs: user.push.subs.map(s => ({ endpoint: s.endpoint, keys: s.keys })), message: { title: pick.title, body: pick.body, tag: `news-${pick.type.toLowerCase()}`, url: pick.url || './' } });
  }
  return out;
}

async function deliver(plan, vapid, subject, fetchFn) {
  const gone = [], statuses = [];
  let sent = 0;
  await Promise.all(plan.flatMap(p => p.subs.map(async sub => {
    const r = await sendPush(sub, p.message, { vapid, subject, fetchFn });
    statuses.push(r.status);
    if (r.ok) sent++;
    if (r.gone) gone.push(sub.endpoint);
  })));
  return { sent, gone, statuses };
}

// One cron tick: plan inside the store's queue, send outside it, then forget dead devices.
// prepare (lib/api.mjs prepareState) settles what came due first, so a month closes at midnight
// even if nobody is playing, and the 1st's season result is there to announce.
export async function runPushRound(store, { now = Date.now(), fetchFn = fetch, subject, prepare } = {}) {
  const { plan, vapid, origin } = await store.mutate(async state => {
    prepare?.(state);
    const vapid = await ensureVapid(state);
    return { plan: [...planNewsPushes(state, now), ...planPushes(state, now)], vapid, origin: state.push.origin };
  });
  if (!plan.length) return { players: 0, sent: 0, gone: 0 };
  const { sent, gone } = await deliver(plan, vapid, subject || origin || DEFAULT_SUBJECT, fetchFn);
  if (gone.length) await store.mutate(state => removeGone(state, gone));
  return { players: plan.length, sent, gone: gone.length };
}

// 밤 9시 토너먼트 (lib/nightly-tourney.mjs): a cron every minute through the evening keeps the
// tables moving when nobody is polling, opens the tournament on the hour, and sends its pushes.
export async function runNightlyRound(store, { now = Date.now(), fetchFn = fetch, subject, prepare } = {}) {
  // Most evening minutes have nothing to do: skip the write unless the tournament is running or
  // its reminder or start is close.
  const n = (await store.load()).nightly;
  const close = n && n.status === 'REG' && now >= n.startsAt - 15 * 60_000;
  if (n && n.status !== 'RUNNING' && !close && n.id === dayKey(now)) return { players: 0, sent: 0, idle: true };
  const { plan, vapid, origin } = await store.mutate(async state => {
    prepare?.(state);
    const vapid = state.push?.vapid || null;
    return { plan: vapid ? planNightlyPushes(state, now) : [], vapid, origin: state.push?.origin };
  });
  if (!plan.length) return { players: 0, sent: 0 };
  const { sent, gone } = await deliver(plan, vapid, subject || origin || DEFAULT_SUBJECT, fetchFn);
  if (gone.length) await store.mutate(state => removeGone(state, gone));
  return { players: plan.length, sent };
}

// Sends a plan made inside a mutation (news right after the change that caused it).
export async function deliverPlan(store, { plan, vapid, origin }, { fetchFn = fetch, subject } = {}) {
  if (!plan?.length || !vapid) return { sent: 0 };
  try {
    const { sent, gone } = await deliver(plan, vapid, subject || origin || DEFAULT_SUBJECT, fetchFn);
    if (gone.length) await store.mutate(state => removeGone(state, gone));
    return { sent };
  } catch { return { sent: 0 }; }
}

// The "알림이 켜졌어요" confirmation, straight to one player's devices.
export async function sendTest(store, userId, { fetchFn = fetch, subject } = {}) {
  const { subs, vapid, origin } = await store.load().then(async state => ({ subs: state.users[userId]?.push?.subs || [], vapid: state.push?.vapid, origin: state.push?.origin }));
  if (!subs.length || !vapid) throw new Error('NO_PUSH_DEVICE');
  const message = { title: '알림이 켜졌어요', body: '출석 보너스, 무료 칩, 미션 보상이 생기면 알려 드릴게요.', tag: 'welcome', url: './' };
  const { sent, gone, statuses } = await deliver([{ subs, message }], vapid, subject || origin || DEFAULT_SUBJECT, fetchFn);
  if (gone.length) await store.mutate(state => removeGone(state, gone));
  // The push service's answer per device, so a failure on the phone can be told apart from ours.
  return { sent, devices: subs.length, statuses };
}
