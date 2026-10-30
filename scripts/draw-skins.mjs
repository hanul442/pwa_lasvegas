// Draws the 꾸미기 art: one motif per floor (and per season set), used the same way on all four
// skins so a floor's set reads as one look.
//
//   node scripts/draw-skins.mjs
//
// Writes public/art/skins/*.svg (card backs, felt prints, nameplate marks) and public/skins.css.
// References (2026-10-30, 한서 "고급지게"): theory11 Monarchs-style engraved two-way backs in one
// metal ink; GPI/Paulson casino chips, told apart by edge inserts and the printed inlay ring;
// dye-sublimated casino felts with a tone-on-tone house print; engraved metal name plates.
// Colour stays on the felt and chips; line work is silver, pearl or champagne, never gold foil.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'public/art/skins');
fs.mkdirSync(OUT, { recursive: true });
const f = n => +n.toFixed(2);
const svg = (vb, body, size = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${size}>${body}</svg>`;

// ---------- emblems: drawn around 0,0 inside about ±9, `c` ink, `d` the dark of the lacquer ----------
const EMBLEMS = {
  star: c => `<path fill="${c}" d="M0-9C.9-2.2 2.2-.9 9 0 2.2.9.9 2.2 0 9-.9 2.2-2.2.9-9 0-2.2-.9-.9-2.2 0-9Z"/>`,
  spade: c => `<path fill="${c}" d="M0-8.6C2.4-5 7.2-2.6 7.2 1.2c0 2.6-2.2 4-4.2 4-1.3 0-2.3-.6-2.6-1.2.2 2 .9 3.4 2.2 4.6H-2.6C-1.3 7.4-.6 6-.4 4-.7 4.6-1.7 5.2-3 5.2c-2 0-4.2-1.4-4.2-4C-7.2-2.6-2.4-5 0-8.6Z"/>`,
  fan: (c, d) => `<path fill="${c}" d="M-9 4A9 9 0 0 1 9 4Z"/><g stroke="${d}" stroke-width=".7">${[-60, -30, 0, 30, 60].map(a => `<path d="M0 4L${f(Math.sin(a * Math.PI / 180) * 9)} ${f(4 - Math.cos(a * Math.PI / 180) * 9)}"/>`).join('')}</g><path fill="${d}" d="M-3 4A3 3 0 0 1 3 4Z"/><path fill="${c}" d="M-1.6 4A1.6 1.6 0 0 1 1.6 4Z"/><rect fill="${c}" x="-9" y="5" width="18" height="1.1"/>`,
  key: (c, d) => `<circle cx="0" cy="-3.6" r="4.6" fill="${c}"/><circle cx="0" cy="-3.6" r="2" fill="${d}"/><path fill="${c}" d="M-1 0h2v8.6H-1z M1 4.6h3v1.4H1z M1 7h2.2v1.4H1z"/>`,
  moon: c => `<path fill="${c}" d="M2.6-8.4A8.6 8.6 0 1 0 2.6 8.4 6.6 6.6 0 1 1 2.6-8.4Z"/><path fill="${c}" d="M6-5.6c.3 1.4.7 1.8 2.1 2.1-1.4.3-1.8.7-2.1 2.1-.3-1.4-.7-1.8-2.1-2.1 1.4-.3 1.8-.7 2.1-2.1Z"/>`,
  dial: (c, d) => `<circle r="8.6" fill="${c}"/><circle r="6.6" fill="${d}"/><g stroke="${c}" stroke-width=".7">${Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6; return `<path d="M${f(Math.sin(a) * 4.6)} ${f(-Math.cos(a) * 4.6)}L${f(Math.sin(a) * 6)} ${f(-Math.cos(a) * 6)}"/>`; }).join('')}</g><circle r="2.2" fill="${c}"/><path fill="${c}" d="M-1 -9.6h2l-1 2.4z"/>`,
  crown: (c, d) => `<path fill="${c}" d="M-7.5 3.2L-8.6-4.2-4.3-.4 0-6.4 4.3-.4 8.6-4.2 7.5 3.2Z"/><rect fill="${c}" x="-7.6" y="4.1" width="15.2" height="1.6" rx=".4"/><circle fill="${c}" cx="-8.6" cy="-4.9" r="1"/><circle fill="${c}" cx="0" cy="-7.2" r="1.1"/><circle fill="${c}" cx="8.6" cy="-4.9" r="1"/>${d ? `<circle cx="0" cy="1.4" r=".9" fill="${d}"/>` : ''}`,
  laurel: c => {
    // An open wreath: two stems rising from the bottom, leaves angled outward, open at the top.
    const leaves = [];
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      const phi = (24 + i * 27) * Math.PI / 180, x = side * Math.sin(phi) * 6.4, y = Math.cos(phi) * 6.4 + .4;
      const rot = side * (24 + i * 27) + side * 38;
      leaves.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx=".95" ry="2.3" transform="rotate(${f(-rot + 90 * 0)} ${f(x)} ${f(y)}) translate(0 -1.2)" fill="${c}"/>`);
    }
    return `<path d="M-1 7.2A6.4 6.4 0 0 1-5.6-3.4M1 7.2A6.4 6.4 0 0 0 5.6-3.4" stroke="${c}" stroke-width=".6" fill="none"/>${leaves.join('')}<circle cx="0" cy="7.4" r=".9" fill="${c}"/>`;
  },
  flame: (c, d) => `<path fill="${c}" d="M0-9C2.6-5.4 6.2-2.6 6.2 2.2 6.2 6 3.4 8.8 0 8.8S-6.2 6-6.2 2.2C-6.2-.8-4.6-2.8-3.4-4.2-3.2-1.8-2.2-.6-1-.2-1.6-3.4-.8-6.4 0-9Z"/><path fill="${d}" d="M0 1.2C1.4 2.8 2.6 3.8 2.6 5.4 2.6 6.8 1.4 7.6 0 7.6S-2.6 6.8-2.6 5.4C-2.6 3.8-1.4 2.8 0 1.2Z"/>`,
  snow: c => `<g stroke="${c}" stroke-width="1.1" stroke-linecap="round">${[0, 60, 120].map(a => `<g transform="rotate(${a})"><path d="M0-8.6V8.6M-2.4-6.6L0-4.4 2.4-6.6M-2.4 6.6L0 4.4 2.4 6.6"/></g>`).join('')}</g>`,
  star5: c => { const p = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 3.8 : 9, a = i * Math.PI / 5; return `${f(Math.sin(a) * r)} ${f(-Math.cos(a) * r + .6)}`; }); return `<path fill="${c}" d="M${p.join('L')}Z"/>`; },
  rose: (c, d) => `${[0, 72, 144, 216, 288].map(a => `<circle cx="${f(Math.sin(a * Math.PI / 180) * 4.4)}" cy="${f(-Math.cos(a * Math.PI / 180) * 4.4)}" r="4" fill="${c}"/>`).join('')}<circle r="3.4" fill="${d}"/><circle r="2" fill="${c}"/>`,
  leaf: (c, d) => `<path fill="${c}" d="M0-9C5.4-5 6-1 0 9-6-1-5.4-5 0-9Z"/><path stroke="${d}" stroke-width=".7" fill="none" d="M0-6V7M0-2l2.6-2M0 1.4l3-2.2M0-2l-2.6-2M0 1.4l-3-2.2"/>`,
  lilac: (c, d) => `${[45, 135, 225, 315].map(a => `<ellipse cx="${f(Math.sin(a * Math.PI / 180) * 4.2)}" cy="${f(-Math.cos(a * Math.PI / 180) * 4.2)}" rx="3.6" ry="3.6" fill="${c}"/>`).join('')}<circle r="2.6" fill="${d}"/><circle r="1.2" fill="${c}"/>`,
  grid: (c, d) => `<rect x="-8" y="-8" width="16" height="16" fill="none" stroke="${c}" stroke-width="1.2" transform="rotate(45)"/><rect x="-4.4" y="-4.4" width="8.8" height="8.8" fill="${c}" transform="rotate(45)"/>`
};

