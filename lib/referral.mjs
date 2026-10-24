// 친구 초대 보상: a friend who comes in through a player's invite link and finishes a first round
// earns both of them INVITE_REWARD. Only a brand-new account can carry an inviter (set when it is
// made), so each friend pays once; a friend who played on one of the inviter's devices pays nothing,
// and an inviter is paid for at most INVITE_MONTHLY_CAP friends a month.
import crypto from 'node:crypto';
import { addLedger } from './economy.mjs';
import { pushFeed } from './engagement.mjs';
import { DEMO_PLAYERS } from './state.mjs';

export const INVITE_REWARD = 10_000_000_000; // 100억 each: one day's 일급
export const INVITE_MONTHLY_CAP = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FRIENDS_SHOWN = 20;

const monthKey = (now = Date.now()) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 7); // KST
export const cleanRef = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// A player's own invite code, made the first time it is needed.
export function refCodeOf(state, user) {
  if (!user || user.guest || DEMO_PLAYERS.includes(user.id)) return null;
  if (user.refCode) return user.refCode;
  const taken = new Set(Object.values(state.users).map(u => u.refCode).filter(Boolean));
  let code;
  do code = [...crypto.randomBytes(6)].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  while (taken.has(code));
  user.refCode = code;
  return code;
}

// `code` is an invite code, or '@nickname' from a 자랑하기 card's link (public/js/share.js ?from=).
export function findByRef(state, code) {
  const raw = String(code || '');
  if (raw.startsWith('@')) {
    const name = raw.slice(1).trim().normalize('NFC').toLowerCase();
    return name ? Object.values(state.users).find(u => !u.guest && !DEMO_PLAYERS.includes(u.id) && String(u.nickname || '').normalize('NFC').toLowerCase() === name) || null : null;
  }
  const c = cleanRef(code);
  if (c.length < 4) return null;
  return Object.values(state.users).find(u => u.refCode === c && !u.guest) || null;
}

// Called once, as a new player (or guest) is made.
export function noteReferral(state, invitee, code, now = Date.now()) {
  if (!invitee || invitee.referredBy) return null;
  const inviter = findByRef(state, code);
  if (!inviter || inviter.id === invitee.id) return null;
  invitee.referredBy = { userId: inviter.id, at: new Date(now).toISOString() };
  return inviter;
}

const roundsOf = user => Object.values(user.stats || {}).reduce((n, s) => n + (s?.rounds || 0), 0);
const sharesDevice = (a, b) => (a.devices || []).some(d => (b.devices || []).includes(d));

// After every settled round and when a guest picks a name: pays both sides once the friend has a
// name and a finished round. Returns what was paid, or null.
export function settleReferral(state, invitee, now = Date.now()) {
  const ref = invitee?.referredBy;
  if (!ref || ref.paidAt || ref.blocked || invitee.guest || roundsOf(invitee) < 1) return null;
  const inviter = state.users[ref.userId];
  if (!inviter || inviter.guest) { ref.blocked = 'NO_INVITER'; return null; }
  if (sharesDevice(inviter, invitee)) { ref.blocked = 'SAME_DEVICE'; return null; }
  const month = monthKey(now);
  const inv = inviter.invites?.month === month ? inviter.invites : { ...(inviter.invites || {}), month, paid: 0 };
  inviter.invites = inv;
  const inviterPaid = inv.paid < INVITE_MONTHLY_CAP;
  addLedger(state, invitee, { type: 'INVITE_REWARD', amount: INVITE_REWARD, referenceType: 'INVITE', referenceId: inviter.id, metadata: { role: 'friend', inviter: inviter.nickname } });
  if (inviterPaid) {
    addLedger(state, inviter, { type: 'INVITE_REWARD', amount: INVITE_REWARD, referenceType: 'INVITE', referenceId: invitee.id, metadata: { role: 'inviter', friend: invitee.nickname } });
    inv.paid += 1;
  }
  inv.friends = [{ nickname: invitee.nickname, at: new Date(now).toISOString(), paid: inviterPaid }, ...(inv.friends || [])].slice(0, FRIENDS_SHOWN);
  inv.total = (inv.total || 0) + 1;
  ref.paidAt = new Date(now).toISOString();
  ref.amount = INVITE_REWARD;
  pushFeed(state, { type: 'INVITE', actorId: inviter.id, friendId: invitee.id, friend: invitee.nickname, amount: INVITE_REWARD });
  return { invitee: INVITE_REWARD, inviter: inviterPaid ? INVITE_REWARD : 0 };
}

// What the client shows: my code and friends brought in, and the reward waiting on my first round.
export function inviteView(state, user, now = Date.now()) {
  const month = monthKey(now);
  const inv = user.invites || {};
  const waiting = Object.values(state.users).filter(u => u.referredBy?.userId === user.id && !u.referredBy.paidAt && !u.referredBy.blocked).length;
  const ref = user.referredBy;
  const inviter = ref ? state.users[ref.userId] : null;
  return {
    code: user.guest ? null : user.refCode || null,
    reward: INVITE_REWARD,
    cap: INVITE_MONTHLY_CAP,
    paidThisMonth: inv.month === month ? inv.paid || 0 : 0,
    total: inv.total || 0,
    friends: inv.friends || [],
    waiting,
    invitedBy: ref ? { nickname: inviter?.nickname ?? null, paid: Boolean(ref.paidAt), blocked: ref.blocked || null } : null
  };
}
