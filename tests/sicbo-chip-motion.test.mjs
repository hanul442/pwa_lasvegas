import test from 'node:test';
import assert from 'node:assert/strict';
import { sicBoBetLabel, sicBoChipViewModel } from '../public/sicbo-chip-motion.js';

test('sic bo total labels preserve target',()=>{
  assert.equal(sicBoBetLabel('TOTAL',10),'TOTAL 10');
  assert.equal(sicBoBetLabel('ANY_TRIPLE',10),'ANY TRIPLE');
});

test('sic bo locks the selected fictional CH wager before the dice settle',()=>{
  const vm=sicBoChipViewModel({stake:3_000_000,betType:'BIG',pending:true});
  assert.equal(vm.phase,'locked');
  assert.equal(vm.selection,'BIG');
  assert.equal(vm.settlement,null);
});

test('sic bo win pays only authoritative net profit as new chips',()=>{
  const vm=sicBoChipViewModel({stake:1_000_000,betType:'ANY_TRIPLE',round:{dice:[4,4,4],total:12,netPnl:24_000_000}});
  assert.equal(vm.total,12);
  assert.deepEqual(vm.dice,[4,4,4]);
  assert.deepEqual(vm.settlement,{kind:'win',wagerMotion:'hold',payoutMotion:'pay',payoutAmount:24_000_000,returnedAmount:25_000_000});
});

test('sic bo loss sweeps wager without payout',()=>{
  const vm=sicBoChipViewModel({stake:5_000_000,betType:'SMALL',round:{dice:[6,6,6],total:18,netPnl:-5_000_000}});
  assert.equal(vm.settlement.kind,'loss');
  assert.equal(vm.settlement.payoutAmount,0);
  assert.equal(vm.settlement.returnedAmount,0);
});
