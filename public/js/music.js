// Background music: an uptempo Las Vegas big band (brass section, sax, piano, walking bass and a
// swinging drum kit) synthesized live with WebAudio, so there are no audio files to load or license.
// It loops a 16-bar shout chorus in B♭: the brass plays the tune in four-part harmony, then the saxes
// take it while the brass punches hits behind them.
// Every game also has its own band (THEMES, below): swing for blackjack, a mambo at roulette,
// bossa nova at baccarat, disco at Sic Bo, surf rock at the slots, spy jazz at Hold'em and
// Korean folk bands at the hwatu tables.
// Event tables (Casino Royale and the rest) switch to a second theme, 'noir': a slow, tense spy
// cue in D minor with a pulsing low ostinato, a string pad, a twangy guitar figure and a
// heartbeat kick, so a high-stakes night sounds like one.
import { audioContext } from './fx.js';
import { settings, onSettings } from './settings.js';

let theme = 'lounge';
let BEAT = 60 / 144;
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

// ---------- one theme per table ----------
// Each game has its own band so walking to another table sounds like walking into another room.
// Every scheduler gets the bar's start time and its index and lays out four beats.

// Small kit pieces the table themes share.
function tom(at, gain, freq) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.setValueAtTime(freq * 1.5, at);
  o.frequency.exponentialRampToValueAtTime(freq, at + 0.04);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + 0.3);
}
function ping(at, freq, gain, length = 0.08, type = 'sine') {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + length + 0.02);
}
const clap = (at, gain) => { [0, 0.012, 0.024].forEach(d => hiss(at + d, 0.09, gain, 1500, { q: 0.9 })); };
const cowbell = (at, gain) => { const lp = 0.07; ping(at, 560, gain, lp, 'square'); ping(at, 845, gain * 0.7, lp, 'square'); };

// A plucked string: guitar, gayageum or harp depending on brightness and decay.
function pluck(midi, at, length, gain, { bright = 3000, bend = 0, type = 'sawtooth' } = {}) {
  const f = hz(midi);
  const o = ac.createOscillator();
  const lp = ac.createBiquadFilter();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, at);
  // 농현: a gayageum player presses the string after the pluck, so the note sags or rises.
  if (bend) { o.frequency.setValueAtTime(f, at + length * 0.35); o.frequency.linearRampToValueAtTime(f * Math.pow(2, bend / 12), at + length * 0.8); }
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(bright, at);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, bright / 5), at + 0.3);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(lp).connect(g).connect(bus);
  o.start(at);
  o.stop(at + length + 0.05);
}

// A wind lead: flute (pure, breathy) or piri (nasal, reedy) with vibrato that blooms late.
function wind(midi, at, length, gain, { reed = false } = {}) {
  const f = hz(midi);
  const g = ac.createGain();
  const tone = ac.createBiquadFilter();
  tone.type = reed ? 'bandpass' : 'lowpass';
  tone.frequency.value = reed ? 1400 : 4000;
  tone.Q.value = reed ? 1.4 : 0.5;
  const end = at + length;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + (reed ? 0.03 : 0.06));
  g.gain.setValueAtTime(gain * 0.85, Math.max(at + 0.07, end - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, end + 0.06);
  const o = ac.createOscillator();
  o.type = reed ? 'sawtooth' : 'sine';
  o.frequency.setValueAtTime(reed ? f * 0.96 : f, at);
  o.frequency.exponentialRampToValueAtTime(f, at + 0.05);
  const vib = ac.createOscillator();
  const depth = ac.createGain();
  vib.frequency.value = reed ? 6.2 : 5;
  depth.gain.setValueAtTime(0, at);
  depth.gain.linearRampToValueAtTime(length > 0.3 ? f * (reed ? 0.012 : 0.007) : 0, at + Math.min(length, 0.5));
  vib.connect(depth).connect(o.frequency);
  o.connect(tone).connect(g).connect(bus);
  if (!reed) hiss(at, Math.min(length, 0.2), gain * 0.25, 5000, { q: 0.5 });
  o.start(at); o.stop(end + 0.08);
  vib.start(at); vib.stop(end + 0.08);
}

