import test from 'node:test';
import assert from 'node:assert/strict';
import { rouletteFacts, describeRouletteRound, rouletteTraceViewModel } from '../public/roulette-trace.js';

test('rouletteFacts classifies zero safely',()=>{
  assert.deepEqual(rouletteFacts(0),{number:0,color:'GREEN',parity:'NONE',range:'NONE'});
});

test('rouletteFacts classifies standard pockets',()=>{
  assert.deepEqual(rouletteFacts(17),{number:17,color:'BLACK',parity:'ODD',range:'LOW'});
  assert.deepEqual(rouletteFacts(32),{number:32,color:'RED',parity:'EVEN',range:'HIGH'});
});

test('describeRouletteRound explains zero on even bet',()=>{
  const rows=describeRouletteRound({number:0,color:'GREEN',betType:'EVEN',target:null,netPnl:-1000000});
  assert.match(rows.join(' '),/Zero is neither odd nor even/);
  assert.match(rows.at(-1),/-1,000,000 CH/);
});

test('number hit reports 35:1 and win state',()=>{
  const round={number:17,color:'BLACK',betType:'NUMBER',target:17,netPnl:35000000};
  const vm=rouletteTraceViewModel(round);
  assert.equal(vm.won,true);
  assert.match(vm.rows.join(' '),/35:1/);
});

test('invalid roulette pocket fails closed',()=>{
  assert.throws(()=>rouletteFacts(37),/INVALID_ROULETTE_NUMBER/);
});
