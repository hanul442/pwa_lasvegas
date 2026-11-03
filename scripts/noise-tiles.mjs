// Draws the felt and card-paper grain as PNG tiles (public/art/felt-noise.png, card-noise.png).
// They used to be SVG feTurbulence filters inline in the CSS, which the browser runs again every
// time it paints a piece of felt or a card: on a big PC felt, or a card in flight, that was the
// slowest thing on the table. Chrome draws the same SVG once here at 2× and only its alpha is
// kept (the colour is one flat colour), so the look stays the same. Run again only to change it:
//   node scripts/noise-tiles.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { loadPlaywright } from './fold-check.mjs';

const svg = (size, freq, opacity) => `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'/></filter><rect width='${size}' height='${size}' filter='url(#n)' opacity='${opacity}'/></svg>`;
// name: [tile size in CSS px, baseFrequency, final opacity (old matrix alpha × rect opacity), colour]
const TILES = {
  'felt-noise.png': [160, '.95', 0.45 * 0.16, [0, 0, 0]],          // table.css .felt, shop felt swatches
  'card-noise.png': [96, '.9', 0.55 * 0.07, [26, 20, 13]]           // table.css .card-face
};

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
// RGBA, one flat colour; only alpha varies, so it packs small.
function png(n, alpha, [r, g, b]) {
  const rows = Buffer.alloc(n * (1 + n * 4));
  for (let y = 0; y < n; y++) {
    rows[y * (1 + n * 4)] = 0;
    for (let x = 0; x < n; x++) { const o = y * (1 + n * 4) + 1 + x * 4; rows[o] = r; rows[o + 1] = g; rows[o + 2] = b; rows[o + 3] = alpha[y * n + x]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, [size, freq, opacity, colour]] of Object.entries(TILES)) {
  const alpha = await page.evaluate(async ([src, n]) => {
    const img = new Image();
    img.src = `data:image/svg+xml,${encodeURIComponent(src)}`;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: n, height: n });
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    return Array.from({ length: n * n }, (_, i) => d[i * 4 + 3]);
  }, [svg(size, freq, opacity), size * 2]);
  const out = png(size * 2, alpha, colour);
  writeFileSync(new URL(`../public/art/${name}`, import.meta.url), out);
  console.log(`${name} ${out.length} bytes, alpha ${Math.min(...alpha)}–${Math.max(...alpha)}`);
}
await browser.close();