// Lays a tune written relative to the chord root ([beat, semitones, length]) at a register.
const play = (notes, base, voice, t) => notes.forEach(([beat, step, len]) => voice(base + step, t(beat), len));
const swing = at => beat => at + (beat % 1 ? Math.floor(beat) + SWING : beat) * BEAT;
const straight = at => beat => at + beat * BEAT;
const near = (root, lo) => { let m = root; while (m < lo) m += 12; while (m >= lo + 12) m -= 12; return m; };

// Blackjack: a fast hard-bop combo on an F-minor blues. Muted trumpet and tenor trade the riff.
const BLUES = [53, 53, 53, 53, 58, 58, 53, 53, 49, 48, 53, 48];
const RIFF_A = [[0, 0, .5], [.5, 3, .5], [1, 5, .5], [1.5, 7, 1], [3, 10, .5], [3.5, 7, .5]];
const RIFF_B = [[0, 5, 1.5], [2, 3, .5], [2.5, 0, 1], [3.5, -2, .5]];
function blackjackBar(at, index) {
  const pos = index % BLUES.length, lap = Math.floor(index / BLUES.length);
  const root = BLUES[pos], next = BLUES[(pos + 1) % BLUES.length];
  const t = swing(at);
  const dom = pos === 8 || pos === 9 || pos === 11;
  const lead = near(root, 65);
  const riff = pos % 2 ? RIFF_B : RIFF_A;
  if (lap % 2 === 0) play(riff, lead, (m, s, l) => horn(m, s, l * BEAT - 0.03, 0.06, { bright: 2400 }), t);
  else play(riff, lead - 12, (m, s, l) => horn(m, s, l * BEAT - 0.03, 0.075, { saxy: true }), t);
  // Piano shells on the and-of-2 and 4.
  const third = dom ? 4 : 3;
  [root + third + 12, root + 10 + 12].forEach(m => { piano(hz(m), t(1.5), BEAT * 0.4, 0.03); piano(hz(m), t(3), BEAT * 0.5, 0.025); });
  const r = near(root, 36), n = near(next, 36);
  [r, r + third, r + 7, n + (index % 2 ? 1 : -1)].forEach((m, b) => bass(hz(m), at + b * BEAT, BEAT * 0.9));
  for (let b = 0; b < 4; b++) {
    hiss(at + b * BEAT, BEAT * 0.7, 0.045, 8500, { q: 1.2 });
    if (b % 2) { hiss(t(b - 0.5), BEAT * 0.3, 0.03, 8500, { q: 1.2 }); hiss(at + b * BEAT, 0.05, 0.03, 6000, { q: 2 }); }
    kick(at + b * BEAT, 0.12);
  }
  // Snare "bombs" that push the band along.
  if (index % 2) snare(t(2.5), 0.05);
  if (pos === BLUES.length - 1) [2, 2.5, 3, 3.5].forEach((b, k) => snare(t(b), 0.04 + k * 0.012));
}

