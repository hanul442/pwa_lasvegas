// Draws public/art/grain.png: the fine, even grain behind the app's matte finish (matte.css).
// It is faint on purpose (see STRENGTH) so it can sit straight in a background stack. A grey-plus-alpha tile of soft noise that repeats without seams. Run again only to change it:
//   node scripts/grain.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 128;
const STRENGTH = 0.08; // most a grain speck covers what is under it; the tile is used as it is
let seed = 20261101;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// white noise, then one light blur that wraps at the edges, so the grain is soft, not pixel-sharp
const raw = Float32Array.from({ length: N * N }, rand);
const at = (x, y) => raw[((y + N) % N) * N + ((x + N) % N)];
const soft = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  soft[y * N + x] = (at(x, y) * 4 + at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 8;
}
let lo = Infinity, hi = -Infinity;
for (const v of soft) { lo = Math.min(lo, v); hi = Math.max(hi, v); }

// rows: filter byte 0, then grey + alpha per pixel. Grey spreads dark to light; alpha is
// strongest at the extremes so mid-grey pixels barely tint what is under them.
const rows = Buffer.alloc(N * (1 + N * 2));
for (let y = 0; y < N; y++) {
  rows[y * (1 + N * 2)] = 0;
  for (let x = 0; x < N; x++) {
    const t = (soft[y * N + x] - lo) / (hi - lo);
    const o = y * (1 + N * 2) + 1 + x * 2;
    rows[o] = Math.round(t * 255);
    rows[o + 1] = Math.round(Math.min(1, Math.abs(t - 0.5) * 2.4) * 255 * STRENGTH);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 4; // 8-bit grey + alpha
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../public/art/grain.png', import.meta.url), png);
console.log(`grain.png ${png.length} bytes`);
