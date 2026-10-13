// Draws the key art for every game and event card: one 480×360 SVG per id in public/art/.
// Each picture is a small still life lit from above in the black lounge: lacquer room, a pool
// of light on the felt, and the game's own objects (cards, chips, plaques, wheel, dice, hwatu,
// horses) drawn as real things with shadow and shine. Run `node scripts/art.mjs` after an edit;
// the SVGs are committed so the app needs no build step.
import { mkdirSync, writeFileSync } from 'node:fs';
import { hwatuSvg } from '../public/js/hwatu.js';

const W = 480, H = 360;
const SANS = `'Archivo','Helvetica Neue',Arial,sans-serif`;
const f = n => +n.toFixed(2);
let uid = 0;
const id = p => `${p}${++uid}`;

const FELT = {
  green: ['#1f7d5c', '#0e4e37', '#04200f'],
  blue: ['#285f9a', '#143660', '#06142a'],
  red: ['#8a2635', '#4f1320', '#1c050a'],
  poker: ['#21776a', '#0f4740', '#041d1a'],
  purple: ['#55407e', '#2d2346', '#0f0a1a'],
  amber: ['#7a5a2e', '#3f2c16', '#150d05'],
  olive: ['#55613f', '#2f3824', '#10140b'],
  ink: ['#2b2f37', '#15171c', '#060709'],
  turf: ['#1d5e40', '#103d29', '#051b11']
};

const CHIP = {
  ivory: ['#ece6d9', '#ffffff', '#9a8f7e', '#3a332b'],
  teal: ['#2f6b6a', '#efe7d9', '#1f4a49', '#f6f1e7'],
  black: ['#1e1c1b', '#d9cfbd', '#0c0b0b', '#e3d3b0'],
  purple: ['#4b3566', '#ece4f2', '#2f2142', '#f6f1e7'],
  pink: ['#8e4a62', '#f5e9ee', '#5e2f40', '#f6f1e7'],
  gold: ['#c9b083', '#f8f0dc', '#8c7448', '#2a2014'],
  wine: ['#6a1f27', '#e3d3b0', '#3c1015', '#e3d3b0']
};

// ---------- room, table, light ----------

function defs(felt) {
  const [a, b, c] = FELT[felt];
  return `<defs>
  <radialGradient id="room" cx="50%" cy="-8%" r="95%"><stop offset="0" stop-color="#2a2826"/><stop offset=".45" stop-color="#121214"/><stop offset="1" stop-color="#050506"/></radialGradient>
  <radialGradient id="felt" cx="50%" cy="34%" r="70%"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>
  <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3e"/><stop offset=".18" stop-color="#151517"/><stop offset="1" stop-color="#060607"/></linearGradient>
  <radialGradient id="pool" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff6e6" stop-opacity=".2"/><stop offset=".6" stop-color="#fff6e6" stop-opacity=".05"/><stop offset="1" stop-color="#fff6e6" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".72"/></radialGradient>
  <linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9e5dc"/></linearGradient>
  <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f4f2"/><stop offset=".35" stop-color="#8d8f93"/><stop offset=".55" stop-color="#e2e3e4"/><stop offset="1" stop-color="#4a4c50"/></linearGradient>
  <filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dy="6"/><feComponentTransfer><feFuncA type="linear" slope=".55"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="blur3"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .07"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/></filter>
</defs>`;
}

// Bokeh lights in the dark room behind the table.
function bokeh(seed = 1, tint = '#ffe9c7', n = 9) {
  let s = seed * 9301 + 49297;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = 8 + rnd() * 92, r = 6 + rnd() * 16;
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${tint}" opacity="${f(0.05 + rnd() * 0.1)}"/>`;
  }
  return `<g filter="url(#blur3)">${out}</g>`;
}

// A table seen from a standing player: lacquer rail across the top, felt below, light pool.
function table({ top = 104, pool = [240, 220, 220, 120] } = {}) {
  const ry = 560;
  return `<ellipse cx="240" cy="${top + ry}" rx="520" ry="${ry}" fill="url(#rail)"/>
  <ellipse cx="240" cy="${top + ry}" rx="519" ry="${ry - 1}" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="1.2"/>
  <ellipse cx="240" cy="${top + 22 + ry}" rx="500" ry="${ry - 2}" fill="url(#felt)"/>
  <ellipse cx="240" cy="${top + 22 + ry}" rx="500" ry="${ry - 2}" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="3"/>
  <ellipse cx="${pool[0]}" cy="${pool[1]}" rx="${pool[2]}" ry="${pool[3]}" fill="url(#pool)"/>`;
}

function finish() {
  return `<rect width="${W}" height="${H}" fill="url(#vig)"/><rect width="${W}" height="${H}" filter="url(#grain)"/>`;
}