// Roulette: a mambo in A minor with a piano montuno, tumbao bass, clave, congas and cowbell.
const MAMBO = [[57, [0, 3, 7]], [57, [0, 3, 7]], [62, [0, 3, 7]], [62, [0, 3, 7]], [64, [0, 4, 7, 10]], [64, [0, 4, 7, 10]], [57, [0, 3, 7]], [64, [0, 4, 7, 10]]];
const MAMBO_TUNE = [
  [[0, 7, .5], [.5, 12, .5], [1.5, 10, .5], [2, 12, 1], [3.5, 15, .5]],
  [[.5, 14, .5], [1, 12, .5], [1.5, 10, 1], [3, 7, 1]],
  [[0, 7, .5], [.5, 12, .5], [1.5, 10, .5], [2, 7, .5], [2.5, 5, 1]],
  [[.5, 3, .5], [1, 5, .5], [1.5, 7, 2]],
  [[0, 11, .5], [.5, 12, .5], [1, 14, .5], [1.5, 16, 1.5], [3.5, 14, .5]],
  [[0, 12, 1], [1, 11, .5], [1.5, 7, 1.5], [3.5, 8, .5]],
  [[0, 7, .5], [.5, 12, .5], [1.5, 15, .5], [2, 14, .5], [2.5, 12, 1]],
  [[0, 11, 1], [1.5, 8, .5], [2, 7, 1.5]]
];
function rouletteBar(at, index) {
  const pos = index % MAMBO.length, lap = Math.floor(index / MAMBO.length);
  const [root, tones] = MAMBO[pos];
  const t = straight(at);
  // Montuno: the piano's syncopated octaves.
  const chord = tones.map(i => root + i);
  [[0, 0], [0.5, 1], [1, 2], [1.5, 1], [2.5, 0], [3, 2], [3.5, 1]].forEach(([b, k]) => { piano(hz(chord[k % chord.length] + 12), t(b), BEAT * 0.35, 0.028); piano(hz(chord[k % chord.length]), t(b), BEAT * 0.35, 0.02); });
  // Tumbao: the bass lands on the and-of-2 and on 4, ahead of the chord.
  const r = near(root, 33);
  bass(hz(r), t(1.5), BEAT * 1.3);
  bass(hz(r + 7), t(3), BEAT * 0.9);
  // Horns: the tune on even laps, punchy hits on odd ones.
  if (lap % 2 === 0) play(MAMBO_TUNE[pos], 69, (m, s, l) => section(m, [root, tones], s, l * BEAT - 0.03, 0.05, { bright: 4200 }), t);
  else if (pos % 2) [2.5, 3.5].forEach(b => section(81 + (pos % 4 === 1 ? 0 : -2), [root, tones], t(b), BEAT * 0.3, 0.04, { bright: 4400 }));
  // Clave 3-2, congas, cowbell on every beat.
  (pos % 2 ? [1, 2] : [0, 1.5, 3]).forEach(b => ping(t(b), 2500, 0.05, 0.05));
  [[1, 330, 0.12], [1.5, 330, 0.08], [3, 250, 0.14], [3.5, 250, 0.12]].forEach(([b, f, g]) => tom(t(b), g, f));
  for (let b = 0; b < 4; b++) cowbell(t(b), b ? 0.025 : 0.035);
  kick(t(0), 0.16); kick(t(2.5), 0.12);
  for (let e = 0; e < 8; e++) hiss(t(e / 2), 0.06, 0.016, 7000, { q: 1 });
  if (pos === MAMBO.length - 1) [3, 3.25, 3.5, 3.75].forEach((b, k) => tom(t(b), 0.1 + k * 0.02, 200 - k * 25));
}

