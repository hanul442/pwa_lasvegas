import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');

test('table ambience is decorative and layered behind game copy',()=>{
  assert.match(html,/class="table-ambience" aria-hidden="true"/);
  assert.match(css,/\.table-ambience\{[^}]*pointer-events:none/);
  assert.match(css,/\.table-copy\{[^}]*z-index:3/);
  assert.match(css,/\.table-motion\{[^}]*z-index:1[^}]*pointer-events:none/);
});

test('table transition and ambience retain responsive and reduced-motion fallbacks',()=>{
  assert.match(css,/\.game-surface\.is-active\{animation:table-surface-in/);
  assert.match(css,/@keyframes table-surface-in/);
  assert.match(css,/@keyframes ambient-sweep/);
  assert.match(css,/@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.game-surface\.is-active\{animation:none\}/);
  assert.match(css,/\.table-ambience::before,\.table-ambience i\{animation:none\}/);
});
