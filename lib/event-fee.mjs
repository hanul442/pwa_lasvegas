// 이벤트 입장료 (2026-10-29, 한서 "돈을 더 쓰게"): from the RP season an event table asks for a
// fee the first time a player plays it in its window: a rotating event once for its week, an
// always-open one (Casablanca, God of Gamblers, The Whale Room) once a Seoul day. The fee is a
// tenth of the chips the event asks a player to hold (lib/events.mjs eventEntry). It is charged
// with the first bet, inside the same change, so a bet that fails takes no fee.
import { eventById, eventEntry, weekAt } from './events.mjs';
import { rpEra } from './rank-points.mjs';
import { payFee } from './cashier.mjs';
import { roundMoney } from './constants.mjs';

export const EVENT_FEE_RATE = 0.1;
const KST = 9 * 60 * 60 * 1000;
export const eventFee = ev => roundMoney(eventEntry(ev) * EVENT_FEE_RATE);
const windowOf = (ev, now) => (ev.always ? `day-${new Date(now + KST).toISOString().slice(0, 10)}` : `week-${weekAt(now)}`);
const paidFor = (user, ev, now) => user.eventTickets?.[ev.id] === windowOf(ev, now);

// Charges the fee unless this window is paid already. Returns what was charged.
export function chargeEventFee(state, user, eventOrId, now = Date.now()) {
  const ev = typeof eventOrId === 'string' ? eventById(eventOrId) : eventOrId;
  if (!ev || !rpEra(now) || paidFor(user, ev, now)) return 0;
  const fee = eventFee(ev);
  payFee(state, user, fee, { type: 'EVENT_FEE', referenceType: 'EVENT', referenceId: ev.id, metadata: { event: ev.id, window: windowOf(ev, now) } });
  user.eventTickets = { ...(user.eventTickets || {}), [ev.id]: windowOf(ev, now) };
  return fee;
}

// For the 이벤트 tab: each live event's fee and whether this window is paid.
export function eventFeesView(user, events, now = Date.now()) {
  if (!rpEra(now)) return null;
  return Object.fromEntries(events.map(ev => [ev.id, { fee: eventFee(ev), paid: paidFor(user, ev, now), per: ev.always ? 'day' : 'week' }]));
}
