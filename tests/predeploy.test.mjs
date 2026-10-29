import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { predeploy } from '../scripts/predeploy.mjs';

// A tiny build with one of each mistake the deploy gate exists for.
test('the deploy gate catches missing shell files, broken imports and dead links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vegas-predeploy-'));
  try {
    mkdirSync(join(dir, 'js'));
    writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="styles.css"><script type="module" src="app.js"></script><link rel="icon" href="gone.svg">');
    writeFileSync(join(dir, 'styles.css'), 'body{}');
    writeFileSync(join(dir, 'app.js'), 'import{a}from"./js/a.js";const g=()=>import("./js/games/lost.js");');
    writeFileSync(join(dir, 'js/a.js'), 'export const a=1;');
    writeFileSync(join(dir, 'sw.js'), "const CACHE='vegas-shell-v1';\nconst SHELL=['./','index.html','app.js','js/a.js','js/missing.js'];\nself.addEventListener('install',()=>{});");
    const { problems } = await predeploy(dir);
    assert.deepEqual(problems.sort(), [
      'app.js imports ./js/games/lost.js, which is not in the build',
      'index.html links gone.svg, which is not in the build',
      'sw.js SHELL lists js/missing.js, which is not in the build'
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