// ---------- card-back fields: the engraved pattern filling the panel (82x122 at 9,9) ----------
const FIELDS = {
  lattice: () => { const d = []; for (let k = -140; k <= 150; k += 3.2) d.push(`M${f(k)} 0l140 140M${f(k + 140)} 0l-140 140`); return `<path d="${d.join('')}" stroke-width=".25" stroke-opacity=".24"/>`; },
  argyle: () => { const d = [], e = []; for (let k = -140; k <= 150; k += 10) d.push(`M${f(k)} 0l140 140M${f(k + 140)} 0l-140 140`); for (let k = -135; k <= 155; k += 10) e.push(`M${f(k)} 0l140 140M${f(k + 140)} 0l-140 140`); return `<path d="${d.join('')}" stroke-width=".35" stroke-opacity=".4"/><path d="${e.join('')}" stroke-width=".2" stroke-opacity=".22" stroke-dasharray="1 1.2"/>`; },
  scallop: () => { const d = []; for (let y = 4; y < 140; y += 5) for (let x = (y / 5) % 2 ? 0 : 5; x < 110; x += 10) d.push(`M${x - 5} ${y}a5 5 0 0 1 10 0`); return `<path d="${d.join('')}" stroke-width=".3" stroke-opacity=".38"/>`; },
  herring: () => { const d = []; for (let x = 0; x < 110; x += 6) { let s = `M${x} 0`; for (let y = 0; y < 145; y += 4) s += `L${x + ((y / 4) % 2 ? 3 : 0)} ${y + 4}`; d.push(s); } return `<path d="${d.join('')}" stroke-width=".3" stroke-opacity=".34"/>`; },
  sky: () => {
    let s = ''; let seed = 7; const r = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 46; i++) s += `<circle cx="${f(10 + r() * 80)}" cy="${f(10 + r() * 80)}" r="${f(.2 + r() * .45)}" fill="currentColor" fill-opacity="${f(.35 + r() * .5)}" stroke="none"/>`;
    const b = [[9, 112, 8, 20], [17, 100, 6, 32], [23, 108, 9, 24], [32, 92, 5, 40], [37, 104, 8, 28], [45, 86, 6, 46], [51, 98, 10, 34], [61, 106, 7, 26], [68, 94, 6, 38], [74, 102, 9, 30], [83, 110, 8, 22]];
    s += b.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="currentColor" fill-opacity=".14" stroke-width=".3" stroke-opacity=".5"/>`).join('');
    s += b.map(([x, y, w]) => Array.from({ length: 5 }, (_, i) => `<path d="M${x + 1.5} ${y + 3 + i * 4}h${w - 3}" stroke-width=".35" stroke-opacity=".28" stroke-dasharray=".8 1"/>`).join('')).join('');
    return s;
  },
  rays: () => { const d = []; for (let i = 0; i < 120; i++) { const a = i * Math.PI / 60; d.push(`M50 70L${f(50 + Math.sin(a) * 120)} ${f(70 - Math.cos(a) * 120)}`); } return `<path d="${d.join('')}" stroke-width=".22" stroke-opacity=".26"/>${[24, 30, 36, 46].map(r => `<circle cx="50" cy="70" r="${r}" stroke-width=".3" stroke-opacity=".35"/>`).join('')}`; },
  flutes: () => { const d = []; for (let x = 12; x < 90; x += 4) d.push(`M${x} 30V110`); const key = []; for (let x = 12; x < 88; x += 8) { key.push(`M${x} 19h6v-5h-4v3h-2`); key.push(`M${x} 121h6v5h-4v-3h-2`); } return `<path d="${d.join('')}" stroke-width=".35" stroke-opacity=".3"/><path d="${key.join('')}" stroke-width=".5" stroke-opacity=".6"/><path d="M11 23H89M11 117H89" stroke-width=".4" stroke-opacity=".55"/>`; },
  waves: () => { const d = []; for (let y = -4; y < 150; y += 3.4) { let s = `M0 ${y}`; for (let x = 0; x < 110; x += 10) s += `q5 -3 10 0`; d.push(s); } return `<path d="${d.join('')}" stroke-width=".28" stroke-opacity=".34"/>`; },
  hex: () => { const d = []; const h = 6, w = h * Math.sqrt(3); for (let row = 0; row < 18; row++) for (let col = 0; col < 10; col++) { const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * h * 1.5; d.push(`M${f(cx)} ${f(cy - h)}l${f(w / 2)} ${f(h / 2)}v${h}l${f(-w / 2)} ${f(h / 2)}l${f(-w / 2)} ${f(-h / 2)}v${-h}z`); } return `<path d="${d.join('')}" stroke-width=".28" stroke-opacity=".3"/>`; },
  dots: () => { let s = ''; for (let y = 6; y < 140; y += 5) for (let x = (y / 5) % 2 ? 4 : 6.5; x < 100; x += 5) s += `M${x} ${y}h.01`; return `<path d="${s}" stroke-width="1" stroke-linecap="round" stroke-opacity=".3"/>`; },
  grid: () => { const d = []; for (let k = 0; k < 140; k += 4) d.push(`M0 ${k}H100M${k} 0V140`); return `<path d="${d.join('')}" stroke-width=".25" stroke-opacity=".3"/>`; }
};

// A two-way back, 100x140: white card edge, lacquer panel, the floor's field, a guilloché rosette
// round a medallion, the emblem in it and twice more, head to tail.
function cardBack({ base, line, field, emblem, rosette = true }) {
  const [hi, lo] = base, cx = 50, cy = 70, E = EMBLEMS[emblem];
  const ros = rosette ? `<g stroke-width=".3" stroke-opacity=".62">${Array.from({ length: 48 }, (_, i) => `<ellipse cx="${cx}" cy="${cy}" rx="30" ry="10" transform="rotate(${f(i * 3.75)} ${cx} ${cy})"/>`).join('')}</g><g stroke-width=".28" stroke-opacity=".7">${Array.from({ length: 36 }, (_, i) => `<ellipse cx="${cx}" cy="${cy}" rx="18" ry="6" transform="rotate(${i * 5} ${cx} ${cy})"/>`).join('')}</g>` : '';
  const corners = [[7, 7], [93, 7], [7, 133], [93, 133]].map(([x, y]) => `<path d="M${x} ${y - 2.6}L${x + 2.6} ${y}L${x} ${y + 2.6}L${x - 2.6} ${y}Z" fill="${lo}" stroke="${line}" stroke-width=".5"/>`).join('');
  return svg('0 0 100 140', `<defs><linearGradient id="g" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient><radialGradient id="v" cx=".5" cy=".5" r=".72"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient><clipPath id="p"><rect x="8.5" y="8.5" width="83" height="123" rx="3"/></clipPath></defs>`
    + `<rect width="100" height="140" rx="7" fill="#f4f1ea"/><rect x="5" y="5" width="90" height="130" rx="4.5" fill="url(#g)"/>`
    + `<g clip-path="url(#p)" fill="none" stroke="${line}" color="${line}">${FIELDS[field]()}${rosette ? `<circle cx="${cx}" cy="${cy}" r="31" fill="${lo}" fill-opacity=".55" stroke="none"/>` : ''}${ros}</g>`
    + `<rect x="5" y="5" width="90" height="130" rx="4.5" fill="url(#v)"/>`
    + `<rect x="7" y="7" width="86" height="126" rx="3.6" fill="none" stroke="${line}" stroke-width=".7"/><rect x="8.5" y="8.5" width="83" height="123" rx="3" fill="none" stroke="${line}" stroke-width=".3" stroke-opacity=".55"/>${corners}`
    + `<circle cx="${cx}" cy="${cy}" r="12.5" fill="${lo}" stroke="${line}" stroke-width=".7"/><circle cx="${cx}" cy="${cy}" r="10.8" fill="none" stroke="${line}" stroke-width=".3" stroke-opacity=".6"/>`
    + `<g transform="translate(${cx} ${cy})">${E(line, lo)}</g>`
    + (field === 'sky' || field === 'flutes' ? '' : `<g transform="translate(${cx} 21) scale(.55)">${E(line, lo)}</g><g transform="translate(${cx} 119) scale(.55) rotate(180)">${E(line, lo)}</g>`));
}

// ---------- felt prints: a tile repeated over the cloth, white at a few percent ----------
// Prints sit under the table's own printed layout, so they stay at about 60% of what reads in a swatch.
const ink = (o) => `#ffffff${Math.round(o * 255 * .6).toString(16).padStart(2, '0')}`;
const TILES = {
  argyle: () => [56, `<path d="M0 28L28 0 56 28 28 56Z" fill="none" stroke="${ink(.07)}" stroke-width=".9"/><path d="M0 0L56 56M56 0L0 56" stroke="${ink(.04)}" stroke-width=".6" stroke-dasharray="2 3"/><g transform="translate(28 28) scale(.32)">${EMBLEMS.spade(ink(.09))}</g>`],
  scallop: () => [40, `<g fill="none" stroke="${ink(.075)}" stroke-width=".9"><path d="M0 20a20 20 0 0 1 40 0M-20 40a20 20 0 0 1 40 0M20 40a20 20 0 0 1 40 0M0 20a12 12 0 0 1 40 0" /><path d="M8 20a12 12 0 0 1 24 0M-12 40a12 12 0 0 1 24 0M28 40a12 12 0 0 1 24 0" stroke="${ink(.045)}"/></g>`],
  herring: () => [24, `<path d="M0 0l12 12M12 12l12-12M0 12l12 12M12 24l12-12" stroke="${ink(.06)}" stroke-width="1.6" fill="none"/>`],
  sky: () => [96, [[12, 18, .9], [50, 8, .6], [80, 40, 1], [30, 60, .7], [66, 78, .8], [8, 86, .5], [88, 90, .6], [44, 36, .45]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s * .28})">${EMBLEMS.star(ink(.14))}</g>`).join('')],
  rays: () => [48, `<g fill="none" stroke="${ink(.06)}" stroke-width=".8"><circle cx="0" cy="0" r="24"/><circle cx="48" cy="0" r="24"/><circle cx="0" cy="48" r="24"/><circle cx="48" cy="48" r="24"/><circle cx="24" cy="24" r="24"/><circle cx="24" cy="24" r="12" stroke="${ink(.04)}"/></g>`],
  crowns: () => [84, `<path d="M0 42L42 0 84 42 42 84Z" fill="none" stroke="${ink(.075)}" stroke-width=".8"/>${[[42, 43], [0, 1], [84, 1], [0, 85], [84, 85]].map(([x, y]) => `<g transform="translate(${x} ${y}) scale(.62)">${EMBLEMS.crown(ink(.1))}</g>`).join('')}`],
  flutes: () => [48, `<g fill="none" stroke="${ink(.08)}" stroke-width="1"><path d="M0 4H48M0 20H48"/><path d="${[0, 12, 24, 36].map(x => `M${x + 2} 20V7H${x + 10}V17H${x + 5}V11H${x + 7}`).join('')}"/></g>`],
  emblem: (e) => [64, `<path d="M0 32L32 0 64 32 32 64Z" fill="none" stroke="${ink(.065)}" stroke-width=".8"/>${[[32, 32], [0, 0], [64, 0], [0, 64], [64, 64]].map(([x, y]) => `<g transform="translate(${x} ${y}) scale(.5)">${EMBLEMS[e](ink(.09), 'transparent')}</g>`).join('')}`]
};

// ---------- the sets ----------
// back: [lacquer top, lacquer bottom], line: the metal ink; felt: [a, b, c]; chip: edge style +
// ring style + inlay colour; plate: nameplate face and bevel.
const SILVER = '#dfe3e8', PEARL = '#efe8dc', CHAMPAGNE = '#e8dcc2', MARBLE = '#f4f1ea', STEEL = '#c9ced6';
export const THEMES = [
  { key: 'grid', back: { id: 'grid', base: ['#22262c', '#0a0b0d'], line: SILVER, field: 'grid', emblem: 'grid' } },
  { key: 'ivory', back: { id: 'ivory', base: ['#f7f3ea', '#e3ddd0'], line: '#1a1c20', field: 'lattice', emblem: 'star' } },
  { key: 'club', floor: 'high-limit', line: SILVER, tile: 'argyle', emblem: 'spade', back: { id: 'oxblood', base: ['#5a1822', '#1c0609'], field: 'argyle' }, felt: { id: 'forest', a: '#1e6347', b: '#0f3b2b', c: '#041710' }, chips: { id: 'onyx', edge: 'quad', ring: 'dash', inlay: '#0a0b0dd9' }, plate: { id: 'silver', face: ['#262a30', '#101216'] } },
  { key: 'salon', floor: 'salon-prive', line: PEARL, tile: 'scallop', emblem: 'fan', back: { id: 'navy', base: ['#1c3460', '#050c1a'], field: 'scallop' }, felt: { id: 'navy', a: '#1f3a63', b: '#10213f', c: '#050b18' }, chips: { id: 'double', edge: 'triple', ring: 'bead', inlay: PEARL }, plate: { id: 'pearl', face: ['#1e2a40', '#0b111c'] } },
  { key: 'penthouse', floor: 'penthouse', line: '#dccfb5', tile: 'herring', emblem: 'key', back: { id: 'pinstripe', base: ['#34302c', '#12100e'], field: 'herring' }, felt: { id: 'oxblood', a: '#62202a', b: '#3b0e16', c: '#160407' }, chips: { id: 'marble', edge: 'wide', ring: 'line', inlay: '#dccfb5' }, plate: { id: 'onyx', face: ['#2a2724', '#0e0d0c'] } },
  { key: 'sky', floor: 'sky-lounge', line: '#d6deef', tile: 'sky', emblem: 'moon', back: { id: 'skyline', base: ['#1d2a52', '#070a16'], field: 'sky' }, felt: { id: 'teal', a: '#1c6668', b: '#0d3d40', c: '#031618' }, chips: { id: 'platinum', edge: 'dash12', ring: 'dash', inlay: '#e9eef3' }, plate: { id: 'platinum', face: ['#1c2436', '#090c14'] } },
  { key: 'vault', floor: 'vault', line: STEEL, tile: 'rays', emblem: 'dial', back: { id: 'vault', base: ['#3a3e45', '#0b0c0e'], field: 'rays' }, felt: { id: 'obsidian', a: '#37323f', b: '#17141d', c: '#050407' }, chips: { id: 'diamond', edge: 'ticks', ring: 'tick', inlay: '#ffffff' }, plate: { id: 'diamond', face: ['#2c2f35', '#0b0c0e'] } },
  { key: 'crown', floor: 'crown', line: CHAMPAGNE, tile: 'crowns', emblem: 'crown', back: { id: 'crown', base: ['#2a1c36', '#0c0911'], field: 'lattice' }, felt: { id: 'royal', a: '#4a2c63', b: '#2a173c', c: '#0d0614' }, chips: { id: 'crown', edge: 'cane', ring: 'bead', inlay: CHAMPAGNE }, plate: { id: 'crown', face: ['#2c2034', '#140e19'] } },
  { key: 'olympus', floor: 'olympus', line: MARBLE, tile: 'flutes', emblem: 'laurel', back: { id: 'olympus', base: ['#26386a', '#0a0e1c'], field: 'flutes' }, felt: { id: 'ultramarine', a: '#24387e', b: '#13204d', c: '#050a1c' }, chips: { id: 'olympus', edge: 'key', ring: 'line', inlay: MARBLE }, plate: { id: 'olympus', face: ['#1f2b4c', '#0a0f1e'] } },
  // 시즌 한정 (lib/cosmetics.mjs SEASON_COSMETICS)
  { key: 'ember', line: '#f2a86e', tile: 'emblem', emblem: 'flame', back: { id: 'ember', base: ['#5a220b', '#160703'], field: 'waves' }, felt: { id: 'ember', a: '#8a3a12', b: '#55200a', c: '#1c0903' }, chips: { id: 'ember', edge: 'cane', ring: 'dash', inlay: '#f08a46' }, plate: { id: 'ember', face: ['#3a1a0c', '#140803'] } },
  { key: 'frost', line: '#d6eef8', tile: 'emblem', emblem: 'snow', back: { id: 'frost', base: ['#22536a', '#061520'], field: 'hex' }, felt: { id: 'frost', a: '#2f6278', b: '#183d4e', c: '#071a24' }, chips: { id: 'frost', edge: 'dash12', ring: 'tick', inlay: '#d6eef8' }, plate: { id: 'frost', face: ['#16323f', '#071219'] } },
  { key: 'crimson', line: '#ffc2c8', tile: 'emblem', emblem: 'star5', back: { id: 'crimson', base: ['#6e1222', '#1a0408'], field: 'argyle' }, felt: { id: 'crimson', a: '#82162a', b: '#4f0b18', c: '#1c0307' }, chips: { id: 'crimson', edge: 'quad', ring: 'bead', inlay: '#ff8a94' }, plate: { id: 'crimson', face: ['#3a0c15', '#150407'] } },
  { key: 'rose', line: '#f7c6d6', tile: 'emblem', emblem: 'rose', back: { id: 'rose', base: ['#6a2a45', '#1a0811'], field: 'dots' }, felt: { id: 'rose', a: '#7a3150', b: '#4a1b30', c: '#1a0811' }, chips: { id: 'rose', edge: 'triple', ring: 'bead', inlay: '#f4aac4' }, plate: { id: 'rose', face: ['#3a1626', '#16070d'] } },
  { key: 'sage', line: '#d4e6ca', tile: 'emblem', emblem: 'leaf', back: { id: 'sage', base: ['#43604a', '#0d150e'], field: 'herring' }, felt: { id: 'sage', a: '#557256', b: '#334a34', c: '#111b12' }, chips: { id: 'sage', edge: 'wide', ring: 'line', inlay: '#c3dcb8' }, plate: { id: 'sage', face: ['#22301f', '#0c120b'] } },
  { key: 'lilac', line: '#ddd0fa', tile: 'emblem', emblem: 'lilac', back: { id: 'lilac', base: ['#4b3a7a', '#100b1c'], field: 'scallop' }, felt: { id: 'lilac', a: '#544180', b: '#31254f', c: '#110c1d' }, chips: { id: 'lilac', edge: 'cane', ring: 'dash', inlay: '#d0bef6' }, plate: { id: 'lilac', face: ['#2a2142', '#0f0b19'] } }
];

// ---------- chips: edge inserts and the printed ring ----------
const EDGES = {
  spots: null, // the house look in table.css
  quad: 'repeating-conic-gradient(from -14deg,var(--chip-edge-ink) 0 28deg,var(--rim) 28deg 31deg,var(--chip-edge-ink) 31deg 34deg,var(--rim) 34deg 90deg)',
  triple: 'repeating-conic-gradient(from -8deg,var(--chip-edge-ink) 0 3.4deg,var(--rim) 3.4deg 6deg,var(--chip-edge-ink) 6deg 9.4deg,var(--rim) 9.4deg 12deg,var(--chip-edge-ink) 12deg 15.4deg,var(--rim) 15.4deg 60deg)',
  wide: 'repeating-conic-gradient(from -18deg,var(--chip-edge-ink) 0 36deg,var(--rim) 36deg 90deg)',
  dash12: 'repeating-conic-gradient(from -4deg,var(--chip-edge-ink) 0 8deg,var(--rim) 8deg 30deg)',
  ticks: 'repeating-conic-gradient(from -1deg,var(--chip-edge-ink) 0 2deg,var(--rim) 2deg 10deg)',
  cane: 'repeating-conic-gradient(from -6deg,var(--chip-edge-ink) 0 4.5deg,var(--rim) 4.5deg 7deg,var(--chip-edge-ink) 7deg 11.5deg,var(--rim) 11.5deg 45deg)',
  key: 'repeating-conic-gradient(from -10deg,var(--chip-edge-ink) 0 20deg,var(--rim) 20deg 24deg,var(--chip-edge-ink) 24deg 27deg,var(--rim) 27deg 60deg)'
};
const RINGS = {
  dash: 'repeating-conic-gradient(var(--chip-inlay) 0 2.2deg,transparent 2.2deg 7.5deg)',
  bead: 'repeating-conic-gradient(var(--chip-inlay) 0 3deg,transparent 3deg 10deg)',
  tick: 'repeating-conic-gradient(var(--chip-inlay) 0 1deg,transparent 1deg 5deg)',
  line: 'linear-gradient(var(--chip-inlay),var(--chip-inlay))'
};
const CHIP_BODY = `linear-gradient(155deg,#ffffff1f 0,transparent 34%,transparent 66%,#00000038 100%),
    radial-gradient(circle closest-side,transparent 0 76.5%,color-mix(in srgb,var(--rim) 45%,#000) 77.5% 79%,transparent 79.5%),
    radial-gradient(circle closest-side,var(--c) 0 70%,color-mix(in srgb,var(--c) 88%,#000) 77.5%,transparent 78%),
    radial-gradient(circle closest-side,transparent 0 93%,#00000052 100%)`;

// ---------- write ----------
const css = [`/* Generated by scripts/draw-skins.mjs: edit the script, not this file. */`];
const both = (sel) => `:root[data-chip-accent="${sel}"],.chip-accent--${sel}`;
const feltSel = id => `.table-screen:not(.is-event) .felt.felt--skin:not(.felt--royale):not(.felt--tazza).felt--skin-${id},.skin-preview.felt--skin-${id},.skin-stage.felt--skin-${id}`;
for (const t of THEMES) {
  const line = t.line || t.back.line;
  if (t.back) {
    fs.writeFileSync(path.join(OUT, `back-${t.back.id}.svg`), cardBack({ ...t.back, line, emblem: t.back.emblem || t.emblem }));
    css.push(`.card-back.back--${t.back.id}{background:url(art/skins/back-${t.back.id}.svg) center/100% 100% no-repeat,${t.back.base[1]};box-shadow:0 1px 0 #d9d0c0,0 1.6px 0 #b9ae9b,0 2.4px 1px #0007,0 5px 9px #0005}`);
    css.push(`.card-back.back--${t.back.id}::before,.card-back.back--${t.back.id}::after{display:none}`);
  }
  if (t.felt) {
    const [size, body] = TILES[t.tile](t.emblem);
    fs.writeFileSync(path.join(OUT, `felt-${t.felt.id}.svg`), svg(`0 0 ${size} ${size}`, body, ` width="${size}" height="${size}"`));
    css.push(`${feltSel(t.felt.id)}{--felt-a:${t.felt.a};--felt-b:${t.felt.b};--felt-c:${t.felt.c};--felt-print:url(art/skins/felt-${t.felt.id}.svg);--felt-print-size:${size}px;--felt-rail:linear-gradient(180deg,color-mix(in srgb,${t.felt.c} 60%,#3a3f46),color-mix(in srgb,${t.felt.c} 50%,#121316) 18%,#0a0b0c 70%,color-mix(in srgb,${t.felt.c} 50%,#1d2025));--felt-piping:color-mix(in srgb,${line} 42%,transparent)}`);
  }
  if (t.chips) {
    const c = t.chips;
    css.push(`${both(c.id)}{--chip-inlay:${c.inlay};--chip-inlay-w:1.6;--chip-halo:1;--chip-line:${line};--plaque-inlay:${c.inlay};--plaque-outline:color-mix(in srgb,${c.inlay} 70%,transparent)}`);
    if (EDGES[c.edge]) css.push(`:root[data-chip-accent="${c.id}"] .chip:not(.chip--plaque),.chip-accent--${c.id} .chip:not(.chip--plaque){--chip-edge-ink:color-mix(in srgb,var(--chip-line) 70%,var(--edge));background:${CHIP_BODY},\n    ${EDGES[c.edge]}}`);
    const mask = c.ring === 'line' ? 'radial-gradient(circle closest-side,transparent 0 64.5%,#000 65% 66.4%,transparent 67%)' : 'radial-gradient(circle closest-side,transparent 0 64%,#000 64.5% 67.5%,transparent 68%)';
    css.push(`:root[data-chip-accent="${c.id}"] .chip-ring,.chip-accent--${c.id} .chip-ring{background:${RINGS[c.ring]};opacity:.85;-webkit-mask:${mask};mask:${mask}}`);
    css.push(`:root[data-chip-accent="${c.id}"] .chip--plaque .chip-mark,.chip-accent--${c.id} .chip--plaque .chip-mark{opacity:.8}`);
  }
  if (t.plate) {
    const p = t.plate;
    fs.writeFileSync(path.join(OUT, `mark-${t.key}.svg`), svg('-10 -10 20 20', `<mask id="m"><rect x="-10" y="-10" width="20" height="20" fill="#000"/>${EMBLEMS[t.emblem]('#fff', '#000')}</mask><rect x="-10" y="-10" width="20" height="20" fill="#000" mask="url(#m)"/>`));
    css.push(`.name-frame--${p.id}{position:relative;padding:2px 11px 3px 26px;border:1px solid transparent;border-radius:6px;color:#f6f2ea;text-shadow:0 -1px 0 #000a;animation:none;
  background:linear-gradient(180deg,${p.face[0]},${p.face[1]}) padding-box,linear-gradient(160deg,#ffffff,${line} 22%,color-mix(in srgb,${line} 55%,#000) 48%,${line} 66%,color-mix(in srgb,${line} 45%,#000) 100%) border-box;
  box-shadow:inset 0 0 0 1px #0008,inset 0 0 0 2px color-mix(in srgb,${line} 24%,transparent),0 1px 0 #000,0 3px 8px #0008}`);
    css.push(`.name-frame--${p.id}::before{content:"";position:absolute;left:8px;top:50%;width:13px;height:13px;margin-top:-6.5px;border:0;clip-path:none;background:linear-gradient(180deg,#fff,${line});-webkit-mask:url(art/skins/mark-${t.key}.svg) center/contain no-repeat;mask:url(art/skins/mark-${t.key}.svg) center/contain no-repeat}`);
    css.push(`.name-frame--${p.id}::after{display:none}`);
  }
}
fs.writeFileSync(path.join(ROOT, 'public/skins.css'), css.join('\n') + '\n');
console.log(`draw-skins: ${fs.readdirSync(OUT).length} files in public/art/skins, public/skins.css`);