// Baccarat: a Riviera bossa nova. Nylon guitar comping, cross-stick, shaker and a flute tune.
const BOSSA = [[50, [0, 4, 7, 11]], [50, [0, 4, 7, 11]], [52, [0, 4, 7, 10]], [52, [0, 4, 7, 10]], [52, [0, 3, 7, 10]], [57, [0, 4, 7, 10]], [50, [0, 4, 7, 11]], [57, [0, 4, 7, 10]]];
const BOSSA_TUNE = [
  [[0, 9, 1.5], [1.5, 7, .5], [2, 9, .5], [2.5, 11, 1.5]],
  [[0, 14, 1], [1.5, 11, .5], [2, 9, 2]],
  [[0, 8, 1.5], [1.5, 6, .5], [2, 8, .5], [2.5, 10, 1.5]],
  [[0, 12, 1], [1.5, 10, .5], [2, 8, 2]],
  [[0, 7, 1.5], [1.5, 10, .5], [2, 12, .5], [2.5, 14, 1.5]],
  [[0, 4, .5], [.5, 7, .5], [1, 9, 1], [2, 7, .5], [2.5, 6, 1.5]],
  [[0, 9, 1], [1, 11, .5], [1.5, 7, 2.5]],
  [[1, 4, .5], [1.5, 6, .5], [2, 7, .5], [2.5, 4, 1.5]]
];
function baccaratBar(at, index) {
  const pos = index % BOSSA.length;
  const [root, tones] = BOSSA[pos];
  const t = straight(at);
  // Guitar: thumb on the root and fifth, fingers on the syncopations.
  const r = near(root, 40);
  pluck(r, t(0), BEAT * 1.4, 0.07, { bright: 1400, type: 'triangle' });
  pluck(r + 7, t(2), BEAT * 1.4, 0.06, { bright: 1400, type: 'triangle' });
  const comp = pos % 2 ? [0.5, 2, 3] : [0, 1.5, 2.5];
  comp.forEach(b => tones.slice(1).forEach((i, k) => pluck(near(root, 55) + i, t(b) + k * 0.01, BEAT * 0.9, 0.03, { bright: 2400, type: 'triangle' })));
  bass(hz(near(root, 36)), t(0), BEAT * 1.6);
  bass(hz(near(root, 36) + 7), t(2), BEAT * 1.6);
  play(BOSSA_TUNE[pos], 74, (m, s, l) => wind(m, s, l * BEAT - 0.03, 0.06), t);
  // Cross-stick on the guitar's rhythm, a shaker on every sixteenth, a soft kick.
  [0, 1.5, 3, 2.5].slice(0, pos % 2 ? 2 : 3).forEach(b => ping(t(b), 1900, 0.04, 0.03, 'triangle'));
  for (let s = 0; s < 16; s++) hiss(t(s / 4), 0.05, s % 4 === 2 ? 0.022 : 0.012, 9000, { q: 1.2 });
  kick(t(0), 0.12); kick(t(2), 0.1);
}

// Sic Bo: Vegas disco. Four on the floor, octave bass, clavinet funk, string and brass stabs.
const DISCO = [55, 55, 60, 60, 63, 62, 55, 55];
function diceBar(at, index) {
  const pos = index % DISCO.length, lap = Math.floor(index / DISCO.length);
  const root = DISCO[pos];
  const minor = pos !== 2 && pos !== 3 && pos !== 5;
  const tones = minor ? [0, 3, 7, 10] : [0, 4, 7, 10];
  const t = straight(at);
  const r = near(root, 31);
  for (let e = 0; e < 8; e++) bass(hz(e % 2 ? r + 12 : r), t(e / 2), BEAT * 0.4);
  // Clavinet: a sixteenth-note funk chop.
  [0, 0.75, 1.5, 2, 2.75, 3.5].forEach(b => tones.slice(1).forEach(i => pluck(near(root, 60) + i, t(b), BEAT * 0.2, 0.02, { bright: 3500, type: 'square' })));
  // Strings on the even lap, brass riff on the odd one.
  if (lap % 2 === 0) { if (pos % 2 === 0) tones.forEach((i, k) => pad(near(root, 67) + i, at, BEAT * 7, 0.016 - k * 0.002)); }
  else [[0.5, 12], [1, 10], [1.5, 7], [3, 10], [3.5, 12]].forEach(([b, s]) => section(near(root, 67) + s, [root, tones], t(b), BEAT * 0.4, 0.045, { bright: 4400 }));
  for (let b = 0; b < 4; b++) {
    kick(t(b), 0.24);
    hiss(t(b + 0.5), BEAT * 0.45, 0.04, 8000, { q: 0.8 });
    hiss(t(b), 0.04, 0.02, 9000, { q: 1.5 });
    if (b % 2) clap(t(b), 0.05);
  }
  if (pos === DISCO.length - 1) [2, 2.5, 3, 3.5].forEach((b, k) => tom(t(b), 0.14, 180 - k * 30));
}

