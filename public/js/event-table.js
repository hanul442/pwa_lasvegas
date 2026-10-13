// Event tables in the client (lib/events.mjs): the event's copy from the server state, and the
// win-run meter over the felt with its bonus moment (Ocean's vault, the Monte Carlo gala).
import { el, formatCH, sound } from './fx.js';
import { eventResult } from './event-result.js';

export const eventInfo = (state, id) => state?.events?.find(e => e.id === id) || null;

export function createStreakMeter(t, ev, start = 0) {
  // The run sits in the table's subtitle, where it never covers the felt: "High Limit · 금고 ●●○○○".
  const node = el('span', 'ev-meter');
  node.setAttribute('aria-live', 'polite');
  const host = t.root.querySelector('.table-name > span');
  host.textContent = `${t.tier.name} · `;
  host.append(node);
  const need = ev.streak.need;
  const paint = streak => {
    node.innerHTML = `<span class="ev-meter-label">${ev.streak.label}</span><span class="ev-meter-pips">${Array.from({ length: need }, (_, i) => `<i class="${i < streak ? 'is-on' : ''}"></i>`).join('')}</span><b>${streak}/${need}</b>`;
  };
  paint(start);
  return {
    async update(s) {
      if (!s) return;
      if (s.bonus > 0) {
        paint(need);
        await eventResult({ event: ev.id, win: true, title: ev.title, amount: s.bonus, detail: `${need}연승 · ${ev.streak.label} 보너스`, nickname: t.nickname });
      }
      paint(s.streak);
    }
  };
}
