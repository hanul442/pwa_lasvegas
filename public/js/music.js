// Background music: a slow lounge-jazz trio (electric piano, upright bass, brushes) synthesized
// live with WebAudio, so there are no audio files to load or license. It loops a 16-bar form
// in D♭ and voices each chord a little differently every time around.
import { audioContext } from './fx.js';
import { settings, onSettings } from './settings.js';

const BPM = 76;
const BEAT = 60 / BPM;
const SWING = 0.62; // the off-beat eighth lands at 62% of the beat
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

let ac = null, bus = null, timer = null, nextBar = 0, bar = 0, playing = false;

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
  tone.frequency.value = 3200;
  const verb = ac.createConvolver();
  verb.buffer = impulse();
  const wet = ac.createGain();
  wet.gain.value = 0.32;
  bus.connect(tone);
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
function brush(at, length, gain, freq) {
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
  g.gain.linearRampToValueAtTime(gain, at + length * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(f).connect(g).connect(bus);
  src.start(at, Math.random() * 0.5);
  src.stop(at + length + 0.05);
}

function scheduleBar(at, index) {
  const [root, voicing] = FORM[index % FORM.length];
  const [nextRoot] = FORM[(index + 1) % FORM.length];
  const lap = Math.floor(index / FORM.length);
  const off = beat => at + beat * BEAT + SWING * BEAT;

  // Piano comps: a long chord on 1, sometimes a short push on the and-of-2 or a fill on 4.
  const lift = lap % 2 && root < 52 ? 12 : 0;
  const notes = voicing.map(i => hz(root + i + lift));
  notes.forEach((f, i) => piano(f, at + i * 0.018, BEAT * 3.2, 0.055));
  if ((index + lap) % 3 !== 1) notes.slice(1).forEach((f, i) => piano(f, off(1) + i * 0.012, BEAT * 1.1, 0.04));
  if (index % 4 === 3) piano(hz(root + voicing[3] + 12), off(2), BEAT * 1.4, 0.035);

  // Walking bass: root, chord tone, passing tone, then a half step into the next root.
  const low = m => m - (m > 52 ? 24 : 12);
  const r = low(root);
  const walk = [r, r + (voicing[0] === 3 ? 3 : 4), r + 7, low(nextRoot) + (index % 2 ? 1 : -1)];
  walk.forEach((m, b) => bass(hz(m), at + b * BEAT, BEAT * 0.95));

  // Brushes: a swish on 2 and 4, a light tap on each swung off-beat.
  for (let b = 0; b < 4; b++) {
    if (b % 2) brush(at + b * BEAT, BEAT * 0.9, 0.05, 2400);
    brush(off(b), BEAT * 0.25, 0.022, 6500);
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
