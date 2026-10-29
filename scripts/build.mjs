// Production copy of public/ in dist/, which Cloudflare serves (wrangler.toml runs this before every deploy).
// - Every .js and .css file is minified in place with esbuild, same paths, so imports and sw.js's list still match.
//   Without esbuild (not installed) the files are copied as they are: the deploy never fails over minifying.
// - index.html gets <link rel="modulepreload"> for everything app.js imports up front, so the browser fetches
//   the home screen's modules at once instead of discovering them one import level at a time.
// - sw.js's cache name gets a hash of the files, so any change at all reaches players as a new version.
// - Last, scripts/predeploy.mjs checks the result; a problem fails the build and so stops the deploy.
// The local dev server (server.mjs) keeps serving public/ untouched.
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

const files = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});
const rel = path => relative(out, path).split('\\').join('/');

let esbuild = null;
try { esbuild = await import('esbuild'); } catch { console.warn('build: esbuild is not installed, copying files without minifying'); }

let before = 0;
let after = 0;
for (const path of files(out)) {
  const loader = path.endsWith('.js') ? 'js' : path.endsWith('.css') ? 'css' : null;
  if (!loader || !esbuild) continue;
  const code = readFileSync(path, 'utf8');
  try {
    // No target: nothing is rewritten for older browsers, only whitespace, comments and local names go.
    const { code: small } = await esbuild.transform(code, { loader, minify: true, charset: 'utf8', legalComments: 'none' });
    writeFileSync(path, small);
    before += Buffer.byteLength(code);
    after += Buffer.byteLength(small);
  } catch (err) {
    console.warn(`build: kept ${rel(path)} as is (${err.message.split('\n')[0]})`);
  }
}

// The modules app.js pulls in statically: the home screen needs all of them before it can draw.
function staticGraph(entry) {
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(join(out, file), 'utf8');
    // Minified or not: `import{a}from"./x.js"`, `import"./x.js"`, `export{a}from"./x.js"`. import(...) is left out on purpose.
    for (const m of code.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w*{][^;'"]*?from\s*)?["'](\.{1,2}\/[^"']+)["']/g)) {
      walk(posix.normalize(posix.join(posix.dirname(file), m[1])));
    }
  };
  walk(entry);
  return [...seen];
}

const htmlPath = join(out, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const preloads = staticGraph('app.js').filter(f => f !== 'app.js').map(f => `  <link rel="modulepreload" href="${f}">`).join('\n');
writeFileSync(htmlPath, html.replace('</head>', `${preloads}\n</head>`));

const hash = createHash('sha256');
for (const path of files(out).sort()) {
  if (rel(path) === 'sw.js') continue;
  hash.update(rel(path));
  hash.update(readFileSync(path));
}
const version = hash.digest('hex').slice(0, 10);
const swPath = join(out, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const stamped = sw.replace(/(["'])(vegas-shell-[^"']*)\1/, (_, q, name) => `${q}${name}-${version}${q}`);
if (stamped === sw) throw new Error('build: sw.js cache name not found, players would never get new versions');
writeFileSync(swPath, stamped);

const kb = n => `${Math.round(n / 1024)} KB`;
console.log(`build: dist/ ready, version ${version}${esbuild ? `, js+css ${kb(before)} -> ${kb(after)}` : ''}, ${preloads.split('\n').length} modulepreloads`);

// Last gate before Cloudflare puts this live: missing shell files, broken imports or links, an API that can't
// start a guest. Any problem fails the build, so the deploy stops and the live version stays up.
const { predeploy } = await import('./predeploy.mjs');
const { problems, shell } = await predeploy(out);
if (problems.length) {
  console.error(`predeploy: ${problems.length} problem(s), not deploying\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`predeploy: ok (${shell} shell files, imports, links, API)`);
