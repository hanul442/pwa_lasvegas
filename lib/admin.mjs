// Operator tools: the admin can hand chips to (or take chips back from) any player, always through the ledger.
import { addLedger } from './economy.mjs';
import { isMoney } from './constants.mjs';
import { rpEra, rpOf, rpTierStart, RP_DIVISIONS, RP_TIER_STARTS, noteRpRecord } from './rank-points.mjs';
import { RANK_TIERS } from './rank-tier.mjs';

const MAX_ADJUST = 10_000_000_000_000;

export function adminAdjust(state, admin, { userId, amount, note }) {
  if (!admin?.isAdmin) throw new Error('FORBIDDEN');
  const user = state.users[String(userId || '')];
  if (!user) throw new Error('USER_NOT_FOUND');
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > MAX_ADJUST) throw new Error('INVALID_AMOUNT');
  if (!isMoney(value)) throw new Error('AMOUNT_NOT_IN_UNITS');
  const memo = String(note || '').trim().slice(0, 40);
  addLedger(state, user, { type: value > 0 ? 'ADMIN_GRANT' : 'ADMIN_DEDUCT', amount: value, referenceType: 'ADMIN_PANEL', metadata: { by: admin.id, note: memo || null } });
  return { userId: user.id, nickname: user.nickname, amount: value, available: user.account.available };
}

// RP 티어 설정 (2026-10-30, 한서 "내 계정 실버 5로 올려줘봐"): the operator puts a player at the
// bottom of a tier's division for this season. An open 승급전 is dropped (no fee back).
export function adminSetRp(state, admin, { userId, tier, division = 'V' }, now = Date.now()) {
  if (!admin?.isAdmin) throw new Error('FORBIDDEN');
  const user = state.users[String(userId || '')];
  if (!user) throw new Error('USER_NOT_FOUND');
  if (!rpEra(now)) throw new Error('PROMO_CLOSED');
  const i = RANK_TIERS.findIndex(t => t.id === tier);
  if (i < 0) throw new Error('INVALID_TIER');
  const top = i === RP_TIER_STARTS.length - 1;
  const d = top ? 0 : RP_DIVISIONS.indexOf(division);
  if (d < 0) throw new Error('INVALID_DIVISION');
  const points = top ? rpTierStart(i) : rpTierStart(i) + Math.ceil(d * (rpTierStart(i + 1) - rpTierStart(i)) / RP_DIVISIONS.length);
  const rp = rpOf(user, now);
  rp.points = points;
  rp.peak = Math.max(rp.peak || 0, points);
  if (rp.promo?.active) rp.promo = { ...rp.promo, active: false, result: 'dropped', at: new Date(now).toISOString() };
  rp.last = { delta: 0, game: null, at: new Date(now).toISOString(), admin: admin.id };
  noteRpRecord(user, r => ({ tier: Math.max(r.tier, i) }));
  return { userId: user.id, nickname: user.nickname, tier: RANK_TIERS[i].id, division: top ? null : RP_DIVISIONS[d], points };
}

// Recent operator adjustments across all players, newest first, for the admin screen.
export function adminLog(state, limit = 20) {
  return state.ledger.filter(tx => tx.referenceType === 'ADMIN_PANEL').slice(-limit).reverse()
    .map(tx => ({ id: tx.id, userId: tx.userId, nickname: state.users[tx.userId]?.nickname ?? tx.userId, amount: tx.amount, note: tx.metadata?.note ?? null, createdAt: tx.createdAt }));
}
