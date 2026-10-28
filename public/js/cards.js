// Playing cards: real pip layouts, 3D flip, and dealing from the shoe.
import { animate, flyFrom, sound, el, ms } from './fx.js';
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

// Court cards (J·Q·K): a figure drawn in fine line on the card stock, mirrored head to head
// like a real double-ended court card. Ink follows the suit colour (currentColor); `p` areas
// are the paper itself so lines behind a face or collar stay hidden.
const COURT_HALF = {
  K: `<path class="tone" d="M-1 36.2C6 34.6 14 33.8 22 33.5H38C46 33.8 54 34.6 61 36.2V45H-1Z"/><path class="s hatch" d="M5 35.4Q6.4 40.6 5.6 45M11 34.6Q12.8 40 12.2 45M16.6 34.1Q18.2 39.6 17.8 45M43.4 34.1Q41.8 39.6 42.2 45M49 34.6Q47.2 40 47.8 45M55 35.4Q53.6 40.6 54.4 45"/>
    <path class="s" d="M47 14V35.5"/><circle class="f" cx="47" cy="11.4" r="2.4"/><path class="s" d="M47 6.6v2.6M45.7 7.9h2.6"/>
    <path class="s" d="M-1 36.2C6 34.6 14 33.8 22 33.5M61 36.2C54 34.6 46 33.8 38 33.5"/>
    <path class="f" d="M21 33.8C23 35 24.5 36 25.8 37.5L28.2 45H18.5C19.5 40 20 36.5 21 33.8ZM39 33.8C37 35 35.5 36 34.2 37.5L31.8 45H41.5C40.5 40 40 36.5 39 33.8Z"/>
    <path class="pe" d="M21.6 39.2h.01M24 42.8h.01M20.4 43.2h.01M38.4 39.2h.01M36 42.8h.01M39.6 43.2h.01"/>
    <path class="p s" d="M22.5 15.5C22.5 21 23.5 24 23.5 26C23.5 32 27 36.5 30 37.5C33 36.5 36.5 32 36.5 26C36.5 24 37.5 21 37.5 15.5Z"/>
    <path class="s t" d="M26 26.6C28 25.3 29.3 25.7 30 26.5C30.7 25.7 32 25.3 34 26.6M27.2 30.5l.4 3M30 31v3.8M32.8 30.5l-.4 3M25.4 19.4h3M31.6 19.4h3M30 20.3l-.9 3.9h1.5"/>
    <circle class="f" cx="27" cy="21.2" r=".7"/><circle class="f" cx="33" cy="21.2" r=".7"/>
    <path class="f" d="M20.5 15.8L19.4 6.6L24.5 10.6L30 4L35.5 10.6L40.6 6.6L39.5 15.8Z"/><circle class="p" cx="30" cy="11.6" r="1.25"/>`,
  Q: `<path class="tone" d="M-1 36.2C6 34.6 14 33.8 22 33.5H38C46 33.8 54 34.6 61 36.2V45H-1Z"/><path class="s hatch" d="M5 35.4Q6.4 40.6 5.6 45M11 34.6Q12.8 40 12.2 45M16.6 34.1Q18.2 39.6 17.8 45M43.4 34.1Q41.8 39.6 42.2 45M49 34.6Q47.2 40 47.8 45M55 35.4Q53.6 40.6 54.4 45"/>
    <circle class="s" cx="13" cy="26.5" r="2.6"/><circle class="f" cx="13" cy="26.5" r=".95"/><path class="s" d="M13.4 29.2L16.2 41M14.6 34.6c2.4-1.9 3.8-1.2 4.6.2"/>
    <path class="f" d="M21 17C19 24 19.5 31 16.5 37C20 37.5 23 36 24.5 33H35.5C37 36 40 37.5 43.5 37C40.5 31 41 24 39 17C38 11 22 11 21 17Z"/>
    <path class="s" d="M-1 36.4C6 35.2 15 34.7 23.5 34.5M61 36.4C54 35.2 45 34.7 36.5 34.5M30 41.5V45"/>
    <path class="p s" d="M27.4 29.5V33.6C25.5 34.2 24.3 34.4 23.5 34.5Q30 42.5 36.5 34.5C35.7 34.4 34.5 34.2 32.6 33.6V29.5Z"/>
    <path class="pe d" d="M25.6 36.4h.01M27.6 38.2h.01M30 38.9h.01M32.4 38.2h.01M34.4 36.4h.01"/>
    <path class="p s" d="M23.6 17.2C23.6 25.8 26 30.6 30 30.6C34 30.6 36.4 25.8 36.4 17.2C34.5 15.6 32 16.6 30 14.2C28 16.6 25.5 15.6 23.6 17.2Z"/>
    <path class="s t" d="M25.4 20.8Q27 19.5 28.6 20.8M31.4 20.8Q33 19.5 34.6 20.8M30 21.8l-.8 3.3h1.4M28.2 27.4Q30 28.6 31.8 27.4"/>
    <path class="f st" d="M23 14.4L23.4 8.6L26.8 11.6L30 5.4L33.2 11.6L36.6 8.6L37 14.4Z"/><circle class="p" cx="30" cy="11.4" r="1"/>`,
  J: `<path class="tone" d="M-1 36.2C6 34.6 14 33.8 22 33.5H38C46 33.8 54 34.6 61 36.2V45H-1Z"/><path class="s hatch" d="M5 35.4Q6.4 40.6 5.6 45M11 34.6Q12.8 40 12.2 45M16.6 34.1Q18.2 39.6 17.8 45M43.4 34.1Q41.8 39.6 42.2 45M49 34.6Q47.2 40 47.8 45M55 35.4Q53.6 40.6 54.4 45"/>
    <path class="s" d="M12 9V37"/><path class="f" d="M12 3.6L13.9 9H10.1ZM12.4 11C16.2 11 17 14.4 16.4 17.4C15 15.8 13.8 15.2 12.4 15.2Z"/>
    <path class="s" d="M-1 36.6C6 35.6 13 35.1 21.5 35M61 36.6C54 35.6 47 35.1 38.5 35"/>
    <path class="f" d="M26 35.6H34L35.6 45H24.4Z"/><path class="pe" d="M30 38.6h.01M30 42.2h.01"/>
    <path class="p s" d="M21 33.2L23.3 36L25.6 33.4L27.8 36.2L30 33.6L32.2 36.2L34.4 33.4L36.7 36L39 33.2L37 31.6H23Z"/>
    <path class="p s" d="M23.6 16.4C23.6 25.6 26 30.6 30 30.6C34 30.6 36.4 25.6 36.4 16.4Z"/>
    <path class="f" d="M22.2 16C21.2 21 21.6 25 23.6 28.2L25 20.6L23.8 16ZM37.8 16C38.8 21 38.4 25 36.4 28.2L35 20.6L36.2 16Z"/>
    <path class="s t" d="M25.6 19.2L28.4 18.7M31.6 18.7L34.4 19.2M30 20.8V24.8H31M28.6 27.4H31.4"/>
    <circle class="f" cx="27.2" cy="21.2" r=".75"/><circle class="f" cx="32.8" cy="21.2" r=".75"/>
    <path class="s" d="M36.6 9.8C40.6 6 44.4 5 47.6 3.8C45.4 6.6 42.6 8.6 38.6 11.2M40.2 8L42 8.8M42.8 6.4L44.6 7.1"/>
    <path class="f" d="M21 16.6C20 10.2 25 7.4 31 7.4C37 7.4 41.2 10 40.6 14.6L39.2 16.6Z"/><path class="ps" d="M21.6 15H39.6"/>`
};
const courtCache = {};
function courtArt(rank) {
  if (!courtCache[rank]) {
    const half = COURT_HALF[rank] || COURT_HALF.K;
    courtCache[rank] = `<svg class="court-art" viewBox="0 0 60 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g transform="matrix(1.1 0 0 1.1 -3 -4.5)">${half}</g><g transform="rotate(180 30 45) matrix(1.1 0 0 1.1 -3 -4.5)">${half}</g><path class="s rule" d="M-1 46.6L61 43.4"/></svg>`;
  }
  return courtCache[rank];
}

export function parseCard(text) {
  if (!text || text === 'HIDDEN') return null;
  return { rank: text.slice(0, -1), suit: text.slice(-1) };
}

function faceMarkup(card) {
  const { rank, suit } = card;
  const corner = `<span class="card-corner"><b>${rank}</b><i>${suit}</i></span>`;
  let center;
  if (PIPS[rank]) {
    center = `<span class="card-pips">${PIPS[rank].map(([x, y]) => `<i style="--x:${x};--y:${y}"${y > 50 ? ' class="flip"' : ''}>${suit}</i>`).join('')}</span>`;
  } else if (rank === 'A') {
    center = `<span class="card-ace">${suit}</span>`;
  } else {
    center = `<span class="card-court" data-rank="${rank}">${courtArt(rank)}</span>`;
  }
  // card-mark: the big suit that the large-index faces (Hold'em) show in place of the pips.
  return `${corner}${center}${corner.replace('card-corner', 'card-corner card-corner--end')}<span class="card-mark" aria-hidden="true">${suit}</span>`;
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
