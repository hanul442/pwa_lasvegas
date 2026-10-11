// Operator tools: the admin can hand chips to (or take chips back from) any player, always through the ledger.
import { addLedger } from './economy.mjs';

const MAX_ADJUST = 1_000_000_000_000;

export function adminAdjust(state, admin, { userId, amount, note }) {
  if (!admin?.isAdmin) throw new Error('FORBIDDEN');
  const user = state.users[String(userId || '')];
  if (!user) throw new Error('USER_NOT_FOUND');
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value === 0 || Math.abs(value) > MAX_ADJUST) throw new Error('INVALID_AMOUNT');
  const memo = String(note || '').trim().slice(0, 40);
  addLedger(state, user, { type: value > 0 ? 'ADMIN_GRANT' : 'ADMIN_DEDUCT', amount: value, referenceType: 'ADMIN_PANEL', metadata: { by: admin.id, note: memo || null } });
  return { userId: user.id, nickname: user.nickname, amount: value, available: user.account.available };
}

// Recent operator adjustments across all players, newest first, for the admin screen.
export function adminLog(state, limit = 20) {
  return state.ledger.filter(tx => tx.referenceType === 'ADMIN_PANEL').slice(-limit).reverse()
    .map(tx => ({ id: tx.id, userId: tx.userId, nickname: state.users[tx.userId]?.nickname ?? tx.userId, amount: tx.amount, note: tx.metadata?.note ?? null, createdAt: tx.createdAt }));
}
