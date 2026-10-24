// The dealer's hands: the motions a real dealer makes between and around the cards.
//   riffle()      — a riffle shuffle between rounds, the pile then squared and loaded into the shoe
//   gatherCards() — cards picked up in order, squared into one pile, then laid in the discard tray
//   rake()        — lost chips pulled together and dragged off to the rack with the paddle
//   pushPay()     — a cut stack slid across the felt from the rack to sit beside the bet
// Everything here is looks only; the server has already decided the round.
import { animate, sound, ms, reducedMotion } from './fx.js';
import { buzz } from './haptics.js';
import { cardBackClass } from './cards.js';

const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// The dealer's paddle: a lacquered stick with a pale edge, on the far side of whatever it pushes.
function paddle(at, width) {
  const p = document.createElement('i');
  p.className = 'dealer-paddle';
  p.setAttribute('aria-hidden', 'true');
  Object.assign(p.style, { left: `${at.x - width / 2}px`, top: `${at.y}px`, width: `${width}px` });
  document.body.append(p);
  return p;
}

// A fixed-position copy of a chip, so it can travel over the felt's clipped edge.
function flyer(chip) {
  const r = chip.getBoundingClientRect();
  if (!r.width) return null;
  const c = chip.cloneNode(true);
  c.classList.add('chip-flyer');
  Object.assign(c.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  c.style.setProperty('--size', `${r.width}px`);
  document.body.append(c);
  chip.style.visibility = 'hidden';
  return { node: c, rect: r };
}

// ---------- chips ----------
// The house takes the chips: they are pulled into one pile where they lie, then the paddle
// drags the pile across the felt to the rack. `chips` are chip nodes already on the felt.
export async function rake(chips, toRect) {
  const flyers = chips.map(flyer).filter(Boolean);
  if (!flyers.length) return;
  if (reducedMotion()) { flyers.forEach(f => f.node.remove()); return; }
  const rects = flyers.map(f => f.rect);
  const mid = rects.reduce((a, r) => ({ x: a.x + center(r).x / rects.length, y: a.y + center(r).y / rects.length }), { x: 0, y: 0 });
  // Pile up on the side nearest the player first, then drag toward the dealer.
  const size = rects[0].width;
  const dest = center(toRect);
  const gather = 0.38;
  buzz('rake');
  const stick = paddle({ x: mid.x, y: mid.y + size * 0.55 }, Math.max(size * 1.9, 46));
  const dx = dest.x - mid.x, dy = dest.y - mid.y;
  const total = 760;
  const moves = flyers.map(({ node, rect }, i) => {
    const c = center(rect);
    const gx = mid.x - c.x, gy = mid.y - c.y - i * 2.5;
    return animate(node, [
      { transform: 'translate(0,0)', opacity: 1 },
      { transform: `translate(${gx}px,${gy}px)`, opacity: 1, offset: gather },
      { transform: `translate(${gx}px,${gy}px)`, opacity: 1, offset: gather + 0.08 },
      { transform: `translate(${gx + dx}px,${gy + dy}px) scale(.8)`, opacity: 0.0 }
    ], { duration: total, easing: 'cubic-bezier(.4,0,.25,1)' }).then(() => node.remove());
  });
  const stickMove = animate(stick, [
    { transform: 'translateY(14px) rotate(-4deg)', opacity: 0 },
    { transform: 'translateY(0) rotate(-2deg)', opacity: 1, offset: gather },
    { transform: 'translateY(0) rotate(0)', opacity: 1, offset: gather + 0.08 },
    { transform: `translate(${dx}px,${dy}px) rotate(3deg)`, opacity: 0.0 }
  ], { duration: total, easing: 'cubic-bezier(.4,0,.25,1)' }).then(() => stick.remove());
  setTimeout(() => sound.chips(2), ms(total * gather * 0.6));
  setTimeout(() => sound.chip(), ms(total * 0.92));
  await Promise.all([...moves, stickMove]);
}

// A win is paid the way a dealer pays it: a stack cut at the rack and slid flat across the felt,
// the paddle behind it, to sit beside the bet. `stack` is the payout stack already in place.
export async function pushPay(stack, fromRect, { delay = 0 } = {}) {
  if (!stack?.children.length) return;
  const to = stack.getBoundingClientRect();
  const from = center(fromRect), here = center(to);
  const dx = from.x - here.x, dy = from.y - here.y;
  if (reducedMotion() || !to.width) return;
  const stick = paddle({ x: from.x, y: from.y - to.height * 0.75 }, Math.max(to.width * 1.9, 46));
  stick.style.visibility = 'hidden';
  const duration = 560;
  const run = () => {
    stick.style.visibility = '';
    sound.chips(2);
    return Promise.all([
      animate(stack, [
        { transform: `translate(${dx}px,${dy}px) scale(.92)`, opacity: 0 },
        { transform: `translate(${dx}px,${dy}px) scale(.92)`, opacity: 1, offset: 0.12 },
        { transform: 'translate(0,2px) scale(1)', opacity: 1, offset: 0.86 },
        { transform: 'translate(0,0) scale(1)', opacity: 1 }
      ], { duration, easing: 'cubic-bezier(.22,.7,.3,1)', fill: 'backwards' }),
      animate(stick, [
        { transform: 'translate(0,0)', opacity: 0 },
        { transform: 'translate(0,0)', opacity: 1, offset: 0.12 },
        { transform: `translate(${-dx}px,${-dy}px)`, opacity: 1, offset: 0.86 },
        { transform: `translate(${-dx * 0.92}px,${-dy * 0.92 - 10}px)`, opacity: 0 }
      ], { duration, easing: 'cubic-bezier(.22,.7,.3,1)' }).then(() => stick.remove())
    ]).then(() => buzz('pay'));
  };
  // Keep the stack out of sight until its turn comes.
  if (delay) { stack.style.opacity = '0'; await new Promise(r => setTimeout(r, ms(delay))); stack.style.opacity = ''; }
  await run();
}

// ---------- cards ----------
// The used cards: picked up one by one into a squared pile where the dealer's hand stands, then
// the pile goes into the discard tray, which fills up until the next shuffle.
export async function gatherCards(containers, discard, { at = null } = {}) {
  const cards = containers.flatMap(c => [...c.querySelectorAll('.card')]);
  if (!cards.length) return;
  const tray = discard.getBoundingClientRect();
  const spot = at ? center(at) : center(containers[0].getBoundingClientRect());
  const end = center(tray);
  const pick = 45, slide = 340;
  const total = cards.length * pick + 260 + slide;
  sound.gather?.();
  await Promise.all(cards.map((card, i) => {
    const c = center(card.getBoundingClientRect());
    const gx = spot.x - c.x, gy = spot.y - c.y - i * 0.6;
    const ex = end.x - c.x, ey = end.y - c.y;
    const start = i * pick;
    const own = total - start;
    const g = (220) / own, hold = (total - slide - start) / own;
    return animate(card, [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${gx}px,${gy}px) rotate(0deg)`, opacity: 1, offset: Math.min(g, hold) },
      { transform: `translate(${gx}px,${gy}px) rotate(0deg)`, opacity: 1, offset: hold },
      { transform: `translate(${ex}px,${ey}px) rotate(90deg) scale(.55)`, opacity: 0 }
    ], { duration: own, delay: start, easing: 'cubic-bezier(.45,0,.3,1)' });
  }).concat(
    new Promise(r => setTimeout(() => { sound.card(); r(); }, ms(total - slide)))
  ));
  containers.forEach(c => c.replaceChildren());
  addToDiscard(discard, cards.length);
}

// How full the discard tray looks. Reaching the cut card (`cut` cards) calls for a shuffle.
export function addToDiscard(discard, n) {
  const count = Number(discard.dataset.count || 0) + n;
  discard.dataset.count = String(count);
  let pile = discard.querySelector('.discard-pile');
  if (!pile) { pile = document.createElement('i'); pile.className = 'discard-pile'; discard.append(pile); }
  discard.style.setProperty('--depth', String(Math.min(1, count / 80)));
}
export const discardCount = discard => Number(discard?.dataset.count || 0);
export const needsShuffle = (discard, cut = 60) => !discard?.dataset.shuffled || discardCount(discard) >= cut;

// A riffle shuffle where the dealer stands: the deck cut in two, the halves riffled together,
// squared with a tap, and loaded into the shoe. The discards join the deck first.
export async function riffle(felt, { shoe, discard, at = null } = {}) {
  if (discard) { discard.dataset.shuffled = '1'; discard.dataset.count = '0'; discard.style.setProperty('--depth', '0'); }
  if (reducedMotion() || !felt?.isConnected) return;
  const box = felt.getBoundingClientRect();
  const spot = at ? center(at) : { x: box.left + box.width / 2, y: box.top + Math.min(box.height * 0.28, 150) };
  const layer = document.createElement('div');
  layer.className = 'riffle';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${spot.x}px`;
  layer.style.top = `${spot.y}px`;
  const N = 14;
  const cards = [];
  for (let i = 0; i < N * 2; i++) {
    const c = document.createElement('i');
    c.className = `riffle-card ${cardBackClass()}`;
    c.style.setProperty('--k', String(i % N));
    layer.append(c);
    cards.push({ node: c, left: i < N, k: i % N });
  }
  const label = document.createElement('span');
  label.className = 'riffle-label';
  label.textContent = 'SHUFFLE';
  layer.append(label);
  document.body.append(layer);
  buzz('shuffle');
  const split = 230, fall = 34, square = 180;
  const w = 34;
  // 1. Cut: the two halves part and bend up at the inner corners.
  // 2. Riffle: cards fall off the thumbs alternately, left and right, onto one pile.
  // 3. Square up: the pile taps the felt once.
  const anims = cards.map(({ node, left, k }) => {
    const side = left ? -1 : 1;
    const order = (N - 1 - k) * 2 + (left ? 0 : 1); // bottom cards fall first, sides alternate
    const dropAt = split + order * fall;
    const totalT = split + N * 2 * fall + square + 120;
    const o1 = split / totalT, o2 = dropAt / totalT, o3 = Math.min(0.97, (dropAt + 70) / totalT);
    const lift = -k * 0.8;
    const finalY = -order * 0.5;
    return animate(node, [
      { transform: `translate(0px,${lift}px) rotate(0deg)` },
      { transform: `translate(${side * w}px,${lift}px) rotate(${side * -6}deg) rotateY(${side * -18}deg)`, offset: o1 },
      { transform: `translate(${side * w}px,${lift - 3}px) rotate(${side * -9}deg) rotateY(${side * -26}deg)`, offset: Math.max(o1, o2 - 0.01) },
      { transform: `translate(${side * 2}px,${finalY}px) rotate(${side * 1.5}deg)`, offset: o3 },
      { transform: `translate(0px,${finalY}px) rotate(0deg)` }
    ], { duration: totalT, easing: 'linear', fill: 'both' });
  });
  setTimeout(() => sound.shuffle?.(), ms(split));
  await Promise.all(anims);
  sound.card();
  await animate(layer, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(.97) translateY(2px)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 140, fill: 'none' });
  // Into the shoe.
  if (shoe?.isConnected) {
    const to = center(shoe.getBoundingClientRect());
    await animate(layer, [
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${to.x - spot.x}px),calc(-50% + ${to.y - spot.y}px)) rotate(-8deg) scale(.5)`, opacity: 0 }
    ], { duration: 420, easing: 'cubic-bezier(.5,0,.3,1)' });
    sound.card();
  }
  layer.remove();
}