// Slots: surf rock with a jackpot sparkle. Tremolo-picked twang lead, driving drums, bell arpeggios.
const SURF = [52, 52, 57, 57, 59, 57, 52, 59];
const SURF_TUNE = [
  [[0, 7, 1], [1, 12, 1], [2, 11, .5], [2.5, 9, .5], [3, 7, 1]],
  [[0, 4, 1], [1, 7, .5], [1.5, 9, .5], [2, 7, 2]],
  [[0, 4, 1], [1, 7, 1], [2, 9, .5], [2.5, 7, .5], [3, 4, 1]],
  [[0, 2, 1], [1, 4, .5], [1.5, 7, .5], [2, 4, 2]],
  [[0, 7, 1], [1, 11, 1], [2, 14, 2]],
  [[0, 12, 1], [1, 9, 1], [2, 7, .5], [2.5, 4, 1.5]],
  [[0, 7, .5], [.5, 9, .5], [1, 12, 1], [2, 11, .5], [2.5, 9, 1.5]],
  [[0, 7, 2], [2.5, 2, .5], [3, 5, .5], [3.5, 6, .5]]
];
function slotsBar(at, index) {
  const pos = index % SURF.length, lap = Math.floor(index / SURF.length);
  const root = SURF[pos];
  const t = straight(at);
  // The lead is tremolo-picked: every note repeats on the sixteenths.
  for (const [beat, step, len] of SURF_TUNE[pos]) {
    const m = near(root, 64) + step - (near(root, 64) - near(SURF[0], 64));
    for (let s = 0; s < len * 4; s++) twang(m, t(beat + s / 4), BEAT * 0.3, s ? 0.035 : 0.05);
  }
  const r = near(root, 40);
  for (let e = 0; e < 8; e++) bass(hz(e === 7 ? r + 7 : r), t(e / 2), BEAT * 0.42);
  // Rhythm guitar chops on the off-beats.
  [0.5, 1.5, 2.5, 3.5].forEach(b => [0, 4, 7].forEach(i => pluck(near(root, 52) + i, t(b), BEAT * 0.25, 0.022, { bright: 2600 })));
  // On the second lap, bells spin up the chord like reels.
  if (lap % 2) for (let s = 0; s < 16; s++) ping(t(s / 4), hz(near(root, 76) + [0, 4, 7, 12][s % 4]), 0.022, 0.12, 'triangle');
  for (let e = 0; e < 8; e++) hiss(t(e / 2), BEAT * 0.25, e % 2 ? 0.02 : 0.03, 8500, { q: 1.2 });
  kick(t(0), 0.22); kick(t(1.5), 0.14); kick(t(2), 0.2);
  snare(t(1), 0.07); snare(t(3), 0.07);
  if (pos === SURF.length - 1) [3, 3.25, 3.5, 3.75].forEach(b => snare(t(b), 0.06));
}

// Hold'em: cool spy jazz. A prowling bass-and-guitar riff, brass stabs and a straight-eighth groove.
const SPY = [53, 53, 53, 53, 58, 58, 53, 53, 60, 58, 53, 60];
const SPY_RIFF = [0, 0, 2, 0, 3, 0, 5, 3];
function pokerBar(at, index) {
  const pos = index % SPY.length, lap = Math.floor(index / SPY.length);
  const root = SPY[pos];
  const t = straight(at);
  const r = near(root, 36);
  SPY_RIFF.forEach((s, e) => { bass(hz(r + s), t(e / 2), BEAT * 0.45); twang(r + 12 + s, t(e / 2), BEAT * 0.45, 0.03); });
  // Brass: a long stab every other bar, and a muted-trumpet line on the second lap.
  if (pos % 2 === 1) section(near(root, 65) + 10, [root, [0, 4, 7, 10]], t(3.5), BEAT * 1.2, 0.05, { bright: 3800 });
  if (lap % 2) play(pos % 2 ? [[0, 15, 1.5], [2, 12, .5], [2.5, 10, 1]] : [[.5, 7, .5], [1, 10, .5], [1.5, 12, 1.5]], near(root, 65) - 7, (m, s, l) => horn(m, s, l * BEAT - 0.03, 0.06, { bright: 2200 }), t);
  for (let e = 0; e < 8; e++) hiss(t(e / 2), BEAT * 0.3, e % 2 ? 0.022 : 0.032, 8500, { q: 1.2 });
  kick(t(0), 0.2); kick(t(2), 0.18); kick(t(2.5), 0.1);
  snare(t(1), 0.06); snare(t(3), 0.06);
  if (pos === SPY.length - 1) [2.5, 3, 3.5].forEach((b, k) => snare(t(b), 0.05 + k * 0.01));
}