function svg(felt, body, { label = '' } = {}) {
  uid = 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">
${defs(felt)}
<rect width="${W}" height="${H}" fill="url(#room)"/>
${body}
${finish()}
</svg>
`;
}

// Text printed into the felt, following an arc.
function feltArc(text, { cy = 560, r = 300, y0 = 0, size = 13, op = 0.45, spacing = 3 } = {}) {
  const p = id('arc');
  return `<path id="${p}" d="M${240 - r} ${cy + y0} A${r} ${r * 0.8} 0 0 1 ${240 + r} ${cy + y0}" fill="none"/>
  <text font-family="${SANS}" font-size="${size}" font-weight="700" letter-spacing="${spacing}" fill="#f4efe4" fill-opacity="${op}" text-anchor="middle"><textPath href="#${p}" startOffset="50%">${text}</textPath></text>`;
}

// ---------- playing cards ----------

const SUIT = {
  h: 'M10 18C4 13 0 9.5 0 5.6C0 2.4 2.4 0 5.4 0C7.4 0 9 1.2 10 3C11 1.2 12.6 0 14.6 0C17.6 0 20 2.4 20 5.6C20 9.5 16 13 10 18Z',
  d: 'M10 0L17.5 10L10 20L2.5 10Z',
  s: 'M10 0C13 5 20 8 20 12.6C20 15.4 17.8 17.2 15.4 17.2C13.6 17.2 12.2 16.4 11.3 15C11.6 17 12.4 18.6 14 20H6C7.6 18.6 8.4 17 8.7 15C7.8 16.4 6.4 17.2 4.6 17.2C2.2 17.2 0 15.4 0 12.6C0 8 7 5 10 0Z',
  c: 'M10 0.4A4.6 4.6 0 0 1 13.9 7.4A4.6 4.6 0 1 1 11.2 14.6C11.5 16.8 12.4 18.6 14 20H6C7.6 18.6 8.5 16.8 8.8 14.6A4.6 4.6 0 1 1 6.1 7.4A4.6 4.6 0 0 1 10 .4Z'
};
const RED = '#b3122b', INK = '#141416';
const pip = (s, x, y, size, flip = false) =>
  `<path d="${SUIT[s]}" fill="${'hd'.includes(s) ? RED : INK}" transform="translate(${f(x)} ${f(y)})${flip ? ' rotate(180)' : ''} scale(${f(size / 20)}) translate(-10 -10)"/>`;

// Pip positions on a 60×84 face, as (x, y, flipped).
const PIPS = {
  2: [[30, 18], [30, 66, 1]], 3: [[30, 18], [30, 42], [30, 66, 1]],
  4: [[19, 18], [41, 18], [19, 66, 1], [41, 66, 1]],
  5: [[19, 18], [41, 18], [30, 42], [19, 66, 1], [41, 66, 1]],
  6: [[19, 18], [41, 18], [19, 42], [41, 42], [19, 66, 1], [41, 66, 1]],
  7: [[19, 18], [41, 18], [30, 30], [19, 42], [41, 42], [19, 66, 1], [41, 66, 1]],
  8: [[19, 18], [41, 18], [30, 30], [19, 42], [41, 42], [30, 54, 1], [19, 66, 1], [41, 66, 1]],
  9: [[19, 17], [41, 17], [19, 33], [41, 33], [30, 42], [19, 51, 1], [41, 51, 1], [19, 67, 1], [41, 67, 1]],
  10: [[19, 17], [41, 17], [30, 26], [19, 33], [41, 33], [19, 51, 1], [41, 51, 1], [30, 58, 1], [19, 67, 1], [41, 67, 1]]
};

function cardFace(rank, s) {
  const col = 'hd'.includes(s) ? RED : INK;
  const idx = (x, y, flip) => `<g transform="translate(${x} ${y})${flip ? ' rotate(180)' : ''}"><text x="0" y="0" font-family="${SANS}" font-size="${rank === '10' ? 11 : 12.5}" font-weight="800" fill="${col}" text-anchor="middle" letter-spacing="${rank === '10' ? -1 : 0}">${rank}</text>${pip(s, 0, 7.5, 7.5)}</g>`;
  let centre;
  const n = +rank;
  if (n >= 2) centre = PIPS[n].map(([x, y, fl]) => pip(s, x, y, 11, !!fl)).join('');
  else if (rank === 'A') centre = pip(s, 30, 42, s === 's' ? 30 : 24);
  else {
    // Court cards: a framed panel with a big letter and suit, modern rather than ornate.
    centre = `<rect x="13" y="13" width="34" height="58" rx="2.5" fill="none" stroke="${col}" stroke-opacity=".55" stroke-width="1"/>
      <rect x="15.5" y="15.5" width="29" height="53" rx="1.5" fill="${col}" fill-opacity=".07"/>
      <text x="30" y="47" font-family="${SANS}" font-size="27" font-weight="800" fill="${col}" text-anchor="middle">${rank}</text>${pip(s, 30, 58, 10)}`;
  }
  return `<rect width="60" height="84" rx="5" fill="url(#card)"/><rect x=".5" y=".5" width="59" height="83" rx="4.5" fill="none" stroke="#000" stroke-opacity=".18"/>
    ${idx(7, 13)}${idx(53, 71, true)}${centre}`;
}

function cardBack(tone = '#7a1622') {
  const p = id('bk');
  return `<pattern id="${p}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${tone}"/><path d="M0 0H6" stroke="#fff" stroke-opacity=".16" stroke-width="1.2"/></pattern>
    <rect width="60" height="84" rx="5" fill="#f5f2ea"/><rect x="4" y="4" width="52" height="76" rx="3" fill="url(#${p})"/><rect x="4" y="4" width="52" height="76" rx="3" fill="none" stroke="#000" stroke-opacity=".25"/>`;
}

// A card lying on the felt: placed by centre, turned, scaled; tilt squashes it into the table plane.
function card(x, y, face, { rot = 0, scale = 1, tilt = 0.86 } = {}) {
  const inner = face === 'back' ? cardBack() : face.startsWith('back:') ? cardBack(face.slice(5)) : cardFace(face.slice(0, -1), face.slice(-1));
  return `<g transform="translate(${f(x)} ${f(y)}) scale(1 ${tilt}) rotate(${rot}) scale(${scale}) translate(-30 -42)" filter="url(#sh)">${inner}</g>`;
}

// ---------- chips and plaques ----------

function chip(cx, cy, r, color, n = 1, { spots = 6 } = {}) {
  const [c, edge, rim, ink] = CHIP[color];
  const ry = r * 0.42, t = r * 0.17;
  let out = `<ellipse cx="${cx}" cy="${f(cy + ry * 0.5)}" rx="${f(r * 1.08)}" ry="${f(ry * 1.05)}" fill="#000" opacity=".45" filter="url(#blur3)"/>`;
  for (let i = 0; i < n; i++) {
    const y = cy - i * t;
    // Side band of this chip, with its edge spots.
    out += `<path d="M${f(cx - r)} ${f(y)}A${f(r)} ${f(ry)} 0 0 0 ${f(cx + r)} ${f(y)}V${f(y - t)}A${f(r)} ${f(ry)} 0 0 1 ${f(cx - r)} ${f(y - t)}Z" fill="${rim}"/>`;
    for (let k = 0; k < spots; k++) {
      const a = ((k + 0.5 + (i % 2) * 0.5) / spots) * Math.PI;
      const x = cx - r * Math.cos(a), w = r * 0.16 * Math.sin(a);
      out += `<rect x="${f(x - w / 2)}" y="${f(y - t + ry * Math.sin(a) + t * 0.12)}" width="${f(w)}" height="${f(t * 0.76)}" fill="${edge}" opacity=".9"/>`;
    }
    out += `<path d="M${f(cx - r)} ${f(y - t)}A${f(r)} ${f(ry)} 0 0 0 ${f(cx + r)} ${f(y - t)}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width=".8"/>`;
  }
  const ty = cy - n * t;
  const dash = f((Math.PI * r * 0.86 * 2) / 24);
  out += `<ellipse cx="${cx}" cy="${f(ty)}" rx="${r}" ry="${f(ry)}" fill="${c}"/>
    <ellipse cx="${cx}" cy="${f(ty)}" rx="${f(r * 0.86)}" ry="${f(ry * 0.86)}" fill="none" stroke="${edge}" stroke-width="${f(r * 0.13)}" stroke-dasharray="${dash} ${dash}" transform="rotate(0)"/>
    <ellipse cx="${cx}" cy="${f(ty)}" rx="${f(r * 0.58)}" ry="${f(ry * 0.58)}" fill="${c}" stroke="${ink}" stroke-opacity=".5" stroke-width=".9"/>
    <ellipse cx="${f(cx - r * 0.25)}" cy="${f(ty - ry * 0.35)}" rx="${f(r * 0.5)}" ry="${f(ry * 0.3)}" fill="#fff" opacity=".12"/>`;
  return out;
}

