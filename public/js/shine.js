// Tilt-to-shine: tilting the phone moves a light across cards, chips and plaques (table.css).
// Writes --shine-x / --shine-y (where the light sits, in %), --shine-band (how far the
// specular stripe has slid) and --shine-o (how strong it is) on <html>.
// The light follows *changes* in tilt: a slowly drifting rest pose means a phone held still at
// any angle settles back to a soft glow, and a turn of the wrist makes the light sweep.
// Off for "minimal" pace and the system reduce-motion setting. On a desktop the mouse moves it.
import { reducedMotion } from './fx.js';
import { onSettings } from './settings.js';

const root = document.documentElement;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let rest = null;          // drifting rest pose { x, y } in degrees
let target = { x: 0, y: 0, o: 0 };
let shown = { x: 0, y: 0, o: 0 };
let frame = 0;
let running = false;
let lastWrite = 0;

function write() {
  root.style.setProperty('--shine-x', `${(50 + shown.x * 42).toFixed(1)}%`);
  root.style.setProperty('--shine-y', `${(32 + shown.y * 40).toFixed(1)}%`);
  root.style.setProperty('--shine-band', `${(shown.x * 30 + shown.y * 12).toFixed(1)}%`);
  root.style.setProperty('--shine-o', shown.o.toFixed(3));
}

function tick(now) {
  frame = 0;
  // Ease toward the target so sensor noise never shows as jitter.
  shown.x += (target.x - shown.x) * 0.22;
  shown.y += (target.y - shown.y) * 0.22;
  shown.o += (target.o - shown.o) * 0.12;
  const settled = Math.abs(target.x - shown.x) < 0.002 && Math.abs(target.y - shown.y) < 0.002 && Math.abs(target.o - shown.o) < 0.002;
  // ~30 writes a second is plenty for a glare and keeps style work small.
  if (now - lastWrite > 32 || settled) { write(); lastWrite = now; }
  if (!settled) frame = requestAnimationFrame(tick);
}
const schedule = () => { if (!frame) frame = requestAnimationFrame(tick); };

// Screen-relative tilt: swap axes when the phone (or the unfolded Fold) is held sideways.
function screenTilt(beta, gamma) {
  const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  if (angle === 90) return { x: beta, y: -gamma };
  if (angle === -90 || angle === 270) return { x: -beta, y: gamma };
  if (angle === 180) return { x: -gamma, y: -beta };
  return { x: gamma, y: beta };
}

function onOrient(e) {
  if (e.beta == null || e.gamma == null || document.hidden) return;
  const t = screenTilt(e.beta, e.gamma);
  if (!rest) rest = { ...t };
  // The rest pose follows the hand over a couple of seconds.
  rest.x += (t.x - rest.x) * 0.012;
  rest.y += (t.y - rest.y) * 0.012;
  const dx = clamp((t.x - rest.x) / 22, -1, 1);
  const dy = clamp((t.y - rest.y) / 22, -1, 1);
  target = { x: dx, y: dy, o: 0.28 + 0.72 * Math.min(1, Math.hypot(dx, dy) * 1.4) };
  schedule();
}

function onPointer(e) {
  if (e.pointerType !== 'mouse') return;
  const dx = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
  const dy = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
  target = { x: dx * 0.8, y: dy * 0.8, o: 0.55 };
  schedule();
}

// iOS asks for motion access, and only from inside a tap. Ask once, on the first tap at a table.
// (Browsers that grant it without asking simply answer "granted".)
function askOnTap(e) {
  if (!e.target.closest || !e.target.closest('.table-screen')) return;
  document.removeEventListener('pointerup', askOnTap, true);
  DeviceOrientationEvent.requestPermission().then(state => {
    if (state !== 'granted') stop();
  }).catch(() => {});
}

function start() {
  if (running) return;
  running = true;
  rest = null;
  const needsAsk = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  // Android delivers right away; iOS stays silent until the tap below grants access.
  if ('DeviceOrientationEvent' in window) addEventListener('deviceorientation', onOrient);
  if (needsAsk) document.addEventListener('pointerup', askOnTap, true);
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) addEventListener('pointermove', onPointer, { passive: true });
}

function stop() {
  if (!running) return;
  running = false;
  removeEventListener('deviceorientation', onOrient);
  removeEventListener('pointermove', onPointer);
  document.removeEventListener('pointerup', askOnTap, true);
  target = { x: 0, y: 0, o: 0 };
  shown = { ...target };
  write();
}

// When the app comes back, start from the current pose instead of sweeping across.
document.addEventListener('visibilitychange', () => { if (!document.hidden) rest = null; });

export function startShine() {
  const sync = () => (reducedMotion() ? stop() : start());
  sync();
  onSettings(sync);
  try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', sync); } catch {}
}
