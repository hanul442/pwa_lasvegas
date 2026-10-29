// Checks a finished dist/ before Cloudflare puts it live. scripts/build.mjs runs it last, so a failure stops the
// deploy and the version already live stays up. Also runnable by hand: `node scripts/predeploy.mjs [dir]`.
//
// What breaks players without breaking any unit test:
// - a file sw.js lists is missing: the new version's install fails, so phones keep the old version forever;
// - an import (static or a lazily loaded game) points at a file that isn't there: that screen never opens;
// - index.html links a file that isn't there;
// - the API cannot even start a guest and hand back the state.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, posix, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const files = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});

// The SHELL list, read by running the top of sw.js with stand-ins for the worker globals.
function shellList(code) {
  const sandbox = { self: { addEventListener() {}, registration: {} }, caches: {}, location: { hostname: 'example.com' }, fetch() {}, URL };
  vm.runInNewContext(`${code}\n;globalThis.__shell = SHELL;`, sandbox, { timeout: 1000 });
  return sandbox.__shell;
}

export async function predeploy(dir = join(root, 'dist')) {
  const problems = [];
  const has = rel => existsSync(join(dir, rel)) && statSync(join(dir, rel)).isFile();

  // 1. Everything the offline shell installs.
  let shell = [];
  try { shell = shellList(readFileSync(join(dir, 'sw.js'), 'utf8')); } catch (err) { problems.push(`sw.js: could not read SHELL (${err.message})`); }
  for (const url of shell) if (url !== './' && !has(url)) problems.push(`sw.js SHELL lists ${url}, which is not in the build`);
  if (shell.length && !shell.includes('index.html')) problems.push('sw.js SHELL lost index.html');

  // 2. Every relative import in every script: static, re-export and import('...').
  const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const path of files(dir).filter(p => p.endsWith('.js'))) {
    const rel = relative(dir, path).split('\\').join('/');
    for (const m of readFileSync(path, 'utf8').matchAll(IMPORT)) {
      const target = posix.normalize(posix.join(posix.dirname(rel), m[1]));
      if (!has(target)) problems.push(`${rel} imports ${m[1]}, which is not in the build`);
    }
  }

  // 3. Files index.html links to.
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  for (const m of html.matchAll(/\b(?:href|src)="([^"#?:]+)"/g)) {
    if (!has(m[1].replace(/^\.?\//, ''))) problems.push(`index.html links ${m[1]}, which is not in the build`);
  }

  // 4. The API boots: a guest signs in and gets the state, through the same handler the Worker uses.
  try {
    const { handleApi } = await import(pathToFileURL(join(root, 'lib/api.mjs')).href);
    const { defaultState } = await import(pathToFileURL(join(root, 'lib/state.mjs')).href);
    let state = defaultState();
    const store = { load: async () => structuredClone(state), mutate: async fn => { const next = structuredClone(state); const out = await fn(next); state = next; return out; } };
    const call = (method, path, body, token) => handleApi({ method, header: n => (n === 'authorization' && token ? `Bearer ${token}` : n === 'x-idempotency-key' ? `predeploy-${path}` : undefined), body: async () => body ?? {} }, new URL(`http://x${path}`), store, { AUTH_REQUIRED: true });
    const guest = await call('POST', '/api/auth/guest', { terms: true });
    if (guest.status >= 300 || !guest.data.token) problems.push(`API: guest sign-in answered ${guest.status} ${JSON.stringify(guest.data).slice(0, 120)}`);
    else {
      const me = await call('GET', '/api/state', null, guest.data.token);
      if (me.status !== 200 || !(me.data.user?.account?.available > 0)) problems.push(`API: state for a new guest answered ${me.status} ${JSON.stringify(me.data).slice(0, 120)}`);
    }
  } catch (err) { problems.push(`API: ${err.stack?.split('\n').slice(0, 2).join(' ') || err}`); }

  return { problems, shell: shell.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] || join(root, 'dist'));
  const { problems, shell } = await predeploy(dir);
  if (problems.length) { console.error(`predeploy: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
  console.log(`predeploy: ok (${shell} shell files, imports, links, API)`);
}