// A rectangular plaque lying flat: pearl top with an engraved inlay and value, thin side edge.
function plaque(cx, cy, w, color = 'ivory', { n = 1, label = '', rot = 0 } = {}) {
  const [c, edge, rim, ink] = CHIP[color];
  const d = w * 0.62, sk = 0.45, t = w * 0.075;
  let out = `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${rot})">`;
  out += `<ellipse cx="0" cy="${f(d * sk * 0.3)}" rx="${f(w * 0.62)}" ry="${f(d * sk * 0.75)}" fill="#000" opacity=".5" filter="url(#blur3)"/>`;
  for (let i = 0; i < n; i++) {
    const y = -i * t;
    out += `<rect x="${f(-w / 2)}" y="${f(y + (d * sk) / 2 - t)}" width="${f(w)}" height="${f(t)}" fill="${rim}"/><rect x="${f(-w / 2)}" y="${f(y + (d * sk) / 2 - t)}" width="${f(w)}" height="${f(t * 0.25)}" fill="#fff" opacity=".18"/>`;
  }
  const y = -n * t;
  out += `<g transform="translate(0 ${f(y)}) scale(1 ${sk})">
    <rect x="${f(-w / 2)}" y="${f(-d / 2)}" width="${f(w)}" height="${f(d)}" rx="${f(w * 0.06)}" fill="${c}"/>
    <rect x="${f(-w / 2 + w * 0.08)}" y="${f(-d / 2 + d * 0.13)}" width="${f(w * 0.84)}" height="${f(d * 0.74)}" rx="${f(w * 0.03)}" fill="none" stroke="${ink}" stroke-opacity=".4" stroke-width="1.2"/>
    <rect x="${f(-w / 2)}" y="${f(-d / 2)}" width="${f(w)}" height="${f(d * 0.42)}" rx="${f(w * 0.06)}" fill="#fff" opacity=".14"/>
  </g>`;
  if (label) out += `<text x="0" y="${f(y + 3)}" font-family="${SANS}" font-size="${f(w * 0.17)}" font-weight="700" fill="${ink}" fill-opacity=".8" text-anchor="middle" transform="translate(0 ${f(y)}) scale(1 ${sk}) translate(0 ${f(-y)})">${label}</text>`;
  return out + '</g>';
}

// ---------- roulette ----------

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function wheel(cx, cy, R, { ball = 17, tilt = 0.5, spin = 0 } = {}) {
  const g = id('wg'), cone = id('cn');
  const wedge = (a0, a1, r0, r1) => {
    const p = (a, r) => `${f(r * Math.cos(a))} ${f(r * Math.sin(a))}`;
    return `M${p(a0, r0)}L${p(a0, r1)}A${r1} ${r1} 0 0 1 ${p(a1, r1)}L${p(a1, r0)}A${r0} ${r0} 0 0 0 ${p(a0, r0)}Z`;
  };
  const step = (2 * Math.PI) / 37;
  let pockets = '', nums = '';
  WHEEL.forEach((n, i) => {
    const a0 = i * step + spin, a1 = a0 + step;
    const col = n === 0 ? '#1a7a4c' : REDS.has(n) ? '#a3172a' : '#141416';
    pockets += `<path d="${wedge(a0, a1, R * 0.62, R * 0.8)}" fill="${col}" stroke="url(#chrome)" stroke-width="${f(R * 0.012)}"/>`;
    const am = a0 + step / 2, rr = R * 0.86;
    nums += `<path d="${wedge(a0, a1, R * 0.8, R * 0.93)}" fill="${col}"/><text x="${f(rr * Math.cos(am))}" y="${f(rr * Math.sin(am))}" font-family="${SANS}" font-size="${f(R * 0.06)}" font-weight="700" fill="#f4efe4" text-anchor="middle" dominant-baseline="central" transform="rotate(${f((am * 180) / Math.PI + 90)} ${f(rr * Math.cos(am))} ${f(rr * Math.sin(am))})">${n}</text>`;
  });
  const bi = WHEEL.indexOf(ball), ba = bi * step + step / 2 + spin, br = R * 0.71;
  const bx = cx + br * Math.cos(ba), by = cy + br * Math.sin(ba) * tilt;
  return `<radialGradient id="${g}" cx="50%" cy="50%" r="50%"><stop offset=".7" stop-color="#1b1b1e"/><stop offset=".9" stop-color="#0a0a0b"/><stop offset="1" stop-color="#2a2a2e"/></radialGradient>
  <radialGradient id="${cone}" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#3a3a40"/><stop offset="1" stop-color="#0c0c0e"/></radialGradient>
  <ellipse cx="${cx}" cy="${f(cy + R * tilt * 0.22)}" rx="${f(R * 1.12)}" ry="${f(R * tilt * 1.08)}" fill="#000" opacity=".6" filter="url(#soft)"/>
  <path d="M${f(cx - R)} ${cy}V${f(cy + R * 0.12)}A${R} ${f(R * tilt)} 0 0 0 ${f(cx + R)} ${f(cy + R * 0.12)}V${cy}Z" fill="#0b0b0c"/>
  <g transform="translate(${cx} ${cy}) scale(1 ${tilt})">
    <circle r="${R}" fill="url(#${g})"/><circle r="${R}" fill="none" stroke="url(#chrome)" stroke-width="${f(R * 0.025)}"/>
    <circle r="${f(R * 0.94)}" fill="none" stroke="#fff" stroke-opacity=".1"/>
    ${nums}${pockets}
    <circle r="${f(R * 0.62)}" fill="url(#${cone})"/><circle r="${f(R * 0.62)}" fill="none" stroke="url(#chrome)" stroke-width="${f(R * 0.015)}"/>
    ${[0, 1, 2, 3].map(k => `<path d="M0 0L${f(R * 0.42 * Math.cos(spin + k * Math.PI / 2))} ${f(R * 0.42 * Math.sin(spin + k * Math.PI / 2))}" stroke="url(#chrome)" stroke-width="${f(R * 0.035)}" stroke-linecap="round"/>`).join('')}
    ${[0, 1, 2, 3].map(k => `<circle cx="${f(R * 0.42 * Math.cos(spin + k * Math.PI / 2))}" cy="${f(R * 0.42 * Math.sin(spin + k * Math.PI / 2))}" r="${f(R * 0.03)}" fill="url(#chrome)"/>`).join('')}
  </g>
  <ellipse cx="${cx}" cy="${f(cy - R * 0.03)}" rx="${f(R * 0.07)}" ry="${f(R * 0.05)}" fill="url(#chrome)"/>
  <rect x="${f(cx - R * 0.018)}" y="${f(cy - R * 0.2)}" width="${f(R * 0.036)}" height="${f(R * 0.18)}" fill="url(#chrome)"/>
  <circle cx="${f(cx)}" cy="${f(cy - R * 0.22)}" r="${f(R * 0.04)}" fill="url(#chrome)"/>
  <circle cx="${f(bx)}" cy="${f(by - R * 0.02)}" r="${f(R * 0.035)}" fill="#fbfaf6"/><circle cx="${f(bx - R * 0.01)}" cy="${f(by - R * 0.03)}" r="${f(R * 0.012)}" fill="#fff"/>
  <ellipse cx="${cx}" cy="${f(cy - R * tilt * 0.45)}" rx="${f(R * 0.6)}" ry="${f(R * tilt * 0.25)}" fill="#fff" opacity=".06"/>`;
}

