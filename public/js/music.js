// Background music: an uptempo Las Vegas big band (brass section, sax, piano, walking bass and a
// swinging drum kit) synthesized live with WebAudio, so there are no audio files to load or license.
// It loops a 16-bar shout chorus in B♭: the brass plays the tune in four-part harmony, then the saxes
// take it while the brass punches hits behind them.
// Event tables (Casino Royale and the rest) switch to a second theme, 'noir': a slow, tense spy
// cue in D minor with a pulsing low ostinato, a string pad, a twangy guitar figure and a
// heartbeat kick, so a high-stakes night sounds like one.
import { audioContext } from './fx.js';
import { settings, onSettings } from './settings.js';

const TEMPO = { lounge: 144, noir: 96 };
let theme = 'lounge';
let BEAT = 60 / TEMPO.lounge;
const SWING = 0.63; // the off-beat eighth lands at 63% of the beat
const FULL = 0.3;
// The settings slider scales the band; 60 (the default) sits a little under full.
const volume = () => FULL * Math.min(1, (settings.get('music') ?? 60) / 75);

// Chords as [root MIDI note, chord tones above the root].
const MAJ6 = [0, 4, 7, 9], DOM7 = [0, 4, 7, 10], MIN7 = [0, 3, 7, 10], DIM7 = [0, 3, 6, 9];
const FORM = [
  [46, MAJ6], [43, DOM7], [48, MIN7], [41, DOM7],
  [46, MAJ6], [46, DOM7], [51, MAJ6], [52, DIM7],
  [46, MAJ6], [43, DOM7], [48, MIN7], [41, DOM7],
  [50, MIN7], [48, MIN7], [41, DOM7], [46, MAJ6]
];
// The tune, bar by bar, as [beat, MIDI note, length in beats]. Off-beats (x.5) are swung.
const TUNE = [
  [[0, 70, .5], [.5, 74, .5], [1, 77, 1], [2.5, 77, .5], [3, 79, 1]],
  [[.5, 77, .5], [1, 74, .5], [1.5, 71, 1.5], [3.5, 74, .5]],
  [[0, 75, 1], [1, 74, .5], [1.5, 72, 1], [3, 70, .5], [3.5, 72, .5]],
  [[0, 69, 2.5], [3.5, 70, .5]],
  [[0, 70, .5], [.5, 74, .5], [1, 77, 1], [2.5, 77, .5], [3, 79, 1]],
  [[.5, 77, .5], [1, 80, 1], [2, 79, .5], [2.5, 77, 1.5]],
  [[0, 79, 1], [1, 75, .5], [1.5, 79, .5], [2, 82, 1.5]],
  [[0, 79, .5], [.5, 76, .5], [1, 73, 1], [2.5, 70, 1]],
  [[0, 77, 1], [1, 74, .5], [1.5, 70, 1.5], [3.5, 74, .5]],
  [[0, 71, .5], [.5, 74, .5], [1, 77, .5], [1.5, 79, 1.5], [3.5, 79, .5]],
  [[0, 79, .5], [.5, 77, .5], [1, 75, 1], [2.5, 72, .5], [3, 75, 1]],
  [[0, 77, 1.5], [2, 72, .5], [2.5, 75, .5], [3, 77, 1]],
  [[0, 77, .5], [.5, 74, 1], [2, 77, .5], [2.5, 81, .5], [3, 84, 1]],
  [[0, 82, 1], [1, 79, .5], [1.5, 75, 1], [3, 79, .5], [3.5, 77, .5]],
  [[0, 75, .5], [.5, 77, .5], [1, 72, 1], [2.5, 69, 1.5]],
  [[0, 70, 1.5], [2.5, 77, .5], [3, 74, .5], [3.5, 70, .5]]
];

const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

let ac = null, bus = null, duckGain = null, timer = null, nextBar = 0, bar = 0, playing = false;

function impulse(seconds = 2.2) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

function build() {
  ac = audioContext();
  if (!ac) return false;
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 7500;
  // A gentle limiter so the brass hits stay loud without clipping.
  const glue = ac.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.ratio.value = 4;
  glue.attack.value = 0.005;
  glue.release.value = 0.15;
  const verb = ac.createConvolver();
  verb.buffer = impulse();
  const wet = ac.createGain();
  wet.gain.value = 0.18;
  // The dealer's voice dips the band through its own stage so it never fights the fade in or out.
  duckGain = ac.createGain();
  duckGain.connect(tone).connect(glue);
  glue.connect(ac.destination);
  glue.connect(verb).connect(wet).connect(ac.destination);
  return true;
}