// The hwatu tables get Korean folk bands. One dotted beat holds three pulses (12/8), the janggu
// plays 덩·쿵·덕, a kkwaenggwari rings over the top, gayageum and piri carry a pentatonic tune.
function janggu(at, kind, gain) {
  if (kind !== '덕') tom(at, gain, kind === '쿵' ? 95 : 120);
  if (kind !== '쿵') hiss(at, 0.07, gain * 0.5, 2600, { q: 1.6 });
}
function kkwaeng(at, gain) {
  [1820, 2650, 3480].forEach((f, k) => ping(at, f, gain / (k + 1), 0.16, 'square'));
}
// Three bands for three tables: 맞고 a fast 자진모리, 고스톱 a 휘모리 that races, 섯다 a swaggering 굿거리.
const HWATU = {
  // Notes are steps of the mode, written per bar as [pulse, step, pulses].
  matgo: {
    mode: [0, 2, 5, 7, 9], tonic: 67,
    tune: [
      [[0, 4, 2], [2, 3, 1], [3, 2, 3], [6, 3, 2], [8, 4, 1], [9, 5, 3]],
      [[0, 4, 3], [3, 3, 2], [5, 2, 1], [6, 1, 3], [9, 2, 3]],
      [[0, 2, 2], [2, 3, 1], [3, 4, 3], [6, 5, 2], [8, 4, 1], [9, 3, 3]],
      [[0, 2, 3], [3, 1, 2], [5, 0, 1], [6, 0, 6]]
    ],
    beats: [['덩', 0], ['덕', 2], ['쿵', 3], ['덕', 5], ['덩', 6], ['덕', 8], ['쿵', 9], ['덕', 11]]
  },
  gostop: {
    mode: [0, 2, 5, 7, 9], tonic: 62,
    tune: [
      [[0, 5, 2], [2, 4, 1], [3, 5, 2], [5, 6, 1], [6, 7, 3], [9, 6, 1], [10, 5, 2]],
      [[0, 4, 2], [2, 3, 1], [3, 4, 3], [6, 2, 3], [9, 3, 3]],
      [[0, 5, 1], [1, 6, 1], [2, 7, 1], [3, 6, 3], [6, 5, 2], [8, 4, 1], [9, 5, 3]],
      [[0, 4, 3], [3, 2, 3], [6, 0, 6]]
    ],
    beats: [['덩', 0], ['덕', 1], ['덕', 2], ['쿵', 3], ['덕', 5], ['덩', 6], ['덕', 7], ['쿵', 9], ['덕', 10], ['덕', 11]]
  },
  seotda: {
    mode: [0, 3, 5, 7, 10], tonic: 64,
    tune: [
      [[0, 4, 3], [3, 3, 2], [5, 4, 1], [6, 5, 4], [10, 4, 2]],
      [[0, 3, 3], [3, 2, 3], [6, 1, 2], [8, 2, 1], [9, 0, 3]],
      [[0, 2, 2], [2, 3, 1], [3, 4, 3], [6, 6, 3], [9, 5, 3]],
      [[0, 4, 2], [2, 3, 1], [3, 2, 3], [6, 0, 6]]
    ],
    beats: [['덩', 0], ['덕', 2], ['쿵', 3], ['덩', 6], ['쿵', 8], ['덕', 9], ['덕', 11]]
  }
};
const scaleNote = (mode, tonic, step) => tonic + 12 * Math.floor(step / mode.length) + mode[((step % mode.length) + mode.length) % mode.length];
function hwatuBar(at, index, band) {
  const cfg = HWATU[band];
  const pos = index % cfg.tune.length, lap = Math.floor(index / cfg.tune.length);
  const pulse = p => at + p * BEAT / 3;
  for (const [p, step, len] of cfg.tune[pos]) {
    const m = scaleNote(cfg.mode, cfg.tonic, step);
    const length = len * BEAT / 3;
    // Gayageum leads on the first lap with its pressed-string bends; the piri takes the second.
    if (lap % 2 === 0) pluck(m, pulse(p), Math.max(length, BEAT * 0.6), 0.14, { bright: 2600, bend: len >= 3 ? (step % 2 ? 1 : -1) : 0 });
    else wind(m, pulse(p), length - 0.02, 0.1, { reed: true });
    if (lap % 2 && len >= 3) pluck(m - 12, pulse(p), length, 0.08, { bright: 1800 });
  }
  // A geomungo drone thumps the tonic and fifth on the big beats.
  const low = cfg.tonic - 24;
  [0, 6].forEach((p, k) => pluck(k ? low + 7 : low, pulse(p), BEAT * 1.6, 0.16, { bright: 700, type: 'triangle' }));
  [3, 9].forEach(p => pluck(low, pulse(p), BEAT * 0.9, 0.1, { bright: 600, type: 'triangle' }));
  cfg.beats.forEach(([kind, p]) => janggu(pulse(p), kind, kind === '덩' ? 0.32 : 0.24));
  // The buk on the downbeats, the kkwaenggwari on every pulse with accents on the beats.
  tom(pulse(0), 0.34, 70);
  tom(pulse(6), 0.26, 70);
  for (let p = 0; p < 12; p++) if (p % 3 !== 1 || band === 'gostop') kkwaeng(pulse(p), p % 3 === 0 ? 0.045 : 0.02);
  // Every fourth bar the gong of the band leader calls the next round.
  if (pos === cfg.tune.length - 1) kkwaeng(pulse(9), 0.05);
}