// ---------- dice ----------

const FACE_PIPS = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]], 5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]], 6: [[.27, .23], [.73, .23], [.27, .5], [.73, .5], [.27, .77], [.73, .77]] };

// A translucent red casino die in a three-quarter view: top, left and right faces.
function die(cx, cy, s, [top, left, right], { turn = 0 } = {}) {
  const a = (30 + turn) * Math.PI / 180, b = (30 - turn) * Math.PI / 180;
  const ex = [s * Math.cos(a), -s * Math.sin(a) * 0.9], ey = [-s * Math.cos(b), -s * Math.sin(b) * 0.9], ez = [0, -s * 1.02];
  // Origin is the near bottom corner.
  const o = [cx, cy];
  const P = (u, v, w) => [o[0] + u * ex[0] + v * ey[0] + w * ez[0], o[1] + u * ex[1] + v * ey[1] + w * ez[1]];
  const poly = pts => pts.map(p => `${f(p[0])},${f(p[1])}`).join(' ');
  const face = (origin, du, dv, fill, n, shade) => {
    const [ox, oy] = origin;
    const m = `matrix(${f(du[0])} ${f(du[1])} ${f(dv[0])} ${f(dv[1])} ${f(ox)} ${f(oy)})`;
    const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [ox + u * du[0] + v * dv[0], oy + u * du[1] + v * dv[1]]);
    return `<polygon points="${poly(pts)}" fill="${fill}"/>
      <g transform="${m}">${FACE_PIPS[n].map(([u, v]) => `<circle cx="${u}" cy="${v}" r=".095" fill="#fbf7ee"/>`).join('')}</g>
      <polygon points="${poly(pts)}" fill="#000" opacity="${shade}"/>`;
  };
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
  const A = P(0, 0, 1), B = P(1, 0, 1), C = P(0, 1, 1);
  return `<ellipse cx="${f(cx + (ex[0] + ey[0]) * 0.5 + s * 0.12)}" cy="${f(cy + (ex[1] + ey[1]) * 0.5 + 4)}" rx="${f(s * 1.05)}" ry="${f(s * 0.5)}" fill="#000" opacity=".55" filter="url(#blur3)"/>
    ${face(P(0, 1, 1), sub(P(0, 1, 0), P(0, 1, 1)), sub(P(0, 0, 1), P(0, 1, 1)), '#9c1225', left, 0)}
    ${face(P(0, 0, 1), sub(P(1, 0, 1), A), sub(P(0, 0, 0), A), '#b8162c', right, 0)}
    ${face(P(0, 1, 1), sub(P(1, 1, 1), C), sub(P(0, 0, 1), C), '#d4243a', top, 0)}
    <polyline points="${poly([P(0, 1, 1), P(0, 0, 1), P(1, 0, 1)])}" fill="none" stroke="#ff8a96" stroke-opacity=".7" stroke-width="1.2" stroke-linejoin="round"/>
    <polyline points="${poly([P(0, 0, 1), P(0, 0, 0)])}" fill="none" stroke="#ff8a96" stroke-opacity=".45" stroke-width="1"/>
    <polygon points="${poly([P(0, 1, 1), P(1, 1, 1), P(1, 0, 1), P(0, 0, 1)])}" fill="#fff" opacity=".07"/>`;
}

// A glass cloche over the dice.
function dome(cx, cy, r, { lift = 0 } = {}) {
  const g = id('dm');
  const y = cy - lift;
  return `<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".2" stop-color="#fff" stop-opacity=".04"/><stop offset=".8" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#fff" stop-opacity=".16"/></linearGradient>
  <path d="M${cx - r} ${y}C${cx - r} ${y - r * 1.15} ${cx + r} ${y - r * 1.15} ${cx + r} ${y}A${r} ${r * 0.3} 0 0 1 ${cx - r} ${y}Z" fill="url(#${g})" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/>
  <ellipse cx="${cx}" cy="${y}" rx="${r}" ry="${f(r * 0.3)}" fill="none" stroke="url(#chrome)" stroke-width="3"/>
  <path d="M${f(cx - r * 0.7)} ${f(y - r * 0.35)}C${f(cx - r * 0.66)} ${f(y - r * 0.68)} ${f(cx - r * 0.4)} ${f(y - r * 0.82)} ${f(cx - r * 0.12)} ${f(y - r * 0.86)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="${cx}" cy="${f(y - r * 0.86)}" rx="${f(r * 0.1)}" ry="${f(r * 0.04)}" fill="url(#chrome)"/>
  <rect x="${f(cx - r * 0.04)}" y="${f(y - r * 0.98)}" width="${f(r * 0.08)}" height="${f(r * 0.12)}" fill="url(#chrome)"/>
  <circle cx="${cx}" cy="${f(y - r * 1.0)}" r="${f(r * 0.07)}" fill="url(#chrome)"/>`;
}

// ---------- hwatu ----------

function hw(x, y, cardId, { rot = 0, scale = 1, tilt = 0.9 } = {}) {
  if (cardId === 'back') return `<g transform="translate(${f(x)} ${f(y)}) scale(1 ${tilt}) rotate(${rot}) scale(${scale}) translate(-30 -46)" filter="url(#sh)"><rect width="60" height="92.4" rx="4" fill="#a3162a"/><rect x="5" y="5" width="50" height="82.4" rx="2" fill="none" stroke="#fff" stroke-opacity=".25"/><circle cx="30" cy="46" r="9" fill="none" stroke="#fff" stroke-opacity=".3"/><rect width="60" height="92.4" rx="4" fill="none" stroke="#000" stroke-opacity=".35"/></g>`;
  const inner = hwatuSvg(cardId).replace(/class="[^"]*"/g, '').replace('<svg', '<svg x="3" y="3" width="54" height="86.4"');
  return `<g transform="translate(${f(x)} ${f(y)}) scale(1 ${tilt}) rotate(${rot}) scale(${scale}) translate(-30 -46)" filter="url(#sh)">
    <rect width="60" height="92.4" rx="4" fill="#a3162a"/><rect x="2.4" y="2.4" width="55.2" height="87.6" rx="2" fill="#1a0d0d"/>${inner}
    <rect width="60" height="92.4" rx="4" fill="none" stroke="#000" stroke-opacity=".35"/></g>`;
}

// ---------- props ----------

