// 쪼기: the baccarat squeeze. The face-down cards come up off the felt, big, and the player peels
// them open by hand: drag a corner and it bends back along a fold line, showing the face on its
// underside; drag an edge and the whole side lifts; pull far enough and the card turns over.
// Presentation only: the cards were already decided on the server.
import { createCard, setCardFace, cardBackClass } from './cards.js';
import { animate, sound, haptic, el, reducedMotion } from './fx.js';
import { settings } from './settings.js';

const FLIP_AT = 0.46;    // let go past this much of the card lifted and it turns over
const AUTO_AT = 0.7;     // pull this far and it turns over in your hand
const TAP = 6;           // px of travel that still counts as a tap

// The part of the W×H rectangle on one side of the line through m with normal n:
// keep >= 0 (the part still lying on the felt) or < 0 (the part lifted off it).
function clip(W, H, m, n, lifted) {
  const side = p => ((p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1]) * (lifted ? -1 : 1);
  const box = [[0, 0], [W, 0], [W, H], [0, H]];
  const out = [];
  box.forEach((a, i) => {
    const b = box[(i + 1) % 4], sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  });
  return out.length > 2 ? `polygon(${out.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})` : 'polygon(0 0,0 0,0 0)';
}

// One big card on the squeeze mat.
function squeezeCard(text, { label, onPeek, onOpen }) {
  const node = el('div', 'sq-card');
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', `${label}, 뒷면. 모서리나 옆면을 끌어 쪼고, Enter로 바로 공개`);
  // The underside the flap shows, and the clean face it lands as. The underside has no corner
  // index, so the pips decide it, the way a squeeze reads them: a corner, then a side.
  const face = createCard(text).querySelector('.card-face');
  node.innerHTML = `<div class="sq-back ${cardBackClass()}"></div><div class="sq-flapwrap"><div class="sq-flap"><div class="sq-under"></div><i class="sq-shade"></i></div></div><div class="sq-open"></div>`;
  const under = face.cloneNode(true);
  under.classList.add('sq-face');
  node.querySelector('.sq-under').replaceWith(under);
  const final = face.cloneNode(true);
  final.classList.add('sq-face');
  node.querySelector('.sq-open').append(final);
  const back = node.querySelector('.sq-back');
  const flap = node.querySelector('.sq-flap');
  const shade = node.querySelector('.sq-shade');

  let open = false, grab = null, raf = 0, pending = null, teaser = null;
  const size = () => [node.offsetWidth, node.offsetHeight];

  // Fold the card so that the point g0 on its edge now sits at g. Returns how much of the card
  // (0–1, along the pull) is off the felt.
  function fold(g0, g) {
    const [W, H] = size();
    const dx = g[0] - g0[0], dy = g[1] - g0[1], d = Math.hypot(dx, dy);
    if (d < 0.5) { reset(); return 0; }
    const n = [dx / d, dy / d], m = [(g0[0] + g[0]) / 2, (g0[1] + g[1]) / 2];
    back.style.clipPath = clip(W, H, m, n, false);
    flap.style.clipPath = clip(W, H, m, n, true);
    // Reflect across the fold. The face is under the card, so it is also turned over (scaleX -1
    // about the centre): together that is a rotation, and the pips read the right way round.
    const k = 2 * (m[0] * n[0] + m[1] * n[1]);
    const a = 1 - 2 * n[0] * n[0], b = -2 * n[0] * n[1], d2 = 1 - 2 * n[1] * n[1];
    flap.style.transform = `matrix(${a},${b},${b},${d2},${k * n[0]},${k * n[1]})`;
    under.style.transform = `matrix(-1,0,0,1,${W},0)`;
    // Light catching the bend: bright right at the fold, dimmer out toward the lifted edge.
    const ang = Math.atan2(n[0], -n[1]) * 180 / Math.PI;
    const len = Math.abs(W * n[0]) + Math.abs(H * n[1]);
    const t = (m[0] - W / 2) * n[0] + (m[1] - H / 2) * n[1] + len / 2;
    shade.style.background = `linear-gradient(${ang}deg,#0000 ${(t - d * 0.55).toFixed(1)}px,#0000001f ${(t - 14).toFixed(1)}px,#ffffff66 ${(t - 1.5).toFixed(1)}px,#0000 ${t.toFixed(1)}px)`;
    node.classList.add('is-bent');
    const corners = [[0, 0], [W, 0], [W, H], [0, H]];
    const reach = Math.max(...corners.map(c => (c[0] - g0[0]) * n[0] + (c[1] - g0[1]) * n[1]));
    return Math.min(1, d / 2 / reach);
  }

  function reset() {
    back.style.clipPath = flap.style.clipPath = '';
    node.classList.remove('is-bent');
  }

  // Where a pull from (x, y) starts: a corner when you grab near one, else the nearest edge.
  function anchor(x, y) {
    const [W, H] = size();
    const nearX = x < W * 0.3 ? 0 : x > W * 0.7 ? W : null;
    const nearY = y < H * 0.24 ? 0 : y > H * 0.76 ? H : null;
    if (nearX != null && nearY != null) return { g0: [nearX, nearY], dirs: [[nearX ? -1 : 1, 0], [0, nearY ? -1 : 1]], kind: 'corner' };
    const edges = [[x, [0, y], [1, 0]], [W - x, [W, y], [-1, 0]], [y, [x, 0], [0, 1]], [H - y, [x, H], [0, -1]]];
    const [, g0, dir] = edges.sort((p, q) => p[0] - q[0])[0];
    return { g0, dirs: [dir], kind: 'side' };
  }

  // The pull follows the finger, but only inward: a corner bends any way into the card, an edge
  // lifts square to itself.
  function target(a, dx, dy) {
    if (a.kind === 'side') { const [ux, uy] = a.dirs[0]; const s = Math.max(0, dx * ux + dy * uy); return [a.g0[0] + ux * s, a.g0[1] + uy * s]; }
    const [[ux], [, vy]] = a.dirs;
    return [a.g0[0] + (dx * ux > 0 ? dx : 0), a.g0[1] + (dy * vy > 0 ? dy : 0)];
  }

  function tween(from, to, duration, g0) {
    return new Promise(resolve => {
      if (reducedMotion() || duration <= 0) { fold(g0, to); resolve(); return; }
      const start = performance.now();
      const step = now => {
        const k = Math.min(1, (now - start) / duration), e = 1 - (1 - k) ** 3;
        fold(g0, [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
        if (k < 1) raf = requestAnimationFrame(step); else resolve();
      };
      raf = requestAnimationFrame(step);
    });
  }

  // Lay it back down on the felt.
  async function drop(g0, g) {
    await tween(g, g0, 200, g0);
    reset();
    sound.tick();
  }

  // Turn it over: finish the bend, then the card rolls face up where it lies.
  async function turn(g0 = null, g = null) {
    if (open) return;
    open = true;
    cancelAnimationFrame(raf);
    node.classList.remove('is-grabbed');
    const [W, H] = size();
    if (!g0) { g0 = [W, H * 0.62]; g = g0; }
    const n = g[0] === g0[0] && g[1] === g0[1] ? [g0[0] ? -1 : 1, 0] : (() => { const d = Math.hypot(g[0] - g0[0], g[1] - g0[1]); return [(g[0] - g0[0]) / d, (g[1] - g0[1]) / d]; })();
    const reach = Math.max(...[[0, 0], [W, 0], [W, H], [0, H]].map(c => (c[0] - g0[0]) * n[0] + (c[1] - g0[1]) * n[1]));
    await tween(g, [g0[0] + n[0] * reach * 1.1, g0[1] + n[1] * reach * 1.1], 150, g0);
    reset();
    node.classList.add('is-open');
    node.setAttribute('aria-label', `${label}, ${text}`);
    sound.flip();
    haptic(12);
    if (!reducedMotion()) await animate(node.querySelector('.sq-open'), [
      { transform: `rotate3d(${-n[1]},${n[0]},0,-80deg) scale(1.06)`, filter: 'brightness(.8)' },
      { transform: 'none', filter: 'none' }
    ], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'none' });
    onOpen();
  }

  // A tap with no pull lifts the nearest corner a little and lets it fall: a hint, not a reveal.
  async function tease(x, y) {
    if (teaser) return;
    const a = anchor(x, y);
    const [W, H] = size();
    const lift = Math.min(W, H) * 0.32;
    const to = a.kind === 'corner' ? [a.g0[0] + a.dirs[0][0] * lift, a.g0[1] + a.dirs[1][1] * lift * 0.8] : [a.g0[0] + a.dirs[0][0] * lift * 0.7, a.g0[1] + a.dirs[0][1] * lift * 0.7];
    teaser = tween(a.g0, to, 180, a.g0).then(() => new Promise(r => setTimeout(r, 160))).then(() => !open && !grab && drop(a.g0, to));
    await teaser;
    teaser = null;
  }

  node.addEventListener('pointerdown', e => {
    if (open || grab || e.button > 0) return;
    e.preventDefault();
    cancelAnimationFrame(raf);
    const r = node.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    grab = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x, y, a: anchor(x, y), g: null, p: 0, moved: false };
    node.setPointerCapture?.(e.pointerId);
    node.classList.add('is-grabbed');
    haptic(4);
  });
  node.addEventListener('pointermove', e => {
    if (!grab || e.pointerId !== grab.id || open) return;
    const dx = e.clientX - grab.x0, dy = e.clientY - grab.y0;
    if (!grab.moved && Math.hypot(dx, dy) < TAP) return;
    grab.moved = true;
    pending = [dx, dy];
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!grab || open) return;
      grab.g = target(grab.a, ...pending);
      grab.p = fold(grab.a.g0, grab.g);
      onPeek(grab.a.kind, grab.p);
      if (grab.p >= AUTO_AT) { const { a, g } = grab; grab = null; turn(a.g0, g); }
    });
  });
  const release = e => {
    if (!grab || e.pointerId !== grab.id) return;
    const { a, g, p, moved, x, y } = grab;
    grab = null;
    cancelAnimationFrame(raf); raf = 0;
    node.classList.remove('is-grabbed');
    if (open) return;
    if (!moved || !g) { tease(x, y); return; }
    if (p >= FLIP_AT) turn(a.g0, g); else drop(a.g0, g);
  };
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('lostpointercapture', release);
  node.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    turn();
  });
  return { node, turn: () => turn(), get open() { return open; } };
}

