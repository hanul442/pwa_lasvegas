// 캐셔 (2026-10-29, 한서 "돈으로 그 층의 칩을 살 수 있게… 항상 바이인"): from the RP season money
// and chips are apart, like a real casino. Money sits in account.wallet; sitting at a table buys
// that table's chips (account.available) with it, and getting up cashes what is left back in.
// Every game, friends' rooms included, plays from account.available as before, so the engines
// don't change; only the lobby's money moved out of their reach.
// Pay and handouts land as chips (lib/economy.mjs addLedger); for a player who isn't seated,
// prepareState sweeps them into the wallet on the next change.
// Before the RP season (and in tests of the old economy) none of this runs.
import { addLedger } from './economy.mjs';
import { FLOORS, isMoney, MONEY_UNIT } from './constants.mjs';
import { floorRefusal } from './state.mjs';
import { rpEra } from './rank-points.mjs';
import { eventById, eventOpen, eventFloor } from './events.mjs';

// A buy-in is 20 to 100 of the table's smallest bets (all the money, when that is less).
export const BUY_IN_MIN = 20, BUY_IN_MAX = 100, BUY_IN_DEFAULT = 50;

export const walletOf = user => Math.max(0, user?.account?.wallet || 0);
export const cashierOn = (now = Date.now()) => rpEra(now);

function move(state, user, amount, type, metadata = {}) {
  // Wallet first so the ledger row records where the money went.
  user.account.wallet = walletOf(user) - amount;
  addLedger(state, user, { type, amount, referenceType: 'CASHIER', metadata: { ...metadata, wallet: user.account.wallet } });
}

// A buy-in is 20 to 100 of the table's smallest bets. With chips already in hand it is a top-up:
// from one smallest bet up to what brings the stack to 100 of them (all the money, when less).
export function buyInRange(user, floor) {
  // Chips held without a seat are swept into the wallet on the next change, so count them there.
  const loose = user.account.seat ? 0 : Math.max(0, user.account.available || 0);
  const wallet = walletOf(user) + loose, min = floor.minBet, inHand = user.account.seat ? Math.max(0, user.account.available || 0) : 0;
  const floorTo = x => Math.floor(x / MONEY_UNIT) * MONEY_UNIT;
  const hi = Math.min(Math.max(0, BUY_IN_MAX * min - inHand), wallet);
  const lo = Math.min(inHand > 0 ? min : BUY_IN_MIN * min, hi);
  const def = Math.max(lo, Math.min(BUY_IN_DEFAULT * min - inHand, hi));
  return { min: floorTo(lo), max: floorTo(hi), default: floorTo(def), wallet, inHand };
}

// Buys chips for `floor` with wallet money. Chips already in hand stay and add up.
// `roomFloor`: the floor of a friend's room the player was let into (lib/api.mjs looks it up by
// code). Friends sit together whatever their RP (lib/table-room.mjs joinRoom), so its chips are
// sold here too; every bet at a house table still checks the floor (lib/stakes.mjs).
export function buyIn(state, user, { floor: slug, amount, event = null, roomFloor = null }, now = Date.now()) {
  if (!cashierOn(now)) throw new Error('CASHIER_CLOSED');
  const floor = FLOORS.find(f => f.slug === slug);
  if (!floor) throw new Error('FLOOR_NOT_FOUND');
  // An event table is open to everyone holding its entry, whatever floor it stands on (lib/stakes.mjs).
  const ev = event ? eventById(event) : null;
  if (event && (!ev || !eventOpen(ev, now) || eventFloor(ev) !== floor.slug)) throw new Error('EVENT_CLOSED');
  const refusal = ev || roomFloor === floor.slug ? null : floorRefusal(user, floor);
  if (refusal) throw new Error(refusal);
  const n = Number(amount), range = buyInRange(user, floor);
  if (!Number.isSafeInteger(n) || !isMoney(n)) throw new Error('AMOUNT_NOT_IN_UNITS');
  if (range.max < floor.minBet) throw new Error('BUY_IN_STACK_FULL');
  if (n < floor.minBet) throw new Error('BUY_IN_TOO_SMALL');
  if (n > walletOf(user)) throw new Error('INSUFFICIENT_BANKROLL');
  if (n < range.min || n > range.max) throw new Error('BUY_IN_OUT_OF_RANGE');
  move(state, user, n, 'BUY_IN', { floor: floor.slug });
  user.account.seat = { floor: floor.slug, at: new Date(now).toISOString() };
  return { amount: n, floor: floor.slug };
}

// Gets up: chips in hand go back to the wallet (chips still in a round come back when it ends
// and are swept then).
export function cashOut(state, user, { auto = false } = {}, now = Date.now()) {
  if (!cashierOn(now)) return { amount: 0 };
  const chips = user.account.available;
  user.account.seat = null;
  if (chips > 0) move(state, user, -chips, 'CASH_OUT', auto ? { auto: true } : {});
  return { amount: Math.max(0, chips) };
}

// Pays for something outside the tables (the shop, a tourney entry, a loan) from the wallet when
// the chips in hand don't cover it.
export function drawFromWallet(state, user, need, now = Date.now()) {
  if (!cashierOn(now)) return 0;
  const short = need - user.account.available;
  if (!(short > 0)) return 0;
  const take = Math.min(short, walletOf(user));
  if (take > 0) move(state, user, take, 'WALLET_DRAW');
  return take;
}

// Pays a fee (승급전 참가비, 이벤트 입장료): wallet money first, then chips in hand. One ledger row
// for the fee, after a WALLET_DRAW for the part the wallet covers.
export function payFee(state, user, amount, { type, referenceType, referenceId = null, metadata = {} }) {
  if (!(amount > 0)) return 0;
  if (walletOf(user) + Math.max(0, user.account.available) < amount) throw new Error('INSUFFICIENT_BANKROLL');
  const take = Math.min(amount, walletOf(user));
  if (take > 0) move(state, user, take, 'WALLET_DRAW');
  addLedger(state, user, { type, amount: -amount, referenceType, referenceId, metadata });
  return amount;
}

// Chips nobody is sitting with go back to the wallet (pay, handouts, a round that ended after
// the player got up, everyone's chips on the day the cashier opened).
export function sweepChips(state, now = Date.now()) {
  if (!cashierOn(now)) return;
  for (const u of Object.values(state.users || {})) {
    if (!u?.account || u.account.seat || !(u.account.available > 0)) continue;
    cashOut(state, u, { auto: true }, now);
  }
}

export function cashierView(user, now = Date.now()) {
  if (!cashierOn(now)) return { on: false };
  return {
    on: true, wallet: walletOf(user), seat: user.account.seat ?? null,
    buyIn: { min: BUY_IN_MIN, max: BUY_IN_MAX, default: BUY_IN_DEFAULT },
    floors: Object.fromEntries(FLOORS.map(f => [f.slug, buyInRange(user, f)]))
  };
}
