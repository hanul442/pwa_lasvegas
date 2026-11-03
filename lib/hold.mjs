// Friends' rooms used to be polled every 1.5s, so a friend's move (or an AI's) showed up to 1.5s
// late. Now the poll can wait on the server: the client sends the key of the last view it got
// (`?wait=<key>`) and the answer comes back as soon as the room looks different, or after HOLD_MS
// with nothing new. One request then covers what took a dozen, and a move shows at once.

export const HOLD_MS = 20_000;
const CHECK_MS = 1000; // clocks (a turn timing out, the next hand) are looked at this often

// Every store gets one signal; a change anywhere wakes the waiting polls, which look again.
export function changeSignal() {
  let waiters = new Set();
  return {
    fire() { const now = waiters; waiters = new Set(); now.forEach(w => w()); },
    wait(ms) {
      return new Promise(resolve => {
        const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
        const timer = setTimeout(done, Math.max(0, ms));
        waiters.add(done);
      });
    }
  };
}

// What the player would see, without the parts that change on their own (the server clock, the
// events after the cursor the client sent): two views with the same key look the same.
export function viewKey(view) {
  if (!view) return '';
  const { serverNow, events, prev, ...rest } = view;
  const text = JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(36)}${text.length.toString(36)}`;
}

// Waits while look() still gives the view the client has (`seen`). look() returns
// { due: true } when the room has a move to play (the caller then plays it), or { view }.
// The hold runs on the real clock even when a test gives the rooms a fake one.
export async function holdView({ seen, look, wait, holdMs = HOLD_MS }) {
  let out = await look();
  if (!seen || !wait) return out;
  const until = Date.now() + holdMs;
  while (!out.due && viewKey(out.view) === seen && Date.now() < until) {
    await wait(Math.min(CHECK_MS, until - Date.now()));
    out = await look();
  }
  return out;
}