function glass(cx, cy, s, kind) {
  const st = `fill="none" stroke="#f4efe4" stroke-opacity=".75" stroke-width="${f(1.6 / s)}" stroke-linejoin="round" stroke-linecap="round"`;
  const shine = `stroke="#fff" stroke-opacity=".9" stroke-width="${f(2.2 / s)}" stroke-linecap="round" fill="none"`;
  const shape = {
    martini: `<path d="M-30 -60L30 -60L0 -22Z" fill="#cfe3ea" fill-opacity=".1"/><path d="M-22 -50L22 -50L0 -22Z" fill="#e8f1e0" fill-opacity=".18"/><path d="M-30 -60L30 -60L0 -22ZM0 -22V20M-18 22A18 4 0 0 0 18 22A18 4 0 0 0 -18 22" ${st}/><circle cx="8" cy="-44" r="5" fill="#6d8a3a"/><path d="M-12 -70L14 -36" stroke="#d9d4c7" stroke-width="1.4"/><path d="M-25 -58L-6 -34" ${shine} opacity=".4"/>`,
    coupe: `<path d="M-34 -48C-34 -26 34 -26 34 -48Z" fill="#e8d7a6" fill-opacity=".35"/><path d="M-34 -50A34 6 0 0 0 34 -50A34 6 0 0 0 -34 -50M-34 -50C-34 -24 -10 -22 0 -22C10 -22 34 -24 34 -50M0 -22V20M-18 22A18 4 0 0 0 18 22A18 4 0 0 0 -18 22" ${st}/>${[[-12, -36], [4, -40], [14, -33], [-2, -30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="#fff" opacity=".7"/>`).join('')}<path d="M-28 -44C-26 -34 -18 -30 -10 -28" ${shine} opacity=".4"/>`,
    tumbler: `<path d="M-26 -8L-23 30H23L26 -8Z" fill="#b36a22" fill-opacity=".55"/><path d="M-30 -50L-24 32H24L30 -50" ${st}/><path d="M-24 32A24 5 0 0 0 24 32" ${st}/><path d="M-30 -50A30 6 0 0 0 30 -50A30 6 0 0 0 -30 -50" ${st}/><path d="M-26 -8A26 5 0 0 0 26 -8" stroke="#e8b06a" stroke-opacity=".7" fill="none"/><rect x="-14" y="-24" width="22" height="20" rx="3" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-opacity=".35" transform="rotate(14)"/><path d="M-24 -40L-19 24" ${shine} opacity=".35"/>`
  }[kind];
  return `<g transform="translate(${cx} ${cy}) scale(${s})"><ellipse cx="0" cy="24" rx="${kind === 'tumbler' ? 30 : 22}" ry="6" fill="#000" opacity=".5" filter="url(#blur3)"/>${shape}</g>`;
}

function dealerButton(cx, cy, r) {
  return `<ellipse cx="${cx}" cy="${cy + r * 0.3}" rx="${r * 1.05}" ry="${r * 0.42}" fill="#000" opacity=".5" filter="url(#blur3)"/>
  <path d="M${cx - r} ${cy}V${cy + r * 0.18}A${r} ${r * 0.42} 0 0 0 ${cx + r} ${cy + r * 0.18}V${cy}Z" fill="#bdb6a8"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.42}" fill="#f6f2e8"/>
  <text x="${cx}" y="${cy + r * 0.14}" font-family="${SANS}" font-size="${r * 0.42}" font-weight="800" fill="#141416" text-anchor="middle" transform="translate(0 ${cy}) scale(1 .6) translate(0 ${-cy})" letter-spacing="1">DEALER</text>`;
}

// Fan of cards around a pivot below them.
function fan(cx, cy, faces, { spread = 14, radius = 120, scale = 1, tilt = 0.92 } = {}) {
  const n = faces.length;
  return faces.map((c, i) => {
    const a = (i - (n - 1) / 2) * spread;
    const r = (a * Math.PI) / 180;
    return card(cx + radius * Math.sin(r) * scale, cy - radius * Math.cos(r) * scale + radius * scale, c, { rot: a, scale, tilt });
  }).join('');
}

function hwFan(cx, cy, ids, { spread = 13, radius = 130, scale = 1 } = {}) {
  const n = ids.length;
  return ids.map((c, i) => {
    const a = (i - (n - 1) / 2) * spread;
    const r = (a * Math.PI) / 180;
    return hw(cx + radius * Math.sin(r) * scale, cy - radius * Math.cos(r) * scale + radius * scale, c, { rot: a, scale });
  }).join('');
}

function cone(cx, top, w, color = '#fff2d6', op = 0.16) {
  const g = id('cone');
  return `<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>
  <path d="M${cx - 16} ${top}L${cx - w} ${H}H${cx + w}L${cx + 16} ${top}Z" fill="url(#${g})" filter="url(#soft)"/>`;
}

function lamp(cx, y) {
  return `<path d="M${cx} 0V${y - 20}" stroke="#2a2a2c" stroke-width="2"/>
  <path d="M${cx - 46} ${y}L${cx - 18} ${y - 22}H${cx + 18}L${cx + 46} ${y}Z" fill="#1c3024"/><path d="M${cx - 46} ${y}L${cx - 18} ${y - 22}H${cx + 18}L${cx + 46} ${y}Z" fill="none" stroke="#fff" stroke-opacity=".18"/>
  <ellipse cx="${cx}" cy="${y}" rx="46" ry="5" fill="#fff6dc" opacity=".9"/><ellipse cx="${cx}" cy="${y + 2}" rx="30" ry="9" fill="#fff6dc" opacity=".35" filter="url(#blur3)"/>`;
}

function smoke(x, y, s = 1) {
  return `<g filter="url(#soft)" opacity=".22" transform="translate(${x} ${y}) scale(${s})"><path d="M0 0C-20 -30 30 -50 0 -90C-30 -130 30 -150 10 -190" stroke="#e8e4dc" stroke-width="14" fill="none" stroke-linecap="round"/></g>`;
}

// ---------- horses ----------

const HORSE = {
  body: 'M14 17C16 12 24 11 32 12C37 12 41 11 44 13L49 7C50 5 52 4 54 5L60 9C61.4 10 61 12.4 59 12.6L55 12.2C53 13.4 51 15.4 49.6 18.4C48.4 21 46 23.2 43 24C38 25.8 26 26 20 25C16 24.2 13.2 21 14 17Z',
  ear: 'M52 5.2L53.2 1.6L55 4.8Z',
  tail: 'M15 15C10 13.6 6 16.6 3.6 23.4C7 21 10 20.4 14.4 19.6Z',
  mane: 'M44 13L49 7C50 5.6 51.4 4.8 52.6 5L47.4 11.4L45 14.4Z',
  legs: ['M44 23L50 29.5L55.5 32.5M41.5 24L45 31L47.5 37M19 23L13 29.5L7.5 32.5M22 24L19 31L18 37', 'M44 23L47 30L46 37.5M41.5 24L40 31L42 37.5M19 23L17 30L21 37M22 24L25 31L28 36'],
  torso: 'M31.5 10.6C32.6 6.4 37.6 3.8 42 5.8L43.2 8C40 9.2 36 10.2 33 11.4Z',
  arm: 'M40.5 7L47.5 9.6',
  boot: 'M35 10.4L38.4 14.6L41.6 14.2'
};

function horse(x, y, s, { coat = '#3b2418', silk = '#a3172a', cap = '#f4efe4', stride = 0, num = 1 } = {}) {
  const g = id('coat');
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <ellipse cx="32" cy="38.5" rx="24" ry="2.2" fill="#000" opacity=".5" filter="url(#blur3)"/>
    <path d="${HORSE.legs[stride]}" stroke="${coat}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="${HORSE.tail}" fill="#140b07"/><path d="${HORSE.body}" fill="${coat}"/><path d="${HORSE.body}" fill="url(#${g})"/>
    <path d="${HORSE.mane}" fill="#140b07"/><path d="${HORSE.ear}" fill="${coat}"/>
    <rect x="23" y="15" width="11" height="8" rx="1" fill="#f4efe4"/><text x="28.5" y="21.6" font-family="${SANS}" font-size="6.5" font-weight="800" fill="#141416" text-anchor="middle">${num}</text>
    <path d="${HORSE.torso}" fill="${silk}"/><path d="${HORSE.arm}" stroke="${silk}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="${HORSE.boot}" stroke="#f4efe4" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="43.6" cy="4.4" r="2.5" fill="${cap}"/><path d="M41.6 3.4A2.5 2.5 0 0 1 46 3.6" stroke="#000" stroke-opacity=".3" stroke-width=".6" fill="none"/>
    <path d="M47.5 9.6L56 11" stroke="#d9cfbd" stroke-width=".5"/>
  </g>`;
}

