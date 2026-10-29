import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

// Every syllable the app's own text uses, read the same way scripts/fonts/build.py reads it.
async function usedHangul() {
  const used = new Set();
  const walk = async dir => {
    for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) await walk(`${path}/`);
      else if (/\.(js|mjs|html|css|json|webmanifest|svg)$/.test(entry.name)) for (const c of await read(path)) if (c >= '가' && c <= '힣') used.add(c);
    }
  };
  for (const dir of ['public/', 'lib/', 'worker/']) await walk(dir);
  return used;
}

// The 2,350 everyday syllables (KS X 1001) the "-ext" files hold, in Unicode order.
function everyday() {
  const dec = new TextDecoder('euc-kr');
  const out = new Set();
  for (let b1 = 0xb0; b1 <= 0xc8; b1++) for (let b2 = 0xa1; b2 <= 0xfe; b2++) {
    const c = dec.decode(new Uint8Array([b1, b2]));
    if (c >= '가' && c <= '힣') out.add(c);
  }
  return out;
}

test('fonts come from this site, not Google, and the shell caches them', async () => {
  const [html, css, sw] = await Promise.all([read('public/index.html'), read('public/fonts.css'), read('public/sw.js')]);
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), 'index.html still loads Google Fonts');
  for (const w of [400, 500, 700]) {
    for (const file of [`fonts/noto-kr-${w}.woff2`, `fonts/noto-kr-${w}-ext.woff2`]) {
      assert.ok(css.includes(`url(${file})`), file);
      assert.ok((await stat(new URL(`public/${file}`, root))).size < 160_000, `${file} grew past 160 KB`);
    }
    assert.ok(sw.includes(`'fonts/noto-kr-${w}.woff2'`), `sw.js SHELL misses noto-kr-${w}`);
  }
  assert.ok(sw.includes("'fonts/archivo.woff2'") && sw.includes("'fonts.css'"));
  // Fonts wait for the page's load event: on a slow network they would otherwise slow the app's code down.
  assert.ok(/addEventListener\('load'[^<]*fonts\.css/.test(html), 'index.html adds fonts.css after load');
  assert.ok(!/rel="preload"[^>]*woff2/.test(html), 'no font preloads: they compete with app.js');
  // The ext faces come first so the browser tries the small app file before them.
  assert.ok(css.indexOf('noto-kr-400-ext') < css.indexOf('noto-kr-400.woff2'));
});

test('every Korean syllable the app writes is in the font files', async () => {
  const core = new Set(await read('scripts/fonts/core.txt'));
  const ext = everyday();
  const used = await usedHangul();
  // Outside both files the phone's own font draws it, which looks a little off. Rare syllables only.
  const nowhere = [...used].filter(c => !core.has(c) && !ext.has(c));
  assert.deepEqual(nowhere.filter(c => c !== '힣'), [], `not in any font file: ${nowhere.join('')}`);
  // New text whose syllables sit only in the -ext file still shows correctly, it just costs one more
  // download. When the list grows long, run scripts/fonts/build.py again.
  const extOnly = [...used].filter(c => !core.has(c) && ext.has(c));
  assert.ok(extOnly.length <= 80, `${extOnly.length} syllables are only in the -ext files (${extOnly.join('')}): run scripts/fonts/build.py`);
});
