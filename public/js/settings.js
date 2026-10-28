// Player preferences, kept on this device: volumes, animation pace, haptics, guides, wake lock.
// Everything else listens with onSettings() and reads with settings.get().

const KEY = 'vegas:settings';

const systemReduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export const DEFAULTS = {
  sfx: 80,          // table sounds, 0–100
  music: 60,        // lounge music, 0–100
  voice: true,      // dealer call-outs (js/voice.js)
  voiceVolume: 80,
  pace: null,       // 'relaxed' | 'normal' | 'fast' | 'minimal'; null follows the system motion setting
  haptics: true,
  guides: true,     // one-line tips during the first hand at each game
  awake: false,     // keep the screen on while sitting at a table
  bjHint: false,
  gestures: true,   // blackjack: tap the felt to hit, wave across it to stand (js/gestures.js)    // blackjack: light up the basic-strategy move on the player's turn
};

// How much each pace stretches or shrinks every animation and pause.
export const PACES = {
  relaxed: { label: '느긋하게', scale: 1.35 },
  normal: { label: '보통', scale: 1 },
  fast: { label: '빠르게', scale: 0.55 },
  minimal: { label: '최소', scale: 0 }
};

let values = { ...DEFAULTS };
try { values = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}

const listeners = new Set();
function emit(key) { listeners.forEach(fn => { try { fn(key, values); } catch {} }); }

export const settings = {
  get(key) { return values[key]; },
  all() { return { ...values }; },
  set(key, value) {
    if (values[key] === value) return;
    values[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {}
    emit(key);
  },
  reset() {
    values = { ...DEFAULTS };
    try { localStorage.removeItem(KEY); } catch {}
    emit(null);
  }
};

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function pace() { return values.pace || (systemReduced() ? 'minimal' : 'normal'); }
export const paceScale = () => PACES[pace()]?.scale ?? 1;

// Mirror the pace on <html> so CSS can drop its own transitions when motion is minimal.
function paintPace() { try { document.documentElement.dataset.pace = pace(); } catch {} }
paintPace();
onSettings(key => { if (key === 'pace' || key === null) paintPace(); });