// ---------- the pictures ----------

const ART = {};

ART.blackjack = () => svg('green', `${bokeh(1)}${table()}
  ${feltArc('BLACKJACK PAYS 3 TO 2', { cy: 366, r: 260, size: 13 })}
  ${feltArc('DEALER MUST DRAW TO 16 AND STAND ON ALL 17S', { cy: 420, r: 300, size: 8.5, op: 0.3, spacing: 2 })}
  <ellipse cx="240" cy="300" rx="62" ry="26" fill="none" stroke="#f4efe4" stroke-opacity=".35" stroke-width="2"/>
  ${chip(240, 302, 30, 'black', 5)}
  ${chip(300, 318, 24, 'teal', 2)}
  ${card(212, 232, 'As', { rot: -9, scale: 1.2 })}${card(266, 230, 'Kh', { rot: 7, scale: 1.2 })}
  ${chip(108, 300, 22, 'purple', 7)}${chip(140, 316, 22, 'ivory', 4)}`, { label: '블랙잭' });

ART.roulette = () => svg('green', `${bokeh(2)}${table({ top: 70 })}
  ${wheel(240, 210, 170, { ball: 17, tilt: 0.46, spin: 0.25 })}
  ${chip(72, 320, 22, 'wine', 6)}${chip(410, 318, 24, 'gold', 4)}`, { label: '룰렛' });

ART.baccarat = () => svg('blue', `${bokeh(3, '#d6e4ff')}${table()}
  ${feltArc('PLAYER  ·  BANKER', { cy: 352, r: 240, size: 13, spacing: 5 })}
  ${card(160, 220, '9h', { rot: -6, scale: 1.1 })}${card(212, 224, 'Ks', { rot: 4, scale: 1.1 })}
  ${card(292, 232, '8d', { rot: -3, scale: 1.1 })}${card(342, 226, 'Qc', { rot: 8, scale: 1.1 })}
  ${plaque(112, 316, 92, 'ivory', { n: 3, label: '1억' })}${plaque(240, 322, 92, 'ivory', { n: 5, label: '10억', rot: -4 })}${chip(370, 316, 26, 'black', 6)}`, { label: '바카라' });

ART.dice = () => svg('red', `${bokeh(4, '#ffd9cf')}${table()}
  ${die(196, 268, 46, [4, 2, 1])}${die(268, 256, 46, [6, 3, 5], { turn: 12 })}${die(236, 314, 46, [5, 1, 3], { turn: -10 })}
  ${dome(240, 300, 150)}
  ${chip(64, 318, 22, 'gold', 5)}${chip(420, 320, 22, 'black', 7)}`, { label: '다이사이' });

ART.poker = () => svg('poker', `${bokeh(5)}${table()}
  ${['10h', 'Jh', 'Qh', 'Kh', 'Ah'].map((c, i) => card(96 + i * 72, 220, c, { scale: 1.05, rot: (i - 2) * 1.2 })).join('')}
  ${card(196, 316, 'back', { rot: -12, scale: .95 })}${card(226, 318, 'back', { rot: 6, scale: .95 })}
  ${dealerButton(330, 318, 26)}${chip(406, 314, 24, 'purple', 8)}${chip(80, 318, 24, 'teal', 5)}`, { label: '텍사스 홀덤' });

