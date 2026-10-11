// Shared feel layer: motion timing, synthesized table sounds, haptics, number formatting.

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => reduceQuery.matches;

// Scale every duration down to near-instant when the player asked for less motion.
export const ms = value => (reducedMotion() ? Math.min(value, 60) : value);
export const wait = value => new Promise(resolve => setTimeout(resolve, ms(value)));

export function animate(el, keyframes, options) {
  const opts = typeof options === 'number' ? { duration: options } : { ...options };
  opts.duration = ms(opts.duration ?? 300);
  if (opts.delay) opts.delay = ms(opts.delay);
  const anim = el.animate(keyframes, { fill: 'both', easing: 'cubic-bezier(.2,.8,.2,1)', ...opts });
  return anim.finished.catch(() => {});
}

// Moves `el` visually from `fromRect` to where it currently sits in layout (FLIP).
export function flyFrom(el, fromRect, { duration = 420, delay = 0, lift = 0, spin = 0, scale = 0.9, easing } = {}) {
  const to = el.getBoundingClientRect();
  const dx = fromRect.left + fromRect.width / 2 - (to.left + to.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (to.top + to.height / 2);
  const frames = lift
    ? [
        { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg) scale(${scale})` },
        { transform: `translate(${dx / 2}px,${dy / 2 - lift}px) rotate(${spin / 2}deg) scale(${(1 + scale) / 2 + 0.08})`, offset: 0.5 },
        { transform: 'translate(0,0) rotate(0) scale(1)' }
      ]
    : [
        { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg) scale(${scale})` },
        { transform: 'translate(0,0) rotate(0) scale(1)' }
      ];
  return animate(el, frames, { duration, delay, easing: easing || 'cubic-bezier(.16,.84,.3,1)', fill: 'backwards' });
}

// Moves `el` from where it sits now to `toRect`, leaving it there.
export function flyTo(el, toRect, { duration = 420, delay = 0, lift = 0, fade = false } = {}) {
  const from = el.getBoundingClientRect();
  const dx = toRect.left + toRect.width / 2 - (from.left + from.width / 2);
  const dy = toRect.top + toRect.height / 2 - (from.top + from.height / 2);
  const end = { transform: `translate(${dx}px,${dy}px) scale(.85)`, opacity: fade ? 0 : 1 };
  const frames = lift
    ? [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx / 2}px,${dy / 2 - lift}px) scale(1.06)`, opacity: 1, offset: 0.5 }, end]
    : [{ transform: 'none', opacity: 1 }, end];
  return animate(el, frames, { duration, delay, easing: 'cubic-bezier(.5,0,.3,1)' });
}

// ---------- sound ----------
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('vegas:muted') === '1'; } catch {}

export const isMuted = () => muted;
export function setMuted(value) {
  muted = value;
  try { localStorage.setItem('vegas:muted', value ? '1' : '0'); } catch {}
}

// Shared with the background music so everything runs on one clock.
export function audioContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function audio() {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBurst(ac, { at = 0, length = 0.05, freq = 3000, q = 0.8, gain = 0.25 } = {}) {
  const frames = Math.floor(ac.sampleRate * length);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(ac.currentTime + at);
}

function tone(ac, { at = 0, freq = 880, length = 0.12, gain = 0.12, type = 'sine' } = {}) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ac.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export const sound = {
  card() { const ac = audio(); if (ac) noiseBurst(ac, { length: 0.06, freq: 2400 + Math.random() * 800, gain: 0.35 }); },
  flip() { const ac = audio(); if (ac) noiseBurst(ac, { length: 0.04, freq: 4200, q: 1.4, gain: 0.22 }); },
  chip() {
    const ac = audio(); if (!ac) return;
    const base = 2200 + Math.random() * 500;
    tone(ac, { freq: base, length: 0.07, gain: 0.08, type: 'triangle' });
    tone(ac, { at: 0.03, freq: base * 1.32, length: 0.06, gain: 0.05, type: 'triangle' });
    noiseBurst(ac, { length: 0.025, freq: 5000, q: 2, gain: 0.12 });
  },
  chips(count = 4) { for (let i = 0; i < count; i++) setTimeout(() => sound.chip(), i * 55); },
  tick() { const ac = audio(); if (ac) noiseBurst(ac, { length: 0.012, freq: 6000, q: 3, gain: 0.18 }); },
  dice() { const ac = audio(); if (!ac) return; for (let i = 0; i < 6; i++) noiseBurst(ac, { at: i * 0.07 + Math.random() * 0.03, length: 0.035, freq: 1400 + Math.random() * 900, q: 2, gain: 0.3 }); },
  win() { const ac = audio(); if (!ac) return; [523, 659, 784, 1047].forEach((f, i) => tone(ac, { at: i * 0.09, freq: f, length: 0.32, gain: 0.09 })); },
  lose() { const ac = audio(); if (!ac) return; tone(ac, { freq: 220, length: 0.28, gain: 0.06, type: 'triangle' }); tone(ac, { at: 0.12, freq: 174, length: 0.36, gain: 0.05, type: 'triangle' }); },
  push() { const ac = audio(); if (ac) tone(ac, { freq: 440, length: 0.2, gain: 0.06 }); }
};

export function haptic(pattern = 8) {
  try { navigator.vibrate?.(pattern); } catch {}
}

// ---------- numbers ----------
export function formatCH(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (let i = 0; i < units.length; i++) {
    const [size, suffix] = units[i];
    if (abs >= size) {
      const text = trim(abs / size);
      // 999,999 rounds to "1000K"; promote it to the next unit instead.
      if (Number(text) >= 1000 && i > 0) return `${sign}${trim(abs / units[i - 1][0])}${units[i - 1][1]}`;
      return `${sign}${text}${suffix}`;
    }
  }
  return `${sign}${abs}`;
}
function trim(x) { return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/\.?0+$/, ''); }

export const formatFull = value => `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}`;

// Animated number roll for balances and payouts.
export function rollNumber(el, from, to, { duration = 700, format = formatFull } = {}) {
  const d = ms(duration);
  if (d < 80 || from === to) { el.textContent = format(to); return Promise.resolve(); }
  return new Promise(resolve => {
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / d);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}
