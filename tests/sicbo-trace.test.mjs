import test from 'node:test';
import assert from 'node:assert/strict';
import {sicBoFacts,describeSicBoRound,sicBoTraceViewModel} from '../public/sicbo-trace.js';

test('sicBoFacts identifies total parity range and triple',()=>{
  assert.deepEqual(sicBoFacts([2,3,4]),{dice:[2,3,4],total:9,triple:false,parity:'ODD',range:'SMALL'});
  assert.deepEqual(sicBoFacts([5,5,5]),{dice:[5,5,5],total:15,triple:true,parity:'ODD',range:'BIG'});
});

test('triples explicitly override small/big/parity bets',()=>{
  const rows=describeSicBoRound({dice:[3,3,3],betType:'SMALL',netPnl:-100});
  assert.ok(rows.some(x=>x.includes('Triple overrides SMALL')));
  assert.ok(rows.some(x=>x.includes('Triple detected')));
});

test('exact total hit explains payout',()=>{
  const vm=sicBoTraceViewModel({dice:[2,3,5],betType:'TOTAL',target:10,netPnl:600});
  assert.equal(vm.won,true);
  assert.ok(vm.rows.some(x=>x.includes('pays 6:1')));
});

test('any triple explains 24 to 1 payout',()=>{
  const rows=describeSicBoRound({dice:[6,6,6],betType:'ANY_TRIPLE',netPnl:2400});
  assert.ok(rows.some(x=>x.includes('pays 24:1')));
});
