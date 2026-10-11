import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');

test('the install button is wired into the top bar, sign-in card, settings and push sheet', async () => {
  const [html, app, auth, settings, notify, install] = await Promise.all(['index.html', 'app.js', 'js/auth.js', 'js/settings-panel.js', 'js/notify.js', 'js/install.js'].map(read));
  assert.match(html, /data-install hidden/);
  assert.match(html, /rel="apple-touch-icon" href="apple-touch-icon\.png"/);
  assert.match(app, /mountInstallButton\(document\.querySelector\('\[data-install\]'\)\)/);
  assert.match(auth, /mountInstallButton\(gate\.querySelector\('\[data-auth-install\]'\)\)/);
  assert.match(settings, /installRow\(row\)/);
  assert.match(notify, /openInstallGuide/);
  assert.match(install, /beforeinstallprompt/);
  assert.match(install, /appinstalled/);
});

test('install assets are cached and the manifest has installable PNG icons', async () => {
  const sw = await read('sw.js');
  for (const f of ['js/install.js', 'apple-touch-icon.png', 'icon-512.png']) {
    assert.ok(sw.includes(`'${f}'`), `${f} in the offline shell`);
    assert.ok((await stat(new URL(`../public/${f}`, import.meta.url))).size > 0);
  }
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.type === 'image/png'));
  assert.ok(manifest.icons.some(i => i.sizes === '192x192' && i.type === 'image/png'));
});