// Brass: two detuned saws through a filter that opens on the attack, with a slight scoop up
// into the note and a little vibrato on long ones.
function horn(midi, at, length, gain, { bright = 3600, saxy = false } = {}) {
  const f = hz(midi);
  const g = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = saxy ? 2 : 1.2;
  const peak = saxy ? bright * 0.55 : bright;
  lp.frequency.setValueAtTime(peak * 0.25, at);
  lp.frequency.exponentialRampToValueAtTime(peak, at + 0.04);
  lp.frequency.exponentialRampToValueAtTime(peak * 0.55, at + Math.min(length, 0.4));
  const end = at + length;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.025);
  g.gain.setValueAtTime(gain * 0.8, Math.max(at + 0.03, end - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
  const vib = ac.createOscillator();
  const vibDepth = ac.createGain();
  vib.frequency.value = 5.5;
  vibDepth.gain.value = length > BEAT * 1.2 ? f * 0.006 : 0;
  vib.connect(vibDepth);
  for (const detune of saxy ? [-4, 4] : [-7, 0, 7]) {
    const o = ac.createOscillator();
    o.type = saxy ? 'square' : 'sawtooth';
    o.frequency.setValueAtTime(f * 0.97, at);
    o.frequency.exponentialRampToValueAtTime(f, at + 0.045);
    o.detune.value = detune;
    vibDepth.connect(o.frequency);
    o.connect(lp);
    o.start(at);
    o.stop(end + 0.08);
  }
  lp.connect(g).connect(bus);
  vib.start(at);
  vib.stop(end + 0.08);
}

// The section: the lead on top and three chord tones closing in underneath it.
function section(midi, chord, at, length, gain, opts) {
  const [root, tones] = chord;
  const pcs = tones.map(t => (root + t) % 12);
  const under = [];
  for (let m = midi - 1; under.length < 3 && m > midi - 14; m--) if (pcs.includes(m % 12)) under.push(m);
  horn(midi, at, length, gain, opts);
  under.forEach((m, i) => horn(m, at + 0.004 * (i + 1), length, gain * (0.62 - i * 0.08), opts));
}

// Piano: a bright, short comp.
function piano(freq, at, length, gain) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(gain * 0.3, at + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  for (const [mult, level, type] of [[1, 1, 'triangle'], [2, 0.25, 'sine'], [3, 0.08, 'sine']]) {
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    og.gain.value = level;
    o.connect(og).connect(g);
    o.start(at);
    o.stop(at + length + 0.05);
  }
  g.connect(bus);
}

// Upright bass: a plucked low triangle that thumps and dies away.
function bass(freq, at, length) {
  const o = ac.createOscillator();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1100, at);
  f.frequency.exponentialRampToValueAtTime(300, at + 0.2);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.55, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(f).connect(g).connect(bus);
  o.start(at);
  o.stop(at + length + 0.05);
}

let noise = null;
function hiss(at, length, gain, freq, { attack = 0.003, type = 'bandpass', q = 0.8 } = {}) {
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noise;
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(f).connect(g).connect(bus);
  src.start(at, Math.random() * 0.5);
  src.stop(at + length + 0.05);
}

function kick(at, gain) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.setValueAtTime(120, at);
  o.frequency.exponentialRampToValueAtTime(46, at + 0.1);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + 0.22);
}

// Snare: a tight crack of noise over a short tuned body.
function snare(at, gain) {
  hiss(at, 0.16, gain, 2200, { q: 0.6 });
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, at);
  o.frequency.exponentialRampToValueAtTime(170, at + 0.06);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain * 0.9, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + 0.1);
}

