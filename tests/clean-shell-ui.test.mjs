import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

test('clean shell exposes primary full-screen surfaces and no dialog popup architecture',()=>{
  for(const surface of ['lobby','games','ranking','profile','table']) assert.match(html,new RegExp(`data-surface="${surface}"`));
  assert.doesNotMatch(html,/role="dialog"|<dialog/i);
  assert.match(html,/data-game="blackjack"/);
});

test('shell protects scroll, safe areas, landscape and desktop reachability',()=>{
  assert.match(css,/overflow-x:hidden/);
  assert.doesNotMatch(css,/body\s*\{[^}]*overflow\s*:\s*hidden/i);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(css,/@media \(min-width:980px\)/);
  assert.match(css,/touch-action:manipulation/);
});

test('game entry uses a full-screen surface with reversible browser navigation',()=>{
  assert.match(js,/history\.pushState\(\{vegasSurface:'table'\}/);
  assert.match(js,/showSurface\('table'/);
  assert.match(js,/history\.back\(\)/);
  assert.match(js,/popstate/);
  assert.match(js,/Escape/);
  assert.match(js,/lastLobbyTrigger\?\.focus/);
});
