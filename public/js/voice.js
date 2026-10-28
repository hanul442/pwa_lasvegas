// The dealer's voice: short recorded call-outs ("No more bets", "All in", "Straight") rendered
// offline by scripts/voice/generate.py, so every device hears the same deep, unhurried dealer
// with no speech engine or network at play time. They run on the shared WebAudio clock under the
// same ♪ toggle as the effects, can be switched off on its own in settings, and the music dips
// while he speaks.
import { audioContext, isMuted } from './fx.js';
import { music } from './music.js';
import { settings, onSettings } from './settings.js';

const silent = () => isMuted() || !settings.get('voice');
const level = () => Math.min(1, ((settings.get('voiceVolume') ?? 80) / 100) * 1.2); // 80 (default) ≈ 0.96
const STALE_MS = 2500; // a call-out that would land this late is dropped; the table has moved on
const MAX_QUEUE = 2;

const bytes = new Map(); // id -> Promise<ArrayBuffer | null>
const decoded = new Map(); // id -> Promise<AudioBuffer | null>
let queue = [];
let current = []; // the sources of the line or phrase now playing
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

const JOIN = 0.04; // pieces of a phrase overlap this much (s) so the words run together

// Play one line, or the pieces of a phrase back to back on the audio clock.
function play(buffers, ac) {
  return new Promise(resolve => {
    const gain = ac.createGain();
    gain.gain.value = level();
    gain.connect(ac.destination);
    let at = ac.currentTime + 0.02;
    const srcs = buffers.map(buffer => {
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start(at);
      at += buffer.duration - JOIN;
      return src;
    });
    srcs[srcs.length - 1].onended = () => { if (current === srcs) current = []; resolve(); };
    current = srcs;
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const { ids, at } = queue.shift();
      const ac = silent() ? null : audioContext();
      if (!ac) { queue = []; break; }
      const buffers = await Promise.all(ids.map(id => bufferFor(id, ac)));
      if (buffers.some(b => !b) || silent() || performance.now() - at > STALE_MS) continue;
      music.duck(true);
      await play(buffers, ac);
      if (!queue.length) music.duck(false);
    }
  } finally {
    pumping = false;
    music.duck(false);
  }
}

export const voice = {
  // Queue a line id, or an array of piece ids spoken as one phrase. `cut` stops whatever he is
  // saying first, for a call-out that supersedes it; `next` drops what is waiting but lets the
  // current line finish, for the cue that matters most ("Your action").
  // `drop` is for chatter that only matters right now (a bot's call): skipped while he is still
  // talking, so his voice never falls behind the cards.
  say(line, { cut = false, next = false, drop = false } = {}) {
    const ids = [line].flat().filter(Boolean);
    if (!ids.length || silent()) return;
    if (drop && this.busy) return;
    if (cut) this.hush();
    else if (next) queue = [];
    queue.push({ ids, at: performance.now() });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    pump();
  },
  get busy() { return pumping || queue.length > 0; },
  hush() {
    queue = [];
    current.forEach(src => { try { src.stop(); } catch {} });
    current = [];
  },
  // Fetch a table's lines when it opens so the first call-out is not late.
  // Warm a table's lines after it has opened, a few at a time, so dozens of downloads don't
  // compete with the table's own first paint. A muted dealer fetches nothing.
  preload(game) {
    if (silent()) return;
    const ids = [...(TABLE_LINES[game] || [])];
    const next = () => { const id = ids.shift(); if (id) Promise.resolve(fetchLine(id)).finally(next); };
    const start = () => { for (let i = 0; i < 4; i++) next(); };
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 1500 }); else setTimeout(start, 600);
  }
};

// ---------- line ids ----------
// Bet amounts in words, as piece ids: 1,250,000 -> one million two hundred fifty thousand.
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']];
const NUMBER_WORDS = [...ONES.slice(1), ...TENS.slice(2), 'hundred', ...SCALES.map(s => s[1]).filter(Boolean)];
function belowThousand(n) {
  const words = [];
  if (n >= 100) words.push(ONES[Math.floor(n / 100)], 'hundred');
  const r = n % 100;
  if (r >= 20) words.push(TENS[Math.floor(r / 10)], ...(r % 10 ? [ONES[r % 10]] : []));
  else if (r) words.push(ONES[r]);
  return words;
}
export function amountWords(amount) {
  let n = Math.round(Number(amount) || 0);
  if (n <= 0 || n >= 1e15) return [];
  const words = [];
  for (const [size, name] of SCALES) {
    const part = Math.floor(n / size);
    n -= part * size;
    if (part) words.push(...belowThousand(part), ...(name ? [name] : []));
  }
  return words;
}
const LEADS = { CALL: 'lead-call', RAISE: 'lead-raise', BET: 'lead-bet', ALL_IN: 'lead-all-in' };
// "Fifty thousand." The last word is the falling, phrase-final take.
export function betLine(action, amount) {
  const words = amountWords(amount);
  if (!LEADS[action] || !words.length) return null;
  // Only the amount is spoken ("Sixty thousand"); the action is already on the seat's tag.
  return words.map((w, i) => `n-${w}${i === words.length - 1 ? '-end' : ''}`);
}

const range = (from, to, line) => Array.from({ length: to - from + 1 }, (_, i) => line(from + i));
const TABLE_LINES = {
  blackjack: ['place-bets', 'blackjack', 'bust', 'dealer-busts', 'insurance', 'you-win', 'dealer-wins', 'push'],
  baccarat: ['place-bets', 'player-wins', 'banker-wins', 'tie'],
  roulette: ['place-bets', 'no-more-bets', ...range(0, 36, n => `roulette-${n}`)],
  dice: ['place-bets', 'no-more-bets', ...range(4, 17, n => `sicbo-${n}`), ...range(1, 6, n => `triple-${n}`)],
  poker: ['your-action', 'check', 'flop', 'turn', 'river', 'you-win', ...range(0, 8, n => `hand-${n}`), 'royal-flush',
    'lead-call', 'lead-raise', 'lead-bet', 'lead-all-in', ...['', '-end'].flatMap(end => NUMBER_WORDS.map(w => `n-${w}${end}`))],
  matgo: ['your-turn', 'stop', 'you-win', ...range(1, 5, n => `go-${n}`)],
  seotda: ['your-action', 'call', 'check', 'half', 'die', 'you-win']
};
// Card tables open with the dealer inviting bets; the games played against AI seats start on their own cue.
export const OPENS_WITH_BETS = new Set(['blackjack', 'baccarat', 'roulette', 'dice']);

onSettings(key => { if ((key === 'voice' || key === null) && !settings.get('voice')) voice.hush(); });

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
