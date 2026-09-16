import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');

test('Games exposes approved virtual CH stake tiers',()=>{
  for(const tier of ['low','mid','high','vip']) assert.match(html,new RegExp(`data-tier="${tier}"`));
  for(const min of ['100000','1000000','10000000','50000000']) assert.match(html,new RegExp(`data-min="${min}"`));
  assert.match(html,/현실 화폐 가치가 없습니다/);
  assert.match(html,/구매·환전·출금할 수 없으며/);
});

test('catalog routes through tiers before full-screen table',()=>{
  for(const game of ['blackjack','roulette','dice','poker']) assert.match(html,new RegExp(`data-game="${game}"`));
  assert.match(js,/vegasSurface:'tiers'/);
  assert.match(js,/vegasSurface:'table'/);
  assert.match(js,/history\.back\(\)/);
  assert.match(js,/event\.key==='Escape'/);
});

test('tier layouts preserve reachable responsive surfaces',()=>{
  assert.match(css,/\.tier-grid/);
  assert.match(css,/@media \(orientation:landscape\) and \(max-height:520px\)/);
  assert.match(css,/touch-action:manipulation/);
  assert.match(css,/overflow-x:hidden/);
});
