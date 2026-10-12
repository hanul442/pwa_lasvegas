// Runs a test inside the week of the rotation when `id` is the event on, so event tests do not
// depend on today's date.
import { nextRunOf } from '../lib/events.mjs';

export const during = (id, fn) => async (...args) => {
  const real = Date.now;
  const at = Date.parse(nextRunOf(id, real()).from) + 3_600_000;
  Date.now = () => at;
  try { return await fn(...args); } finally { Date.now = real; }
};