ART.slots = () => {
  const reel = (x, sym) => `<g transform="translate(${x} 0)"><rect x="0" y="124" width="92" height="132" rx="6" fill="url(#reel)"/>
    <text x="46" y="148" font-family="${SANS}" font-size="30" font-weight="900" fill="#141416" fill-opacity=".25" text-anchor="middle">${sym[0]}</text>
    <text x="46" y="214" font-family="${SANS}" font-size="62" font-weight="900" fill="#c4122c" text-anchor="middle" font-style="italic">${sym[1]}</text>
    <text x="46" y="262" font-family="${SANS}" font-size="30" font-weight="900" fill="#141416" fill-opacity=".25" text-anchor="middle">${sym[2]}</text>
    <rect x="0" y="124" width="92" height="132" rx="6" fill="url(#reelShade)"/></g>`;
  return svg('ink', `<defs><linearGradient id="reel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d5cc"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d5cc"/></linearGradient>
    <linearGradient id="reelShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
    <linearGradient id="cab" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0c0c0d"/><stop offset=".5" stop-color="#232326"/><stop offset="1" stop-color="#0c0c0d"/></linearGradient></defs>
    ${bokeh(6, '#ffe2e2', 12)}
    <ellipse cx="240" cy="352" rx="210" ry="22" fill="#000" opacity=".7" filter="url(#soft)"/>
    <rect x="66" y="44" width="348" height="320" rx="26" fill="url(#cab)"/><rect x="66" y="44" width="348" height="320" rx="26" fill="none" stroke="url(#chrome)" stroke-width="3"/>
    <rect x="96" y="58" width="288" height="44" rx="10" fill="#0a0a0b" stroke="#fff" stroke-opacity=".12"/>
    <text x="240" y="89" font-family="${SANS}" font-size="22" font-weight="900" letter-spacing="9" fill="#f4efe4" text-anchor="middle">VEGAS</text>
    <path d="M241 69L243.4 75.4L250 75.6L244.8 79.6L246.6 86L241 82.2L235.4 86L237.2 79.6L232 75.6L238.6 75.4Z" fill="#ffd28a" opacity="0"/>
    <rect x="88" y="114" width="304" height="152" rx="12" fill="#050506" stroke="url(#chrome)" stroke-width="2.5"/>
    ${reel(96, ['BAR', '7', '♦'])}${reel(194, ['♣', '7', 'BAR'])}${reel(292, ['♥', '7', '♣'])}
    <path d="M90 190H390" stroke="#e01b39" stroke-width="2" opacity=".85"/><path d="M84 182L94 190L84 198Z" fill="#e01b39"/><path d="M396 182L386 190L396 198Z" fill="#e01b39"/>
    <rect x="102" y="282" width="276" height="34" rx="8" fill="#0a0a0b" stroke="#fff" stroke-opacity=".1"/>
    <text x="240" y="305" font-family="${SANS}" font-size="15" font-weight="800" letter-spacing="3" fill="#f4efe4" fill-opacity=".85" text-anchor="middle">JACKPOT  ×  500</text>
    <rect x="414" y="150" width="14" height="70" rx="4" fill="url(#chrome)"/><path d="M421 152L436 80" stroke="url(#chrome)" stroke-width="7" stroke-linecap="round"/><circle cx="437" cy="74" r="13" fill="#b3122b"/><circle cx="433" cy="70" r="4" fill="#fff" opacity=".5"/>`, { label: '슬롯' });
};

ART.horses = () => svg('turf', `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050812"/><stop offset="1" stop-color="#14203a"/></linearGradient>
  <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#173f2b"/><stop offset="1" stop-color="#06180e"/></linearGradient></defs>
  <rect width="480" height="190" fill="url(#sky)"/>
  ${[60, 200, 330, 450].map(x => `<g><rect x="${x - 2}" y="40" width="4" height="150" fill="#0b0d12"/><rect x="${x - 18}" y="30" width="36" height="12" rx="2" fill="#f8f4ea"/><ellipse cx="${x}" cy="40" rx="70" ry="40" fill="#fff6e0" opacity=".12" filter="url(#soft)"/></g>`).join('')}
  <path d="M0 160L480 150V200H0Z" fill="#0b0f16"/>
  ${Array.from({ length: 30 }, (_, i) => `<circle cx="${i * 17 + 4}" cy="${158 - i * 0.3}" r="3" fill="#f4efe4" opacity="${0.08 + (i % 3) * 0.04}"/>`).join('')}
  <rect y="186" width="480" height="174" fill="url(#turf)"/>
  ${Array.from({ length: 7 }, (_, i) => `<path d="M0 ${200 + i * 24}H480" stroke="#fff" stroke-opacity=".03" stroke-width="10"/>`).join('')}
  <path d="M0 196L480 186" stroke="#f4efe4" stroke-width="4"/>${Array.from({ length: 13 }, (_, i) => `<rect x="${i * 40}" y="${196 - i * 0.83}" width="3" height="18" fill="#f4efe4"/>`).join('')}
  <rect x="404" y="120" width="5" height="96" fill="#f4efe4"/><rect x="398" y="118" width="18" height="18" fill="#b3122b"/>
  ${horse(30, 166, 3.2, { coat: '#2a1a12', silk: '#2f6b6a', num: 3, stride: 1 })}
  ${horse(140, 200, 3.9, { coat: '#4a2c1a', silk: '#b3122b', cap: '#f4efe4', num: 7 })}
  ${horse(-30, 238, 3.5, { coat: '#18110d', silk: '#ece6d9', cap: '#4b3566', num: 1, stride: 1 })}`, { label: '경마' });

ART.matgo = () => svg('olive', `${bokeh(7)}${table()}
  ${hw(170, 236, '01-1', { rot: -10, scale: 1.25 })}${hw(250, 226, '08-1', { rot: 2, scale: 1.25 })}${hw(330, 236, '03-1', { rot: 12, scale: 1.25 })}
  ${hw(94, 312, '08-2', { rot: -20, scale: .85 })}${hw(394, 312, 'back', { rot: 18, scale: .85 })}`, { label: '맞고' });

ART.gostop = () => svg('olive', `${bokeh(8)}${table()}
  ${hwFan(240, 250, ['01-1', '03-1', '08-1', '11-1', '12-1'], { spread: 15, radius: 150, scale: 1.15 })}
  ${chip(72, 320, 22, 'ivory', 5)}${chip(410, 322, 22, 'wine', 6)}`, { label: '고스톱' });

ART.seotda = () => svg('ink', `${bokeh(9, '#ffe2c8')}${table()}
  ${hw(204, 232, '03-1', { rot: -9, scale: 1.4 })}${hw(286, 232, '08-1', { rot: 9, scale: 1.4 })}
  <text x="243" y="338" font-family="${SANS}" font-size="17" font-weight="800" letter-spacing="6" fill="#f4efe4" fill-opacity=".55" text-anchor="middle">38광땡</text>
  ${plaque(100, 316, 96, 'ivory', { n: 4, label: '1억' })}${plaque(386, 318, 96, 'black', { n: 3, label: '10억', rot: 5 })}`, { label: '섯다' });

// ---------- events ----------

ART.royale = () => svg('poker', `${bokeh(11, '#e9f0ff')}${table()}
  ${fan(250, 214, ['As', 'Ah', 'Ad', 'Ac'], { spread: 13, radius: 140, scale: 1.08 })}
  ${plaque(96, 326, 100, 'ivory', { n: 6, label: '1억' })}${plaque(388, 330, 100, 'ivory', { n: 4, label: '10억', rot: -6 })}
  ${glass(410, 214, 1.2, 'martini')}
  <g transform="translate(92 196) rotate(-12)" filter="url(#sh)"><path d="M0 0L-30 -16V16Z M0 0L30 -16V16Z" fill="#0d0d0f" stroke="#2c2c30"/><rect x="-6" y="-7" width="12" height="14" rx="3" fill="#18181b"/></g>`, { label: '카지노 로얄' });

ART.tazza = () => svg('olive', `${lamp(240, 70)}${cone(240, 72, 220, '#fff2cf', 0.22)}${table({ top: 150, pool: [240, 270, 220, 100] })}
  ${hwFan(240, 262, ['08-1', '11-1', '03-1', '01-1'], { spread: 14, radius: 140, scale: 1.05 })}
  ${hw(96, 322, '12-1', { rot: -24, scale: .8 })}
  ${chip(400, 324, 22, 'ivory', 4)}
  ${smoke(420, 230, .9)}${smoke(70, 240, .7)}`, { label: '타짜 나이트' });

