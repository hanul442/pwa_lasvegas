// Win-streak bonuses at event tables (lib/events.mjs `streak`): Ocean's blackjack cracks the
// vault after five winning hands in a row, the Monte Carlo gala pays after three. A losing hand
// resets the run; a push leaves it as it is. Paid from the house as an EVENT_BONUS ledger row.
import { addLedger } from './economy.mjs';
import { eventById, eventOpen } from './events.mjs';

// Called once per settled hand at an event table. Returns { streak, need, bonus } for the view.
export function trackEventStreak(state, user, { event, net, floorMin, roundId }) {
  const ev = eventById(event);
  if (!ev?.streak || !eventOpen(ev)) return null;
  const runs = (user.eventStreaks ||= {});
  let streak = net > 0 ? (runs[event] || 0) + 1 : net < 0 ? 0 : runs[event] || 0;
  let bonus = 0;
  if (streak >= ev.streak.need) {
    bonus = ev.streak.pays * floorMin;
    addLedger(state, user, { type: 'EVENT_BONUS', amount: bonus, referenceType: 'EVENT', referenceId: roundId, metadata: { event, streak } });
    streak = 0;
  }
  runs[event] = streak;
  return { event, streak, need: ev.streak.need, bonus, label: ev.streak.label };
}

export const eventStreakOf = (user, event) => {
  const ev = eventById(event);
  return ev?.streak ? { event, streak: user.eventStreaks?.[event] || 0, need: ev.streak.need, bonus: 0, label: ev.streak.label } : null;
};