function scheduleBar(at, index) {
  const pos = index % FORM.length;
  const chord = FORM[pos];
  const [root, tones] = chord;
  const [nextRoot] = FORM[(pos + 1) % FORM.length];
  const lap = Math.floor(index / FORM.length);
  const t = beat => at + (beat % 1 ? Math.floor(beat) + SWING : beat) * BEAT;

  // The tune: brass shout on even laps, saxes (an octave down) on odd laps with brass hits behind.
  const brassLap = lap % 2 === 0;
  for (const [beat, midi, len] of TUNE[pos]) {
    const length = Math.max(0.09, len * BEAT - 0.03);
    if (brassLap) section(midi, chord, t(beat), length, 0.05);
    else section(midi - 12, chord, t(beat), length, 0.07, { saxy: true });
  }
  if (!brassLap) {
    const hit = Math.max(...tones.map(i => root + 24 + i).filter(m => m < 84));
    if (pos % 2 === 0) section(hit, chord, t(3.5), BEAT * 0.4, 0.045);
    else section(hit, chord, t(1.5), BEAT * 0.3, 0.04);
  }
  // A big "bwaah" swell into the top of the chorus.
  if (pos === FORM.length - 1) section(82, [51, MAJ6], t(3.5), BEAT * 0.9, 0.035, { bright: 4400 });

  // Piano: Charleston stabs on 1 and the and-of-2.
  const voicing = tones.map(i => hz(root + 12 + i));
  voicing.forEach(f => piano(f, at, BEAT * 0.5, 0.03));
  voicing.forEach(f => piano(f, t(1.5), BEAT * 0.45, 0.026));

  // Walking bass: root, chord tone, fifth, then a half step into the next root.
  const r = root - 12 > 40 ? root - 24 : root - 12;
  const n = nextRoot - 12 > 40 ? nextRoot - 24 : nextRoot - 12;
  const walk = [r, r + tones[1], r + 7, n + (index % 2 ? 1 : -1)];
  walk.forEach((m, b) => bass(hz(m), at + b * BEAT, BEAT * 0.9));

  // Drums: ride with the swung skip, snare backbeat on 2 and 4, kick on every beat,
  // a crash at the top of each chorus and a fill to send it round again.
  for (let b = 0; b < 4; b++) {
    hiss(at + b * BEAT, BEAT * 0.8, b % 2 ? 0.05 : 0.04, 8500, { q: 1.2 });
    if (b % 2) hiss(t(b - 0.5), BEAT * 0.35, 0.03, 8500, { q: 1.2 });
    kick(at + b * BEAT, b % 2 ? 0.16 : 0.24);
    if (b % 2 && !(pos === FORM.length - 1 && b === 3)) snare(at + b * BEAT, 0.07);
  }
  if (pos === 0) hiss(at, BEAT * 3.5, 0.07, 6000, { type: 'highpass', q: 0.4 });
  if (pos === FORM.length - 1) [2.5, 3, 3.5].forEach((b, i) => snare(t(b), 0.06 + i * 0.012));
}

// ---------- noir: the event-table theme ----------
const MIN9 = [0, 3, 7, 14], MAJ7 = [0, 4, 7, 11], MIN6 = [0, 3, 7, 9], DOM7B9 = [0, 4, 7, 10, 13];
const NOIR = [[38, MIN9], [38, MIN9], [34, MAJ7], [34, MAJ7], [43, MIN6], [43, MIN6], [45, DOM7B9], [45, DOM7B9]];

// Strings: a slow-blooming, dark pad.
function pad(midi, at, length, gain) {
  const g = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 950;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + length * 0.35);
  g.gain.setValueAtTime(gain, at + length * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.4);
  for (const detune of [-9, 9]) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(midi);
    o.detune.value = detune;
    o.connect(lp);
    o.start(at);
    o.stop(at + length + 0.5);
  }
  lp.connect(g).connect(bus);
}

// A reverb-drenched, twangy guitar pluck with a touch of tremolo-arm bend.
function twang(midi, at, length, gain) {
  const f = hz(midi);
  const o = ac.createOscillator();
  const lp = ac.createBiquadFilter();
  const g = ac.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, at);
  o.frequency.setValueAtTime(f, at + length * 0.6);
  o.frequency.linearRampToValueAtTime(f * 0.985, at + length);
  lp.type = 'lowpass';
  lp.Q.value = 3;
  lp.frequency.setValueAtTime(2600, at);
  lp.frequency.exponentialRampToValueAtTime(700, at + 0.35);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(gain * 0.35, at + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(lp).connect(g).connect(bus);
  o.start(at);
  o.stop(at + length + 0.05);
}

// Timpani: a low, round boom.
function timpani(at, gain, freq = 73) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.setValueAtTime(freq * 1.05, at);
  o.frequency.exponentialRampToValueAtTime(freq, at + 0.15);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + 1.5);
  hiss(at, 0.12, gain * 0.25, 300, { q: 0.7 });
}

