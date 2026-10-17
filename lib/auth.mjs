// Player accounts: username + password, hashed with PBKDF2, and bearer-token sessions.
// Everything lives in state.auth so the Node server and the Cloudflare Worker share it.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { newUser } from './state.mjs';

const ITERATIONS = 100_000; // the most PBKDF2 rounds Cloudflare Workers allow
const SESSION_DAYS = 180;
const MAX_SESSIONS_PER_USER = 10;
const MAX_FAILED = 8;
const MAX_ACCOUNTS = 1000;
const LOCK_MS = 10 * 60_000;
const USERNAME = /^[\p{L}\p{N}_]{2,12}$/u;
// Profiles from before accounts existed that a new account may take over. The demo players stay bots.
export const CLAIMABLE_LEGACY = ['hanseo'];

const enc = new TextEncoder();
const hex = buf => Buffer.from(buf).toString('hex');
const nameKey = name => String(name || '').trim().normalize('NFC').toLowerCase();

export function authState(state) {
  state.auth ||= { accounts: {}, sessions: {} };
  state.auth.accounts ||= {};
  state.auth.sessions ||= {};
  return state.auth;
}

export function validateCredentials(username, password) {
  const name = String(username || '').trim().normalize('NFC');
  if (!USERNAME.test(name)) throw new Error('INVALID_USERNAME');
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) throw new Error('INVALID_PASSWORD');
  return name;
}

export async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(saltHex, 'hex'), iterations: ITERATIONS }, key, 256);
  return hex(bits);
}

export const newSalt = () => crypto.randomBytes(16).toString('hex');
const tokenHash = token => crypto.createHash('sha256').update(String(token)).digest('hex');

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function claimableProfiles(state) {
  const taken = new Set(Object.values(authState(state).accounts).map(a => a.userId));
  return CLAIMABLE_LEGACY.filter(id => state.users[id] && !taken.has(id)).map(id => ({ id, nickname: state.users[id].nickname }));
}

export function findAccount(state, username) {
  return authState(state).accounts[nameKey(username)] || null;
}

function pruneSessions(auth, now) {
  const perUser = {};
  for (const [h, s] of Object.entries(auth.sessions)) {
    if (Date.parse(s.expiresAt) <= now) { delete auth.sessions[h]; continue; }
    (perUser[s.userId] ||= []).push([h, s]);
  }
  for (const list of Object.values(perUser)) {
    list.sort((a, b) => Date.parse(b[1].createdAt) - Date.parse(a[1].createdAt));
    for (const [h] of list.slice(MAX_SESSIONS_PER_USER - 1)) delete auth.sessions[h];
  }
}

function openSession(auth, userId, now) {
  pruneSessions(auth, now);
  const token = crypto.randomBytes(32).toString('base64url');
  auth.sessions[tokenHash(token)] = { userId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_DAYS * 86_400_000).toISOString() };
  return token;
}

// Creates the account (and a fresh player, or takes over an unclaimed legacy profile) and signs in.
export function createAccount(state, { username, salt, hash, claimId }, now = Date.now()) {
  const auth = authState(state);
  const key = nameKey(username);
  if (auth.accounts[key]) throw new Error('USERNAME_TAKEN');
  if (Object.keys(auth.accounts).length >= MAX_ACCOUNTS) throw new Error('SIGNUPS_CLOSED');
  if (Object.values(state.users).some(u => u.id !== claimId && nameKey(u.nickname) === key)) throw new Error('USERNAME_TAKEN');
  let userId;
  if (claimId) {
    if (!claimableProfiles(state).some(p => p.id === claimId)) throw new Error('PROFILE_NOT_CLAIMABLE');
    userId = claimId;
    state.users[userId].nickname = username;
  } else {
    userId = `u_${crypto.randomUUID()}`;
    newUser(state, userId, username);
  }
  auth.accounts[key] = { username, userId, salt, hash, createdAt: new Date(now).toISOString(), failed: 0, lockedUntil: null };
  return { token: openSession(auth, userId, now), userId };
}

