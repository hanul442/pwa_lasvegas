// The dealer's voice: short recorded call-outs ("No more bets", "All in", "Straight") rendered
// offline by scripts/voice/generate.py, so every device hears the same deep, unhurried dealer
// with no speech engine or network at play time. They run on the shared WebAudio clock under the
// same ♪ toggle as the effects, and the music dips while he speaks.
import { audioContext, isMuted } from './fx.js';
import { music } from './music.js';

const VOLUME = 0.95;
const STALE_MS = 2500; // a call-out that would land this late is dropped; the table has moved on
const MAX_QUEUE = 2;

const bytes = new Map(); // id -> Promise<ArrayBuffer | null>
const decoded = new Map(); // id -> Promise<AudioBuffer | null>
let queue = [];
let current = null;
let pumping = false;

function fetchLine(id) {
  if (!bytes.has(id)) {
    const req = fetch(`voice/${id}.mp3`)
      .then(res => (res.ok ? res.arrayBuffer() : null))
      .catch(() => null)
      .then(buf => { if (!buf) bytes.delete(id); return buf; });
    bytes.set(id, req);
  }
  return bytes.get(id);
}

function bufferFor(id, ac) {
  if (!decoded.has(id)) {
    const job = fetchLine(id)
      // decodeAudioData detaches its input, so decode a copy and keep the bytes for a retry.
      .then(buf => (buf ? ac.decodeAudioData(buf.slice(0)) : null))
      .catch(() => null)
      .then(audio => { if (!audio) decoded.delete(id); return audio; });
    decoded.set(id, job);
  }
  return decoded.get(id);
}

function play(buffer, ac) {
  return new Promise(resolve => {
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = VOLUME;
    src.buffer = buffer;
    src.connect(gain).connect(ac.destination);
    src.onended = () => { if (current === src) current = null; resolve(); };
    current = src;
    src.start();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const { id, at } = queue.shift();
      const ac = isMuted() ? null : audioContext();
      if (!ac) { queue = []; break; }
      const buffer = await bufferFor(id, ac);
      if (!buffer || isMuted() || performance.now() - at > STALE_MS) continue;
      music.duck(true);
      await play(buffer, ac);
      if (!queue.length) music.duck(false);
    }
  } finally {
    pumping = false;
    music.duck(false);
  }
}

export const voice = {
  // Queue a line. `cut` stops whatever he is saying first, for a call-out that supersedes it.
  say(id, { cut = false } = {}) {
    if (!id || isMuted()) return;
    if (cut) this.hush();
    queue.push({ id, at: performance.now() });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    pump();
  },
  hush() {
    queue = [];
    try { current?.stop(); } catch {}
    current = null;
  },
  // Fetch a table's lines when it opens so the first call-out is not late.
  preload(game) { (TABLE_LINES[game] || []).forEach(fetchLine); }
};

const range = (from, to, line) => Array.from({ length: to - from + 1 }, (_, i) => line(from + i));
const TABLE_LINES = {
  blackjack: ['place-bets', 'blackjack', 'bust', 'dealer-busts', 'insurance', 'you-win', 'dealer-wins', 'push'],
  baccarat: ['place-bets', 'player-wins', 'banker-wins', 'tie'],
  roulette: ['place-bets', 'no-more-bets', ...range(0, 36, n => `roulette-${n}`)],
  dice: ['place-bets', 'no-more-bets', ...range(4, 17, n => `sicbo-${n}`), ...range(1, 6, n => `triple-${n}`)],
  poker: ['your-action', 'all-in', 'raise', 'flop', 'turn', 'river', 'you-win', ...range(0, 8, n => `hand-${n}`), 'royal-flush'],
  matgo: ['your-turn', 'stop', 'you-win', ...range(1, 5, n => `go-${n}`)],
  seotda: ['your-action', 'call', 'check', 'half', 'die', 'you-win']
};
// Card tables open with the dealer inviting bets; the games played against AI seats start on their own cue.
export const OPENS_WITH_BETS = new Set(['blackjack', 'baccarat', 'roulette', 'dice']);

// ---------- line ids ----------
const HAND_INDEX = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
export function handLine(name, cards = []) {
  const i = HAND_INDEX.indexOf(name);
  if (i < 0) return null;
  // A straight flush to the ace is the royal flush.
  if (i === 8 && royal(cards)) return 'royal-flush';
  return `hand-${i}`;
}
function royal(cards) {
  const suits = new Map();
  for (const c of cards) {
    const r = c.slice(0, -1), s = c.slice(-1);
    if (['A', 'K', 'Q', 'J', '10'].includes(r)) suits.set(s, (suits.get(s) || new Set()).add(r));
  }
  return [...suits.values()].some(set => set.size === 5);
}
export const rouletteLine = n => `roulette-${n}`;
export const sicboLine = dice => (dice[0] === dice[1] && dice[1] === dice[2] ? `triple-${dice[0]}` : `sicbo-${dice[0] + dice[1] + dice[2]}`);
export const goLine = count => (count >= 1 && count <= 5 ? `go-${count}` : null);
