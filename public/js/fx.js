// Shared feel layer: motion timing, synthesized table sounds, haptics, number formatting.
import { settings, onSettings, pace, paceScale } from './settings.js';

// "Minimal" pace comes from the settings screen, or from the system setting until one is picked.
export const reducedMotion = () => pace() === 'minimal';

// Every duration follows the chosen pace; minimal shrinks it to near-instant.
export const ms = value => (reducedMotion() ? Math.min(value, 60) : Math.round(value * paceScale()));
export const wait = value => new Promise(resolve => setTimeout(resolve, ms(value)));

export function animate(el, keyframes, options) {
  const opts = typeof options === 'number' ? { duration: options } : { ...options };
  opts.duration = ms(opts.duration ?? 300);
  if (opts.delay) opts.delay = ms(opts.delay);
  const anim = el.animate(keyframes, { fill: 'both', easing: 'cubic-bezier(.2,.8,.2,1)', ...opts });
  return anim.finished.catch(() => {});
}

// Moves `el` visually from `fromRect` to where it currently sits in layout (FLIP).
// `settle` lets a thrown card slide a hair past its spot and drift back, the way paper skids on felt.
export function flyFrom(el, fromRect, { duration = 420, delay = 0, lift = 0, spin = 0, scale = 0.9, easing, settle = false } = {}) {
  const to = el.getBoundingClientRect();
  const dx = fromRect.left + fromRect.width / 2 - (to.left + to.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (to.top + to.height / 2);
  const len = Math.hypot(dx, dy) || 1;
  const skid = Math.min(6, len * 0.04);
  const frames = lift
    ? [
        { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg) scale(${scale})` },
        { transform: `translate(${dx / 2}px,${dy / 2 - lift}px) rotate(${spin / 2}deg) scale(${(1 + scale) / 2 + 0.08})`, offset: 0.5 },
        ...(settle ? [{ transform: `translate(${-dx / len * skid}px,${-dy / len * skid}px) rotate(${-spin * 0.04}deg) scale(1)`, offset: 0.84 }] : []),
        { transform: 'translate(0,0) rotate(0) scale(1)' }
      ]
    : [
        { transform: `translate(${dx}px,${dy}px) rotate(${spin}deg) scale(${scale})` },
        { transform: 'translate(0,0) rotate(0) scale(1)' }
      ];
  // Chips are heavy: a thrown one lands with a short press into the felt instead of stopping dead.
  if (lift && el.classList.contains('chip') && !reducedMotion()) {
    const end = frames.pop();
    frames.push({ transform: 'translate(0,0) rotate(0) scale(.93)', offset: 0.9 }, end);
  }
  // While it is in the air a thing casts a wide, soft shadow; the shadow tightens as it lands.
  if (lift) el.classList.add('is-airborne');
  const done = animate(el, frames, { duration, delay, easing: easing || 'cubic-bezier(.16,.84,.3,1)', fill: 'backwards' });
  return lift ? done.then(() => el.classList.remove('is-airborne')) : done;
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

// Like flyTo, but for chips leaving the felt: the felt clips its overflow, so a chip headed for the
// wallet in the top bar would vanish at the felt's edge. A fixed-position copy makes the trip
// instead, landing on top of everything, and the original is hidden for the ride.
export function flyOut(el, toRect, opts = {}) {
  const r = el.getBoundingClientRect();
  if (!r.width) return Promise.resolve();
  const c = el.cloneNode(true);
  c.classList.add('chip-flyer');
  Object.assign(c.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  c.style.setProperty('--size', `${r.width}px`);
  document.body.append(c);
  el.style.visibility = 'hidden';
  return flyTo(c, toRect, opts).then(() => { c.remove(); opts.onLand?.(); });
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

let sfxBus = null;
const sfxLevel = () => (settings.get('sfx') ?? 80) / 100;

// Shared with the background music so everything runs on one clock.
export function audioContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxLevel();
    sfxBus.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
onSettings(key => { if (sfxBus && (key === 'sfx' || key === null)) sfxBus.gain.setTargetAtTime(sfxLevel(), ctx.currentTime, 0.02); });

// Table sounds go through their own volume; at zero they are skipped entirely.
function audio() {
  if (muted || sfxLevel() <= 0) return null;
  return audioContext();
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
  src.connect(filter).connect(g).connect(sfxBus);
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
  osc.connect(g).connect(sfxBus);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

// ---------- recorded table sounds ----------
// Real cards, chips and dice from Kenney's Casino Audio (CC0, see public/sfx/CREDITS.md), cut short
// and stored as small .m4a files. They load once the first sound plays; until a recording is ready
// (or on a device that cannot decode it) the synthesized version above stands in.
export const SFX_FILES = [
  'card-deal-1', 'card-deal-2', 'card-deal-3', 'card-deal-4', 'card-flip-1', 'card-flip-2',
  'card-place-1', 'card-place-2', 'card-place-3', 'card-gather-1', 'card-gather-2', 'card-shuffle', 'card-fan',
  'chip-lay-1', 'chip-lay-2', 'chip-lay-3', 'chips-stack-1', 'chips-stack-2', 'chips-stack-3', 'chips-stack-4',
  'chips-stack-5', 'chips-stack-6', 'chips-collide-1', 'chips-collide-2', 'chips-collide-3', 'chips-collide-4',
  'chips-handle-1', 'chips-handle-5', 'chips-handle-6', 'dice-shake-1', 'dice-shake-2',
  'die-throw-1', 'die-throw-2', 'die-throw-3', 'die-throw-4'
];
// Each table sound picks one of its takes at random, so a run of deals never sounds looped.
export const SFX_SETS = {
  deal: ['card-deal-1', 'card-deal-2', 'card-deal-3', 'card-deal-4'],
  flip: ['card-flip-1', 'card-flip-2'],
  place: ['card-place-1', 'card-place-2', 'card-place-3'],
  gather: ['card-gather-1', 'card-gather-2'],
  shuffle: ['card-shuffle'],
  fan: ['card-fan'],
  chip: ['chip-lay-1', 'chip-lay-2', 'chip-lay-3', 'chips-stack-1', 'chips-stack-2', 'chips-stack-5'],
  stack: ['chips-stack-1', 'chips-stack-2', 'chips-stack-4', 'chips-stack-5', 'chips-stack-6'],
  collide: ['chips-collide-1', 'chips-collide-2', 'chips-collide-3', 'chips-collide-4'],
  rake: ['chips-handle-5', 'chips-handle-1', 'chips-handle-6'],
  shake: ['dice-shake-1', 'dice-shake-2'],
  throw: ['die-throw-1', 'die-throw-2', 'die-throw-3', 'die-throw-4']
};
const buffers = new Map();
const levels = new Map();
// The takes were matched by peak, so a hot one (a sharp slide) can sound twice as loud as its
// neighbours. Even them out by average loudness.
function levelOf(buffer) {
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / Math.max(1, data.length));
  return rms > 0 ? Math.min(1.3, Math.max(0.5, 0.06 / rms)) : 1;
}
let loading = null;
function loadSamples(ac) {
  if (loading) return loading;
  loading = Promise.all(SFX_FILES.map(name => fetch(`sfx/${name}.m4a`)
    .then(res => (res.ok ? res.arrayBuffer() : null))
    .then(buf => (buf ? new Promise((resolve, reject) => ac.decodeAudioData(buf, resolve, reject)) : null))
    .then(decoded => { if (decoded) { buffers.set(name, decoded); levels.set(name, levelOf(decoded)); } })
    .catch(() => {})));
  return loading;
}
const lastTake = {};
// Play one take from a set. Returns false when nothing is loaded yet, so the caller can fall back.
function sample(ac, set, { at = 0, gain = 0.7, rate = 1, jitter = 0.04 } = {}) {
  loadSamples(ac);
  const takes = SFX_SETS[set].filter(n => buffers.has(n));
  if (!takes.length) return false;
  let pick = takes[Math.floor(Math.random() * takes.length)];
  if (takes.length > 1 && pick === lastTake[set]) pick = takes[(takes.indexOf(pick) + 1) % takes.length];
  lastTake[set] = pick;
  const src = ac.createBufferSource();
  src.buffer = buffers.get(pick);
  src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
  const g = ac.createGain();
  g.gain.value = gain * (levels.get(pick) || 1) * (0.88 + Math.random() * 0.12);
  src.connect(g).connect(sfxBus);
  src.start(ac.currentTime + at);
  return true;
}
// Start fetching the recordings early (on the first tap) so the first card dealt is already real.
export function preloadSounds() { const ac = audio(); if (ac) loadSamples(ac); }

const synth = {
  card(ac) { noiseBurst(ac, { length: 0.06, freq: 2400 + Math.random() * 800, gain: 0.35 }); },
  flip(ac) { noiseBurst(ac, { length: 0.04, freq: 4200, q: 1.4, gain: 0.22 }); },
  chip(ac) {
    const base = 2200 + Math.random() * 500;
    tone(ac, { freq: base, length: 0.07, gain: 0.08, type: 'triangle' });
    tone(ac, { at: 0.03, freq: base * 1.32, length: 0.06, gain: 0.05, type: 'triangle' });
    noiseBurst(ac, { length: 0.025, freq: 5000, q: 2, gain: 0.12 });
  },
  dice(ac) { for (let i = 0; i < 6; i++) noiseBurst(ac, { at: i * 0.07 + Math.random() * 0.03, length: 0.035, freq: 1400 + Math.random() * 900, q: 2, gain: 0.3 }); },
  win(ac) { [523, 659, 784, 1047].forEach((f, i) => tone(ac, { at: i * 0.09, freq: f, length: 0.32, gain: 0.09 })); },
  lose(ac) { tone(ac, { freq: 220, length: 0.28, gain: 0.06, type: 'triangle' }); tone(ac, { at: 0.12, freq: 174, length: 0.36, gain: 0.05, type: 'triangle' }); },
  push(ac) { tone(ac, { freq: 440, length: 0.2, gain: 0.06 }); }
};

export const sound = {
  // A card slid out of the shoe onto the felt.
  card() { const ac = audio(); if (ac && !sample(ac, 'deal', { gain: 0.6 })) synth.card(ac); },
  // A card turned over.
  flip() { const ac = audio(); if (ac && !sample(ac, 'flip', { gain: 0.75 })) synth.flip(ac); },
  // A card played down hard, the way a hwatu card is slapped onto the blanket.
  slap() { const ac = audio(); if (ac && !sample(ac, 'place', { gain: 0.8 })) synth.card(ac); },
  // The deck riffled before a new hand.
  shuffle() { const ac = audio(); if (ac && !sample(ac, 'shuffle', { gain: 0.8, jitter: 0.02 })) synth.card(ac); },
  // The dealer sweeping the cards in.
  gather() { const ac = audio(); if (ac) sample(ac, 'gather', { gain: 0.6 }); },
  chip() { const ac = audio(); if (ac && !sample(ac, 'chip', { gain: 0.9, jitter: 0.06 })) synth.chip(ac); },
  // A short run of chips dropping onto a stack.
  chips(count = 4) {
    const ac = audio(); if (!ac) return;
    const n = Math.max(1, Math.min(count, 8));
    for (let i = 0; i < n; i++) {
      const at = i * 0.055 + Math.random() * 0.015;
      if (!sample(ac, 'stack', { at, gain: 0.8 - i * 0.05, jitter: 0.06 })) { setTimeout(() => sound.chip(), at * 1000); }
    }
  },
  tick() { const ac = audio(); if (ac) noiseBurst(ac, { length: 0.012, freq: 6000, q: 3, gain: 0.18 }); },
  // Dice rattled in a hand or under the dome.
  shake() { const ac = audio(); if (ac) sample(ac, 'shake', { gain: 0.75 }); },
  // Three dice landing, a beat apart.
  dice() {
    const ac = audio(); if (!ac) return;
    let ok = true;
    for (let i = 0; i < 3; i++) ok = sample(ac, 'throw', { at: i * 0.07 + Math.random() * 0.05, gain: 0.7 - i * 0.08 }) && ok;
    if (!ok) synth.dice(ac);
  },
  // A win: the payout pushed over and stacked, chips clattering together.
  win() {
    const ac = audio(); if (!ac) return;
    if (!sample(ac, 'rake', { gain: 0.6 })) return synth.win(ac);
    [0.16, 0.24, 0.31, 0.37].forEach((at, i) => sample(ac, 'stack', { at, gain: 0.8 - i * 0.08, jitter: 0.07 }));
  },
  // A loss: no fanfare, just the dealer taking the cards and chips away.
  lose() {
    const ac = audio(); if (!ac) return;
    if (!sample(ac, 'gather', { gain: 0.55 })) return synth.lose(ac);
    sample(ac, 'rake', { at: 0.18, gain: 0.3, rate: 0.92 });
  },
  // A push: two chips knocked together, the bet stays.
  push() { const ac = audio(); if (ac && !sample(ac, 'collide', { gain: 0.85 })) synth.push(ac); },
  // A lightning strike: a dry crack, then a low roll under it.
  strike() {
    const ac = audio(); if (!ac) return;
    noiseBurst(ac, { length: 0.05, freq: 5200, q: 0.8, gain: 0.32 });
    noiseBurst(ac, { at: 0.03, length: 0.4, freq: 180, q: 0.7, gain: 0.4 });
    tone(ac, { at: 0.02, freq: 1760, length: 0.1, gain: 0.04, type: 'square' });
  },
  // The call to the post before a race: a short bugle fanfare.
  bugle() {
    const ac = audio(); if (!ac) return;
    [[392, 0, 0.16], [523, 0.17, 0.16], [659, 0.34, 0.16], [784, 0.51, 0.3], [659, 0.84, 0.14], [784, 1.0, 0.5]]
      .forEach(([freq, at, length]) => { tone(ac, { at, freq, length, gain: 0.07, type: 'triangle' }); tone(ac, { at, freq: freq * 2, length, gain: 0.018, type: 'square' }); });
  },
  // The wallet draining on a bust: chips raked away again and again while a low tone sinks.
  drain(seconds = 1.5) {
    const ac = audio(); if (!ac) return;
    for (let at = 0; at < seconds; at += 0.22) if (!sample(ac, 'rake', { at, gain: 0.28, rate: 1.05 - at * 0.15, jitter: 0.04 })) noiseBurst(ac, { at, length: 0.08, freq: 1800 - at * 600, gain: 0.12 });
    const osc = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + seconds);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.1);
    osc.connect(g).connect(sfxBus);
    osc.start(t); osc.stop(t + seconds + 0.15);
  },
  // Hitting 0: a low thud, then a quiet two-note "womp womp" sinking under it.
  thud() {
    const ac = audio(); if (!ac) return;
    noiseBurst(ac, { length: 0.35, freq: 110, q: 0.6, gain: 0.55 });
    tone(ac, { freq: 55, length: 0.5, gain: 0.12 });
    [[233, 0.45, 0.32], [220, 0.8, 0.7]].forEach(([freq, at, length]) => {
      const osc = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.84, t + length);
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(f).connect(g).connect(sfxBus);
      osc.start(t); osc.stop(t + length + 0.05);
    });
  },
  // A big win climbing a level (BIG → HUGE → MEGA): a bright rising chord.
  levelUp(level = 2) {
    const ac = audio(); if (!ac) return;
    const base = level >= 3 ? 659 : 523;
    [1, 1.25, 1.5, 2].forEach((k, i) => tone(ac, { at: i * 0.05, freq: base * k, length: 0.4, gain: 0.07, type: 'triangle' }));
    noiseBurst(ac, { length: 0.25, freq: 7000, q: 0.5, gain: 0.08 });
  },
  // A camera shutter for the photo finish.
  shutter() { const ac = audio(); if (!ac) return; noiseBurst(ac, { length: 0.03, freq: 3500, q: 1.2, gain: 0.3 }); noiseBurst(ac, { at: 0.07, length: 0.04, freq: 2200, q: 1.2, gain: 0.25 }); }
};

export function haptic(pattern = 8) {
  if (!settings.get('haptics')) return;
  try { navigator.vibrate?.(pattern); } catch {}
}

// ---------- numbers ----------
// One money format for the whole app, shared with the server's notification text (./money.js).
export { formatCH, formatMoney, moneyResult } from './money.js';
import { formatCH } from './money.js';

// Animated number roll for balances and payouts.
export function rollNumber(el, from, to, { duration = 700, format = formatCH, ease = t => 1 - Math.pow(1 - t, 3) } = {}) {
  const d = ms(duration);
  if (d < 80 || from === to) { el.textContent = format(to); return Promise.resolve(); }
  return new Promise(resolve => {
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / d);
      const eased = ease(t);
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