// Checks a password hash computed outside the state lock; repeated failures lock the account briefly.
export function signIn(state, username, hash, now = Date.now()) {
  const auth = authState(state);
  const account = auth.accounts[nameKey(username)];
  if (!account) throw new Error('BAD_CREDENTIALS');
  if (account.lockedUntil && Date.parse(account.lockedUntil) > now) throw new Error('ACCOUNT_LOCKED');
  if (!sameHex(hash, account.hash)) {
    account.failed = (account.failed || 0) + 1;
    if (account.failed >= MAX_FAILED) { account.failed = 0; account.lockedUntil = new Date(now + LOCK_MS).toISOString(); }
    return null;
  }
  account.failed = 0; account.lockedUntil = null;
  return { token: openSession(auth, account.userId, now), userId: account.userId };
}

export function sessionUserId(state, token, now = Date.now()) {
  if (!token) return null;
  const s = authState(state).sessions[tokenHash(token)];
  if (!s || Date.parse(s.expiresAt) <= now) return null;
  return s.userId;
}

export function signOut(state, token) {
  delete authState(state).sessions[tokenHash(token)];
}

export function bearerToken(req) {
  const h = req.header('authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(h);
  return m ? m[1] : null;
}

export function usernameOf(state, userId) {
  return Object.values(authState(state).accounts).find(a => a.userId === userId)?.username ?? null;
}

// ---------- getting back in without the password ----------
// There is no email on an account, so two ways back in: a recovery code the player made
// while signed in (shown once, stored hashed), or a temporary password from the operator.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export const normalizeCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function newRecoveryCode() {
  const bytes = crypto.randomBytes(12);
  const raw = [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return raw.match(/.{4}/g).join('-');
}

export function newTempPassword() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('').toLowerCase();
}

function accountOf(auth, userId) {
  return Object.values(auth.accounts).find(a => a.userId === userId) || null;
}

export function hasRecovery(state, userId) {
  return Boolean(accountOf(authState(state), userId)?.recovery);
}

// Replaces any earlier code.
export function setRecovery(state, userId, { salt, hash }, now = Date.now()) {
  const account = accountOf(authState(state), userId);
  if (!account) throw new Error('USER_NOT_FOUND');
  account.recovery = { salt, hash, createdAt: new Date(now).toISOString() };
}

// A new password signs every other device out and opens a fresh session here.
function replacePassword(auth, account, { salt, hash }, now) {
  account.salt = salt;
  account.hash = hash;
  account.failed = 0;
  account.lockedUntil = null;
  for (const [h, s] of Object.entries(auth.sessions)) if (s.userId === account.userId) delete auth.sessions[h];
}

// The code hash is computed outside the state lock with the account's recovery salt. Wrong codes
// count toward the same lock as wrong passwords. A used code is spent.
export function resetWithRecovery(state, username, codeHash, password, now = Date.now()) {
  const auth = authState(state);
  const account = auth.accounts[nameKey(username)];
  if (!account?.recovery) throw new Error('BAD_RECOVERY');
  if (account.lockedUntil && Date.parse(account.lockedUntil) > now) throw new Error('ACCOUNT_LOCKED');
  if (!sameHex(codeHash, account.recovery.hash)) {
    account.failed = (account.failed || 0) + 1;
    if (account.failed >= MAX_FAILED) { account.failed = 0; account.lockedUntil = new Date(now + LOCK_MS).toISOString(); }
    return null;
  }
  delete account.recovery;
  replacePassword(auth, account, password, now);
  return { token: openSession(auth, account.userId, now), userId: account.userId };
}

export function adminSetPassword(state, admin, userId, password, now = Date.now()) {
  if (!admin?.isAdmin) throw new Error('FORBIDDEN');
  const auth = authState(state);
  const account = accountOf(auth, String(userId || ''));
  if (!account) throw new Error('NO_ACCOUNT');
  replacePassword(auth, account, password, now);
  return { userId: account.userId, username: account.username };
}

export function accountForUser(state, userId) {
  return accountOf(authState(state), userId);
}

// Changing the password while signed in: the current one must match. Other devices sign out,
// this one gets a fresh session.
export function changePassword(state, userId, currentHash, password, now = Date.now()) {
  const auth = authState(state);
  const account = accountOf(auth, userId);
  if (!account) throw new Error('NO_ACCOUNT');
  if (!sameHex(currentHash, account.hash)) throw new Error('BAD_CREDENTIALS');
  replacePassword(auth, account, password, now);
  return { token: openSession(auth, userId, now) };
}