const THEMES = {
  lounge: { tempo: 144, bar: (at, i) => scheduleBar(at, i) },
  noir: { tempo: 96, bar: (at, i) => scheduleNoirBar(at, i) },
  blackjack: { tempo: 176, bar: blackjackBar },
  roulette: { tempo: 116, bar: rouletteBar },
  baccarat: { tempo: 132, bar: baccaratBar },
  dice: { tempo: 120, bar: diceBar },
  slots: { tempo: 158, bar: slotsBar },
  // 경마 borrows the surf band at a gallop.
  horses: { tempo: 172, bar: slotsBar },
  poker: { tempo: 126, bar: pokerBar },
  // 7포커 borrows the Hold'em band, a touch slower.
  sevenpoker: { tempo: 118, bar: pokerBar },
  matgo: { tempo: 96, bar: (at, i) => hwatuBar(at, i, 'matgo') },
  gostop: { tempo: 112, bar: (at, i) => hwatuBar(at, i, 'gostop') },
  seotda: { tempo: 84, bar: (at, i) => hwatuBar(at, i, 'seotda') }
};

function tick() {
  while (nextBar < ac.currentTime + 1.2) {
    THEMES[theme].bar(nextBar, bar++);
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
    BEAT = 60 / THEMES[theme].tempo;
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
  // 'lounge' for the casino floor, 'noir' for the event tables, and each game's own band at its
  // table (see THEMES); a change crossfades. An unknown name falls back to the lounge.
  theme(name) {
    if (!THEMES[name]) name = 'lounge';
    if (name === theme) return;
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
