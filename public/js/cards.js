// Playing cards: real pip layouts, 3D flip, and dealing from the shoe.
import { animate, flyFrom, sound, haptic, el, ms } from './fx.js';

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
    center = `<span class="card-court"><b>${rank}</b><i>${suit}</i></span>`;
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
  node.innerHTML = `<div class="card-inner"><div class="card-face${card && RED_SUITS.has(card.suit) ? ' is-red' : ''}">${card ? faceMarkup(card) : ''}</div><div class="${cardBackClass()}"></div></div>`;
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
  haptic(6);
  await flyFrom(node, from, { duration: 460, spin: -24, scale: 0.72, lift: 30 });
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