// Squeeze `texts` open over the table, starting from the face-down `nodes` already on the felt.
// Resolves once every card is face up and back in its place on the felt.
// `title` names the hand ('Player'), `total(texts)` gives the hand's point for the reveal.
export async function squeeze(table, nodes, texts, { title, side = 'player', names, total, base = [] } = {}) {
  const stage = el('section', `sq-stage sq-stage--${side}`);
  stage.setAttribute('role', 'dialog');
  stage.setAttribute('aria-label', `${title} 카드 쪼기`);
  // The mat takes the felt's own colours, so an event table's purple squeezes on purple.
  const felt = getComputedStyle(table.felt);
  ['--felt-a', '--felt-b', '--felt-c'].forEach(v => stage.style.setProperty(v, felt.getPropertyValue(v)));
  stage.innerHTML = `
    <div class="sq-head"><span class="sq-title">${title}</span>${texts.length === 1 && names?.[0] ? `<span class="sq-note">${names[0]}</span>` : ''}<span class="sq-total" data-total aria-live="polite"></span></div>
    <div class="sq-mat"><div class="sq-cards" data-cards></div></div>
    <p class="sq-hint" data-hint aria-live="polite"></p>
    <div class="sq-actions">
      <button type="button" class="action action--ghost" data-off>쪼기 끄기</button>
      <button type="button" class="action action--primary" data-all>바로 공개</button>
    </div>`;
  const hintEl = stage.querySelector('[data-hint]');
  const totalEl = stage.querySelector('[data-total]');
  let peeked = { corner: false, side: false };
  const hint = () => {
    hintEl.textContent = !peeked.corner && !peeked.side ? '모서리를 잡고 살짝 들어 보세요'
      : !peeked.side ? '옆면을 잡고 당기면 무늬가 더 보여요'
      : '끝까지 넘기면 뒤집혀요';
  };
  hint();

  let done;
  const finished = new Promise(r => { done = r; });
  const cards = texts.map((text, i) => squeezeCard(text, {
    label: `${title} ${names?.[i] ?? `${i + 1}번째 카드`}`,
    onPeek: (kind, p) => { if (p > 0.1 && !peeked[kind]) { peeked[kind] = true; hint(); } },
    onOpen: () => {
      if (cards.every(c => c.open)) {
        totalEl.textContent = total ? String(total([...base, ...texts])) : '';
        hintEl.textContent = '';
        stage.classList.add('is-done');
        done();
      } else hintEl.textContent = '다음 카드도 쪼아 보세요';
    }
  }));
  stage.querySelector('[data-cards]').append(...cards.map(c => c.node));
  const openAll = async () => { for (const c of cards) if (!c.open) { c.turn(); await new Promise(r => setTimeout(r, reducedMotion() ? 0 : 140)); } };
  stage.querySelector('[data-all]').addEventListener('click', openAll);
  stage.querySelector('[data-off]').addEventListener('click', () => { settings.set('bacSqueeze', false); table.toast('쪼기를 껐어요. 설정에서 다시 켤 수 있어요'); openAll(); });
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); openAll(); } };
  stage.addEventListener('keydown', onKey);

  nodes.forEach(n => n.classList.add('is-lifted'));
  table.root.append(stage);
  stage.querySelector('.sq-card')?.focus({ preventScroll: true });

  // Pick the cards up off the felt: each flies from where it lay.
  const travel = (card, from, reverse) => {
    const a = from.getBoundingClientRect(), b = card.node.getBoundingClientRect();
    const s = Math.min(a.width, a.height) / b.width;
    const turned = from.classList.contains('is-sideways') ? ' rotate(90deg)' : '';
    const there = { transform: `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px,${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${s})${turned}` };
    const here = { transform: 'none' };
    return animate(card.node, reverse ? [here, there] : [there, here], { duration: 340, easing: reverse ? 'cubic-bezier(.5,0,.3,1)' : 'cubic-bezier(.16,.84,.3,1)', fill: reverse ? 'forwards' : 'none' });
  };
  if (!reducedMotion()) {
    stage.classList.add('is-entering');
    await Promise.all(cards.map((c, i) => travel(c, nodes[i])));
    stage.classList.remove('is-entering');
  }

  await finished;
  await new Promise(r => setTimeout(r, reducedMotion() ? 250 : 750));
  // Put them back down face up, then hand the felt back.
  stage.classList.add('is-leaving');
  if (!reducedMotion()) await Promise.all(cards.map((c, i) => travel(c, nodes[i], true)));
  nodes.forEach((n, i) => { setCardFace(n, texts[i]); n.classList.add('is-faceup'); n.classList.remove('is-lifted'); });
  stage.remove();
}

export const squeezeOn = () => settings.get('bacSqueeze') !== false;