function scheduleNoirBar(at, index) {
  const pos = index % NOIR.length;
  const [root, tones] = NOIR[pos];
  const b = beat => at + beat * BEAT;
  // The pad holds each chord for its two bars.
  if (pos % 2 === 0) tones.slice(0, 4).forEach((i, k) => pad(root + 12 + i, at, BEAT * 8, 0.022 - k * 0.003));
  // The ostinato: low eighth notes that never let up, an octave jump at the end of the bar.
  const low = root - 12;
  for (let e = 0; e < 8; e++) bass(hz(e === 6 ? low + 12 : low), b(e / 2), BEAT * (e === 6 ? 0.45 : 0.32));
  // The guitar figure: up the chord on the first bar, a chromatic slide back on the second.
  const top = root + 24;
  const figure = pos % 2 === 0
    ? [[0, top], [1, top + tones[1]], [2, top + tones[2]], [3, top + tones[2] - 1]]
    : [[0, top + tones[2] - 2], [1.5, top + tones[1]], [2.5, top]];
  for (const [beat, midi] of figure) twang(midi, b(beat), BEAT * 1.4, 0.05);
  // Heartbeat kick, a ticking hat, and the timpani at the top of the loop.
  kick(b(0), 0.22);
  kick(b(0.5), 0.12);
  kick(b(2), 0.18);
  for (let e = 0; e < 8; e++) hiss(b(e / 2), BEAT * 0.18, e % 2 ? 0.018 : 0.026, 9000, { q: 1.4 });
  if (pos === 0) timpani(at, 0.35);
  // The turnaround: low brass swells over the dominant and the drums roll back to the top.
  if (pos === NOIR.length - 2) section(57, NOIR[pos], b(0), BEAT * 7.5, 0.028, { bright: 1400 });
  if (pos === NOIR.length - 1) [2.5, 3, 3.25, 3.5, 3.75].forEach((beat, k) => timpani(b(beat), 0.12 + k * 0.04, 73 + (k % 2) * 9));
}

function tick() {
  while (nextBar < ac.currentTime + 1.2) {
    if (theme === 'noir') scheduleNoirBar(nextBar, bar++);
    else scheduleBar(nextBar, bar++);
    nextBar += BEAT * 4;
  }
}

export const music = {
  get playing() { return playing; },
  start() {
    if (playing || volume() <= 0) return;
    if (!ac && !build()) return;
    if (ac.state === 'suspended') ac.resume();
    playing = true;
    // Each start gets its own bus, so notes already queued by a theme that is fading out die
    // away on their own instead of jumping back up with the new one.
    bus = ac.createGain();
    bus.gain.value = 0.0001;
    bus.connect(duckGain);
    BEAT = 60 / TEMPO[theme];
    bar = 0;
    nextBar = ac.currentTime + 0.1;
    bus.gain.setValueAtTime(0.0001, ac.currentTime);
    bus.gain.exponentialRampToValueAtTime(volume(), ac.currentTime + (theme === 'noir' ? 2 : 3));
    tick();
    timer = setInterval(tick, 200);
  },
  stop() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    bus.gain.cancelScheduledValues(ac.currentTime);
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), ac.currentTime);
    bus.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.8);
  },
  // 'lounge' for the casino floor, 'noir' for the event tables; a change crossfades.
  theme(name) {
    if (!TEMPO[name] || name === theme) return;
    theme = name;
    if (!playing) return;
    this.stop();
    this.start();
  },
  duck(on) {
    if (!duckGain) return;
    const now = ac.currentTime;
    duckGain.gain.cancelScheduledValues(now);
    duckGain.gain.setValueAtTime(duckGain.gain.value, now);
    duckGain.gain.linearRampToValueAtTime(on ? 0.4 : 1, now + (on ? 0.12 : 0.6));
  }
};

// Slider moves are heard right away; at zero the music stops, above zero it comes back.
onSettings(key => {
  if (key !== 'music' && key !== null) return;
  if (!playing) return; // the app restarts it through syncMusic()
  if (volume() <= 0) { music.stop(); return; }
  bus.gain.cancelScheduledValues(ac.currentTime);
  bus.gain.setTargetAtTime(volume(), ac.currentTime, 0.08);
});
