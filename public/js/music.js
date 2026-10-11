// Background music: an uptempo casino-lounge jazz trio (electric piano, walking bass, ride cymbal
// and a light kick) synthesized live with WebAudio, so there are no audio files to load or license.
// It loops a 16-bar form in D♭ and voices each chord a little differently every time around.
import { audioContext } from './fx.js';
import { settings, onSettings } from './settings.js';

const BPM = 118;
const BEAT = 60 / BPM;
const SWING = 0.64; // the off-beat eighth lands at 64% of the beat
const FULL = 0.32;
// The settings slider scales the trio; 60 (the default) sits a little under the old fixed level.
const volume = () => FULL * Math.min(1, (settings.get('music') ?? 60) / 75);

// Chords as [root MIDI note, intervals for the piano voicing above the root].
const MAJ9 = [4, 7, 11, 14], MIN9 = [3, 7, 10, 14], DOM13 = [4, 10, 14, 21], DOM7B9 = [4, 10, 13, 16], MIN11 = [3, 10, 14, 17];
const FORM = [
  [51, MIN9], [56, DOM13], [49, MAJ9], [58, MIN9],
  [51, MIN11], [56, DOM7B9], [49, MAJ9], [54, MAJ9],
  [53, MIN9], [58, DOM7B9], [51, MIN9], [56, DOM13],
  [49, MAJ9], [46, DOM7B9], [51, MIN9], [56, DOM13]
];

const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

let ac = null, bus = null, duckGain = null, timer = null, nextBar = 0, bar = 0, playing = false;

function impulse(seconds = 2.8) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

function build() {
  ac = audioContext();
  if (!ac) return false;
  bus = ac.createGain();
  bus.gain.value = 0.0001;
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5200;
  const verb = ac.createConvolver();
  verb.buffer = impulse();
  const wet = ac.createGain();
  wet.gain.value = 0.2;
  // The dealer's voice dips the band through its own stage so it never fights the fade in or out.
  duckGain = ac.createGain();
  bus.connect(duckGain).connect(tone);
  tone.connect(ac.destination);
  tone.connect(verb).connect(wet).connect(ac.destination);
  return true;
}

// Electric piano: a sine with a quiet octave partial, a soft bell attack and a slow tremolo.
function piano(freq, at, length, gain) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(gain * 0.45, at + 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  const trem = ac.createGain();
  trem.gain.value = 1;
  const lfo = ac.createOscillator();
  const depth = ac.createGain();
  lfo.frequency.value = 4.6;
  depth.gain.value = 0.12;
  lfo.connect(depth).connect(trem.gain);
  for (const [mult, level, type] of [[1, 1, 'sine'], [2, 0.18, 'sine'], [1, 0.06, 'triangle']]) {
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    og.gain.value = level;
    o.connect(og).connect(g);
    o.start(at);
    o.stop(at + length + 0.05);
  }
  g.connect(trem).connect(bus);
  lfo.start(at);
  lfo.stop(at + length + 0.05);
}

// Upright bass: a plucked low triangle that thumps and dies away.
function bass(freq, at, length) {
  const o = ac.createOscillator();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(900, at);
  f.frequency.exponentialRampToValueAtTime(260, at + 0.25);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.5, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(f).connect(g).connect(bus);
  o.start(at);
  o.stop(at + length + 0.05);
}

let noise = null;
function brush(at, length, gain, freq, attack = length * 0.3) {
  if (!noise) {
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noise;
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.7;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(f).connect(g).connect(bus);
  src.start(at, Math.random() * 0.5);
  src.stop(at + length + 0.05);
}

// Kick: a soft felt thump that keeps the floor moving without getting in the way.
function kick(at, gain) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.setValueAtTime(110, at);
  o.frequency.exponentialRampToValueAtTime(48, at + 0.12);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + 0.25);
}

function scheduleBar(at, index) {
  const [root, voicing] = FORM[index % FORM.length];
  const [nextRoot] = FORM[(index + 1) % FORM.length];
  const lap = Math.floor(index / FORM.length);
  const off = beat => at + beat * BEAT + SWING * BEAT;

  // Piano comps in a Charleston: a short stab on 1 and a push on the and-of-2, with a little
  // right-hand lick climbing the chord at the end of every other bar.
  const lift = lap % 2 && root < 52 ? 12 : 0;
  const notes = voicing.map(i => hz(root + i + lift));
  notes.forEach((f, i) => piano(f, at + i * 0.012, BEAT * 1.2, 0.05));
  notes.slice(1).forEach((f, i) => piano(f, off(1) + i * 0.01, (index + lap) % 3 === 1 ? BEAT * 2 : BEAT * 0.8, 0.042));
  if (index % 2 === 1) {
    const top = root + voicing[3] + 12 + lift;
    [top - voicing[3] + voicing[1], top - voicing[3] + voicing[2], top].forEach((m, i) => piano(hz(m), at + (2 + i * 0.5) * BEAT + (i % 2 ? (SWING - 0.5) * BEAT : 0), BEAT * 0.7, 0.03));
  }

  // Walking bass: root, chord tone, passing tone, then a half step into the next root.
  const low = m => m - (m > 52 ? 24 : 12);
  const r = low(root);
  const walk = [r, r + (voicing[0] === 3 ? 3 : 4), r + 7, low(nextRoot) + (index % 2 ? 1 : -1)];
  walk.forEach((m, b) => bass(hz(m), at + b * BEAT, BEAT * 0.95));

  // Drums: ride on every beat with the swung skip into 2 and 4, hi-hat chick on 2 and 4,
  // and a feathered kick on 1 and 3.
  for (let b = 0; b < 4; b++) {
    brush(at + b * BEAT, BEAT * 0.7, b % 2 ? 0.045 : 0.035, 8200, 0.004);
    if (b % 2) brush(at + b * BEAT, BEAT * 0.12, 0.04, 5200, 0.003);
    if (!(b % 2)) brush(off(b), BEAT * 0.3, 0.026, 8200, 0.004);
    if (!(b % 2)) kick(at + b * BEAT, b ? 0.16 : 0.2);
  }
}

function tick() {
  while (nextBar < ac.currentTime + 1.2) {
    scheduleBar(nextBar, bar++);
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
    nextBar = ac.currentTime + 0.1;
    bus.gain.cancelScheduledValues(ac.currentTime);
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), ac.currentTime);
    bus.gain.exponentialRampToValueAtTime(volume(), ac.currentTime + 3);
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