ART.oceans = () => {
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = i * 6 * Math.PI / 180; const r0 = i % 5 ? 64 : 58; return `<path d="M${f(r0 * Math.cos(a))} ${f(r0 * Math.sin(a))}L${f(70 * Math.cos(a))} ${f(70 * Math.sin(a))}" stroke="#f4efe4" stroke-opacity=".7" stroke-width="${i % 5 ? 1 : 2}"/>`; }).join('');
  return svg('blue', `${bokeh(12, '#cfe0ff')}
  <g transform="translate(386 82)"><circle r="92" fill="#0d1119" stroke="url(#chrome)" stroke-width="6"/><circle r="78" fill="#121822"/>${ticks}<circle r="44" fill="url(#chrome)"/><circle r="30" fill="#1a1f29"/>${[0, 1, 2, 3, 4].map(k => `<rect x="-4" y="-56" width="8" height="24" rx="3" fill="url(#chrome)" transform="rotate(${k * 72 + 20})"/>`).join('')}<circle r="8" fill="url(#chrome)"/></g>
  ${table({ top: 150, pool: [210, 270, 220, 100] })}
  ${card(176, 254, 'Ad', { rot: -8, scale: 1.2 })}${card(232, 250, 'Js', { rot: 6, scale: 1.2 })}
  ${chip(330, 320, 26, 'black', 8)}${chip(392, 326, 26, 'purple', 5)}${chip(84, 324, 24, 'ivory', 6)}`, { label: 'Ocean’s Heist' });
};

ART.rounders = () => svg('poker', `${bokeh(13, '#ffe6c4')}${table()}
  ${card(196, 240, 'Ac', { rot: -10, scale: 1.3 })}${card(266, 236, 'As', { rot: 6, scale: 1.3 })}
  ${chip(96, 318, 26, 'black', 10)}${chip(150, 330, 26, 'teal', 7)}
  ${chip(352, 326, 26, 'purple', 9)}
  ${glass(420, 270, 1.05, 'tumbler')}
  ${feltArc('HEADS UP', { cy: 372, r: 260, size: 14, op: 0.45, spacing: 8 })}`, { label: 'Rounders' });

ART.montecarlo = () => svg('purple', `<g filter="url(#blur3)">${Array.from({ length: 26 }, (_, i) => { const x = 240 + Math.sin(i * 1.7) * 190, y = 20 + (i % 6) * 14 + Math.cos(i) * 6; return `<circle cx="${f(x)}" cy="${f(y)}" r="${2 + (i % 4)}" fill="#fff" opacity="${0.18 + (i % 3) * 0.1}"/>`; }).join('')}</g>
  ${Array.from({ length: 9 }, (_, i) => { const x = 120 + i * 30, y = 46 + Math.abs(i - 4) * 6; return `<path d="M${x} 0V${y}" stroke="#d9d4c7" stroke-opacity=".25"/><path d="M${x} ${y}l4 8l-4 8l-4 -8Z" fill="#fff" opacity=".7"/>`; }).join('')}
  ${table({ top: 112 })}
  ${feltArc('BANKER  9', { cy: 356, r: 240, size: 14, spacing: 6 })}
  ${card(182, 232, '9s', { rot: -7, scale: 1.15 })}${card(238, 228, 'Kd', { rot: 5, scale: 1.15 })}
  ${plaque(110, 320, 96, 'ivory', { n: 4, label: '1억' })}${plaque(250, 326, 96, 'black', { n: 3, label: '10억', rot: 4 })}
  ${glass(392, 260, 1.15, 'coupe')}`, { label: 'Monte Carlo Gala' });

ART.casablanca = () => svg('amber', `${bokeh(14, '#ffd9a0', 11)}${table({ top: 70 })}
  ${wheel(230, 210, 160, { ball: 22, tilt: 0.46, spin: -0.9 })}
  <g opacity=".42" filter="url(#soft)">${Array.from({ length: 7 }, (_, i) => `<path d="M480 0C${430 - i * 10} ${40 + i * 30} ${340 - i * 22} ${60 + i * 34} ${250 - i * 20} ${80 + i * 42}C${330 - i * 18} ${70 + i * 32} ${420 - i * 8} ${36 + i * 26} 480 0Z" fill="#000"/>`).join('')}</g>
  ${chip(72, 320, 22, 'wine', 6)}${chip(410, 322, 24, 'ivory', 5)}`, { label: 'Casablanca' });

ART.godofgamblers = () => svg('red', `${bokeh(15, '#ffd2c4')}${table()}
  ${die(190, 280, 48, [6, 3, 5], { turn: 6 })}${die(266, 268, 48, [6, 2, 4], { turn: -8 })}${die(232, 326, 48, [6, 5, 3])}
  ${dome(240, 300, 150, { lift: 120 })}
  ${plaque(84, 330, 92, 'ivory', { n: 5, label: '1억' })}${plaque(402, 330, 92, 'black', { n: 4, label: '10억', rot: -5 })}`, { label: '도신' });

ART.whale = () => {
  const tail = `<path d="M-3 26C-4 16 -5 8 -6 2C-16 0 -36 -6 -48 -21C-36 -25 -18 -23 -9 -16C-5 -13 -2 -10 0 -7C2 -10 5 -13 9 -16C18 -23 36 -25 48 -21C36 -6 16 0 6 2C5 8 4 16 3 26Z" fill="#3a332b" fill-opacity=".85"/><path d="M-3 26C-4 16 -5 8 -6 2" stroke="#efe9dd" stroke-opacity=".4" fill="none"/>`;
  return svg('ink', `${bokeh(16, '#e9e2d4', 12)}${table()}
  ${plaque(108, 300, 110, 'ivory', { n: 12 })}${plaque(372, 304, 110, 'ivory', { n: 10, rot: 3 })}
  ${plaque(250, 336, 112, 'black', { n: 4, label: '1천억' })}
  <g transform="translate(240 216)" filter="url(#sh)"><rect x="-86" y="-58" width="172" height="112" rx="10" fill="#efe9dd"/><rect x="-74" y="-46" width="148" height="88" rx="5" fill="none" stroke="#3a332b" stroke-opacity=".4" stroke-width="1.4"/>
    <g transform="translate(0 -6) scale(1.1)">${tail}</g>
    <text x="0" y="36" font-family="${SANS}" font-size="12" font-weight="800" letter-spacing="6" fill="#3a332b" text-anchor="middle">THE WHALE</text>
    <rect x="-86" y="-58" width="172" height="44" rx="10" fill="#fff" opacity=".25"/></g>`, { label: 'The Whale Room' });
};

const out = new URL('../public/art/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, draw] of Object.entries(ART)) writeFileSync(new URL(`${name}.svg`, out), draw());
console.log(`wrote ${Object.keys(ART).length} pictures to public/art/`);
