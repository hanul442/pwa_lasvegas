// Playing cards: real pip layouts, 3D flip, and dealing from the shoe.
import { animate, flyFrom, sound, el, ms, wait } from './fx.js';
import { buzz } from './haptics.js';

const RED_SUITS = new Set(['♥', '♦']);
const PIPS = {
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[0, 0], [100, 0], [0, 100], [100, 100]],
  5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
  6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
  7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
  8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
  9: [[0, 0], [100, 0], [0, 33], [100, 33], [50, 50], [0, 67], [100, 67], [0, 100], [100, 100]],
  10: [[0, 0], [100, 0], [50, 17], [0, 33], [100, 33], [0, 67], [100, 67], [50, 83], [0, 100], [100, 100]]
};

// Suits are drawn, not typed: a ♠ from the font looks different on every phone (and can turn into
// an emoji on Android). Shapes follow casino poker decks (Copag/KEM): full spade, round-lobed club.
const SUIT_KEY = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const SUIT_PATH = {
  s: '<path d="M50 3C58 18 93 37 93 60C93 74 83 82 71.5 82C63.5 82 57.5 78 53.8 72.5C54.6 82.5 58.6 90.5 67 97H33C41.4 90.5 45.4 82.5 46.2 72.5C42.5 78 36.5 82 28.5 82C17 82 7 74 7 60C7 37 42 18 50 3Z"/>',
  h: '<path d="M50 94C45 86 5 63.5 5 34C5 16 18 5 31.5 5C41 5 47 11 50 18.5C53 11 59 5 68.5 5C82 5 95 16 95 34C95 63.5 55 86 50 94Z"/>',
  d: '<path d="M50 2C59 19 72 35 88 50C72 65 59 81 50 98C41 81 28 65 12 50C28 35 41 19 50 2Z"/>',
  c: '<circle cx="50" cy="26.5" r="19.5"/><circle cx="26.5" cy="58" r="19.5"/><circle cx="73.5" cy="58" r="19.5"/><path d="M50 38L38 60H62ZM46.5 58C46 77 42 89 33 97H67C58 89 54 77 53.5 58Z"/>'
};
const suitPath = suit => SUIT_PATH[SUIT_KEY[suit]] || SUIT_PATH.s;
export const suitSvg = (suit, cls = 'suit') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${suitPath(suit)}</svg>`;

// Court cards (J·Q·K): a double-ended portrait filling a framed panel, as on a real casino deck,
// drawn in flat fields of the deck's four inks: line black, red, slate and cream skin. The robe
// takes the suit's colour (red suits red, black suits slate) and the trim the other one.
// Each half is drawn in a 60×51 box; the second half is the first turned 180°.
const COAT = 'M0 51V39C3 34.5 11 32 19 31.4H41C49 32 57 34.5 60 39V51Z';
const COURT_HALF = {
  K: `<path class="pa ln" d="M44.8 1.4H47.2V40H44.8Z"/><path class="hl" d="M46 3.6V38"/>
    <path class="robe ln" d="${COAT}"/>
    <path class="trim ln" d="M0 39C3 34.5 11 32 19 31.4L23.6 34.2L14.6 51H0Z"/>
    <path class="hl" d="M2.4 42.4L9 37.2M3 47.2L12.6 39.6M7.6 49.6L15.8 43"/>
    <path class="pa ln" d="M19 31.4L23.6 34.2L14.6 51H11.4L20.8 33.4Z"/>
    <path class="k" d="M19.6 35.6l1 .9-1.1.6zM17.4 40l1 .9-1.1.6zM15.2 44.4l1 .9-1.1.6zM13.2 48.6l1 .9-1.1.6z"/>
    <path class="trim ln" d="M27 36H33V51H27Z"/><circle class="pa" cx="30" cy="40" r="1"/><circle class="pa" cx="30" cy="44.2" r="1"/><circle class="pa" cx="30" cy="48.4" r="1"/>
    <path class="pa ln" d="M18.4 31.6C22.4 35.2 26.2 36.8 30 36.8C33.8 36.8 37.6 35.2 41.6 31.6L38.6 30H21.4Z"/>
    <path class="k" d="M22.6 33l.9 1.3-1 .4zM26.4 34.8l.9 1.2-1 .4zM33.6 34.8l.1 1.6-1-.4zM37.4 33l.1 1.7-1-.4z"/>
    <path class="sk ln" d="M41.2 41.6C41.8 39.4 45 38.8 47.8 39.8C49.8 40.8 49.4 44 47.2 45C44.8 45.6 41.8 44.6 41.2 41.6Z"/><path class="pa ln" d="M38.8 41.6L41.6 39.6L42.4 44.6L39.4 45.2Z"/>
    <path class="k" d="M22.4 13C20.2 16 19.8 21.5 21 27L22.6 24ZM37.6 13C39.8 16 40.2 21.5 39 27L37.4 24Z"/>
    <path class="sk ln" d="M22.5 12.5H37.5V22.5C37.5 27.5 34.2 30.5 30 30.5C25.8 30.5 22.5 27.5 22.5 22.5Z"/>
    <path class="pa ln" d="M22.2 22C22.2 29.5 25 34 30 35.2C35 34 37.8 29.5 37.8 22C35.6 25 33 26.2 30 26.2C27 26.2 24.4 25 22.2 22Z"/>
    <path class="hl" d="M25 27L26.4 32M28.4 28L28.8 34M31.6 28L31.2 34M35 27L33.6 32"/>
    <path class="k" d="M25.8 25.2C27.6 24 29 24.2 30 25.1C31 24.2 32.4 24 34.2 25.2C32.4 26.4 31 26.2 30 25.7C29 26.2 27.6 26.4 25.8 25.2Z"/>
    <path class="ln nf" d="M24.8 15.6L28.2 15.1M31.8 15.1L35.2 15.6M30.4 18Q29.4 21.2 30.2 21.8H31.2"/><circle class="k" cx="26.6" cy="18" r=".75"/><circle class="k" cx="33.4" cy="18" r=".75"/>
    <path class="trim ln" d="M22 13L20.6 3.4L25.6 7.6L30 1.6L34.4 7.6L39.4 3.4L38 13Z"/><path class="pa ln" d="M22 10.4H38V13.4H22Z"/>
    <circle class="robe" cx="25.4" cy="11.9" r=".85"/><circle class="robe" cx="30" cy="11.9" r=".85"/><circle class="robe" cx="34.6" cy="11.9" r=".85"/><circle class="pa ln" cx="30" cy="1.4" r="1.1"/>`,
  Q: `<path class="robe ln" d="${COAT}"/>
    <path class="trim ln" d="M60 39C57 34.5 49 32 41 31.4L36.4 34.2L45.4 51H60Z"/>
    <path class="hl" d="M57.6 42.4L51 37.2M57 47.2L47.4 39.6M52.4 49.6L44.2 43"/>
    <path class="pa ln" d="M41 31.4L36.4 34.2L45.4 51H48.6L39.2 33.4Z"/>
    <path class="k" d="M21.8 11C18.6 17 18.6 26 20.4 33.4H24.6L24 14ZM38.2 11C41.4 17 41.4 26 39.6 33.4H35.4L36 14Z"/>
    <path class="sk ln" d="M20.4 31.4L24.6 38.6H35.4L39.6 31.4Z"/><path class="sk ln" d="M27.6 28.6H32.4V33H27.6Z"/>
    <path class="trim ln" d="M24.6 38.6H35.4L30 51Z"/><circle class="pa" cx="30" cy="41.8" r=".9"/><circle class="pa" cx="30" cy="45.4" r=".9"/>
    <path class="pe" d="M23 32.4h.01M24.6 34.4h.01M26.6 35.7h.01M28.8 36.3h.01M31.2 36.3h.01M33.4 35.7h.01M35.4 34.4h.01M37 32.4h.01"/>
    <path class="ln nf" d="M15 40C14.6 32 15 23 16.4 16"/><path class="trim ln" d="M15.2 29C12 27.8 10.4 25.2 10.4 22.6C13.4 23 15 25.2 15.4 27.6ZM15.8 25.4C18.6 23.2 21 23 22.4 23.6C21.4 26 18.8 27.2 16 27Z"/>
    <path class="robe ln" d="M12.8 16.2C12.2 11.8 14 9 16.4 7.8C18.8 9 20.6 11.8 20 16.2C18.6 18 14.2 18 12.8 16.2Z"/><path class="hl" d="M16.4 8.8V16.8M14.4 10.6C14.8 13.2 15 14.8 15.2 17M18.4 10.6C18 13.2 17.8 14.8 17.6 17"/>
    <path class="sk ln" d="M12 40.4C12.6 38.4 15.6 38 17.8 39C19.4 40 19 42.6 17.2 43.4C15 44 12.4 43 12 40.4Z"/>
    <path class="sk ln" d="M23 12.6H37V22.5C37 27.6 34 30.6 30 30.6C26 30.6 23 27.6 23 22.5Z"/>
    <path class="k" d="M22.8 15C24 10.4 27.4 9.2 30 10.8C32.6 9.2 36 10.4 37.2 15C34 13.4 32 13.4 30 14.6C28 13.4 26 13.4 22.8 15Z"/>
    <path class="ln nf" d="M25.2 18.8Q26.8 17.5 28.4 18.8M31.6 18.8Q33.2 17.5 34.8 18.8M30.3 20.6Q29.5 22.8 30 23.3H30.8"/><circle class="k" cx="26.8" cy="19.4" r=".6"/><circle class="k" cx="33.2" cy="19.4" r=".6"/>
    <path class="red" d="M28.2 26.2Q30 27.6 31.8 26.2Q30 25.4 28.2 26.2Z"/>
    <path class="trim ln" d="M24 10.4L24.8 3.6L27.8 6.4L30 1.8L32.2 6.4L35.2 3.6L36 10.4Z"/><circle class="pa ln" cx="30" cy="1.6" r=".95"/><circle class="pa" cx="27.2" cy="8.8" r=".6"/><circle class="pa" cx="32.8" cy="8.8" r=".6"/>`,
  J: `<path class="ln nf" d="M11.2 2.4V44"/><path class="trim ln" d="M11.2 5.2C6.8 6 5 9.4 5.4 13.4C7.4 11.8 9.4 11.2 11.2 11.5Z"/><path class="k" d="M11.2 0L12.6 3.8H9.8Z"/>
    <path class="robe ln" d="${COAT}"/>
    <path class="trim ln" d="M3.6 37.2L11.6 33.2L13 36L5.4 40.2ZM56.4 37.2L48.4 33.2L47 36L54.6 40.2ZM6.6 43.4L15 39L16.4 41.8L8.4 46.4ZM53.4 43.4L45 39L43.6 41.8L51.6 46.4ZM9.6 49.6L18.4 45L19.6 47.8L12.4 51ZM50.4 49.6L41.6 45L40.4 47.8L47.6 51Z"/>
    <path class="trim ln" d="M27 33H33V51H27Z"/><circle class="pa" cx="30" cy="36.8" r=".95"/><circle class="pa" cx="30" cy="40.8" r=".95"/><circle class="pa" cx="30" cy="44.8" r=".95"/><circle class="pa" cx="30" cy="48.8" r=".95"/>
    <path class="pa ln" d="M19 30.2Q21.8 34.4 24.6 30.8Q27.3 34.8 30 31Q32.7 34.8 35.4 30.8Q38.2 34.4 41 30.2L39.2 28.4H20.8Z"/>
    <path class="sk ln" d="M8.8 42C9.4 39.8 12.6 39.4 14.8 40.4C16.4 41.4 16 44 14.2 44.8C12 45.4 9.2 44.4 8.8 42Z"/>
    <path class="k" d="M22.2 14C20.4 17.4 20.4 22.4 22.2 26L24.2 22.2V14ZM37.8 14C39.6 17.4 39.6 22.4 37.8 26L35.8 22.2V14Z"/>
    <path class="sk ln" d="M23 12.8H37V22.5C37 27.6 34 30.4 30 30.4C26 30.4 23 27.6 23 22.5Z"/>
    <path class="ln nf" d="M24.8 16.6L28.2 16.2M31.8 16.2L35.2 16.6M30.4 19Q29.4 22 30.2 22.6H31.2M27.8 26.8Q30 27.8 32.2 26.8"/><circle class="k" cx="26.6" cy="18.8" r=".72"/><circle class="k" cx="33.4" cy="18.8" r=".72"/>
    <path class="k" d="M27 24.8C28.4 24 29.3 24.1 30 24.7C30.7 24.1 31.6 24 33 24.8C31.8 25.3 30.7 25.3 30 25.1C29.3 25.3 28.2 25.3 27 24.8Z"/>
    <path class="robe ln" d="M37.4 7.8C40.4 5.2 43 3.6 46 2.6C44.2 5.4 41.6 7.4 38.6 9Z"/><path class="hl" d="M38.2 8.4C40.8 6.4 43 4.8 45.4 3.2"/>
    <path class="trim ln" d="M21 13C20 6.6 24.6 3.4 30.4 3.4C36.6 3.4 40.8 6 40.3 11.2L38.6 13Z"/><path class="pa ln" d="M21.8 11H39.2V13.6H21.8Z"/>`
};
const PIP_SIDE = { K: 0, Q: 1, J: 1 };
const courtCache = {};
function courtArt(rank, suit) {
  const key = rank + suit;
  if (!courtCache[key]) {
    const half = COURT_HALF[rank] || COURT_HALF.K;
    const pip = `<g transform="translate(${PIP_SIDE[rank] ? 49.4 : 2.6} 2.6) scale(.08)" class="ink">${suitPath(suit)}</g>`;
    courtCache[key] = `<svg class="court-art" viewBox="0 0 60 102" preserveAspectRatio="none" aria-hidden="true"><g>${half}${pip}</g><g transform="rotate(180 30 51)">${half}${pip}</g><path class="ln nf mid" d="M0 52.4L60 49.6"/><rect class="frame" x=".5" y=".5" width="59" height="101" rx="1.6"/></svg>`;
  }
  return courtCache[key];
}

export function parseCard(text) {
  if (!text || text === 'HIDDEN') return null;
  return { rank: text.slice(0, -1), suit: text.slice(-1) };
}

function faceMarkup(card) {
  const { rank, suit } = card;
  const corner = `<span class="card-corner"><b${rank === '10' ? ' class="is-ten"' : ''}>${rank}</b><i>${suitSvg(suit)}</i></span>`;
  let center;
  if (PIPS[rank]) {
    center = `<span class="card-pips">${PIPS[rank].map(([x, y]) => `<i style="--x:${x};--y:${y}"${y > 50 ? ' class="flip"' : ''}>${suitSvg(suit)}</i>`).join('')}</span>`;
  } else if (rank === 'A') {
    // The ace of spades carries the house mark, as on a casino's own deck.
    center = `<span class="card-ace${suit === '♠' ? ' is-house' : ''}">${suitSvg(suit)}${suit === '♠' ? '<i class="ace-star" aria-hidden="true"></i>' : ''}</span>`;
  } else {
    center = `<span class="card-court" data-rank="${rank}">${courtArt(rank, suit)}</span>`;
  }
  // card-mark: the big suit that the large-index faces (Hold'em) show in place of the pips.
  return `${corner}${center}${corner.replace('card-corner', 'card-corner card-corner--end')}<span class="card-mark" aria-hidden="true">${suitSvg(suit)}</span>`;
}

// 꾸미기 (lib/shop.mjs): the card back this player wears, applied to every card dealt from now on.
// null keeps the house's black lacquer back.
let backSkin = null;
export function setCardBack(skin) {
  backSkin = skin || null;
  document.querySelectorAll('.card-back').forEach(node => {
    node.classList.forEach(c => { if (c.startsWith('back--')) node.classList.remove(c); });
    if (backSkin && !node.closest('.skin-preview')) node.classList.add(`back--${backSkin}`);
  });
}
export const cardBackClass = () => (backSkin ? `card-back back--${backSkin}` : 'card-back');

export function createCard(text, { faceUp = true } = {}) {
  const card = parseCard(text);
  const node = el('div', 'card');
  node.dataset.card = text || 'HIDDEN';
  // A touch of hand-placed imperfection so stacks never look machine-aligned.
  node.style.setProperty('--tilt', `${(Math.random() * 4 - 2).toFixed(2)}deg`);
  node.innerHTML = `<div class="card-inner"><div class="card-face${card && RED_SUITS.has(card.suit) ? ' is-red' : ''}">${card ? faceMarkup(card) : ''}</div><div class="${cardBackClass()}"><i class="card-glint" aria-hidden="true"></i></div></div>`;
  if (faceUp && card) node.classList.add('is-faceup');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', card ? `${card.rank}${card.suit}` : '뒷면 카드');
  return node;
}

export function setCardFace(node, text) {
  const card = parseCard(text);
  if (!card) return;
  node.dataset.card = text;
  const face = node.querySelector('.card-face');
  face.className = `card-face${RED_SUITS.has(card.suit) ? ' is-red' : ''}`;
  face.innerHTML = faceMarkup(card);
  node.setAttribute('aria-label', `${card.rank}${card.suit}`);
}

export async function flipCard(node, text, { duration = 360, squeeze = false } = {}) {
  if (text) setCardFace(node, text);
  if (node.classList.contains('is-faceup')) return;
  const inner = node.querySelector('.card-inner');
  sound.flip();
  const frames = squeeze
    ? [
        { transform: 'rotateY(180deg)' },
        { transform: 'rotateY(160deg) rotateX(14deg) scale(1.04)', offset: 0.45 },
        { transform: 'rotateY(90deg) scale(1.1)', offset: 0.7 },
        { transform: 'rotateY(0deg) scale(1)' }
      ]
    : [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(90deg) scale(1.08)', offset: 0.5 }, { transform: 'rotateY(0deg)' }];
  node.classList.add('is-turning');
  await animate(inner, frames, { duration: squeeze ? duration * 2.4 : duration, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'none' });
  node.classList.add('is-faceup');
  node.classList.remove('is-turning');
}

// Deal a run of cards the way a dealer does: the next card leaves the shoe while the last one is
// still in the air, instead of each card waiting for the one before it to land and turn over.
// `steps` are { hand, text, faceUp, after } in dealing order; `after(node)` runs once that card is
// face up (for totals). A card never goes into a hand whose previous card is still flying, so a
// hand never re-lays out under a card in flight.
export async function dealRun(steps, shoe, { gap = 230 } = {}) {
  const flying = new Map();
  const done = [];
  for (const [i, s] of steps.entries()) {
    await flying.get(s.hand);
    // Drawn blank until it turns over, so a hand's total never counts a card still in the air.
    const node = createCard(s.faceUp === false ? s.text : 'HIDDEN', { faceUp: false });
    s.hand.append(node);
    const from = (shoe || s.hand).getBoundingClientRect();
    sound.card();
    buzz('card');
    const flight = flyFrom(node, from, { duration: 500, spin: -24, scale: 0.72, lift: 30, settle: true });
    flying.set(s.hand, flight);
    done.push(flight.then(async () => {
      if (s.faceUp !== false && parseCard(s.text)) await flipCard(node, s.text);
      s.after?.(node);
    }));
    if (i < steps.length - 1) await wait(gap);
  }
  await Promise.all(done);
}

// Deal one card from the shoe into `hand`. Face-down cards stay hidden until flipped.
export async function dealCard(hand, text, shoe, { faceUp = true, delay = 0, rotate = false } = {}) {
  const node = createCard(text, { faceUp: false });
  if (rotate) node.classList.add('is-sideways');
  hand.append(node);
  const from = (shoe || hand).getBoundingClientRect();
  if (delay) await new Promise(r => setTimeout(r, ms(delay)));
  sound.card();
  buzz('card');
  await flyFrom(node, from, { duration: 500, spin: -24, scale: 0.72, lift: 30, settle: true });
  if (faceUp && parseCard(text)) await flipCard(node, text);
  return node;
}

// Instantly lay out cards (used when resuming a round).
export function placeCards(hand, texts) {
  hand.replaceChildren(...texts.map(t => createCard(t, { faceUp: t !== 'HIDDEN' })));
}

export async function sweepCards(containers, target) {
  const rect = target.getBoundingClientRect();
  const cards = containers.flatMap(c => [...c.querySelectorAll('.card')]);
  await Promise.all(cards.map((card, i) => {
    const from = card.getBoundingClientRect();
    const dx = rect.left - from.left, dy = rect.top - from.top;
    return animate(card, [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) rotate(18deg) scale(.6)`, opacity: 0 }], { duration: 380, delay: i * 30, easing: 'cubic-bezier(.5,0,.75,0)' });
  }));
  containers.forEach(c => c.replaceChildren());
}
