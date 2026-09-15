import test from 'node:test';
import assert from 'node:assert/strict';
import { rouletteBetLabel, rouletteChipViewModel } from '../public/roulette-chip-motion.js';

test('roulette number labels preserve the selected target',()=>{
  assert.equal(rouletteBetLabel('NUMBER',17),'NUMBER 17');
  assert.equal(rouletteBetLabel('RED',17),'RED');
});

test('roulette chip view model locks the selected fictional CH wager before settlement',()=>{
  const vm=rouletteChipViewModel({stake:3_000_000,betType:'BLACK',pending:true});
  assert.equal(vm.phase,'locked');
  assert.equal(vm.selection,'BLACK');
  assert.equal(vm.stake,3_000_000);
  assert.equal(vm.settlement,null);
});

test('roulette winning chips use authoritative net profit for dealer payout',()=>{
  const vm=rouletteChipViewModel({stake:1_000_000,betType:'NUMBER',target:17,round:{number:17,color:'BLACK',netPnl:35_000_000}});
  assert.equal(vm.phase,'settled');
  assert.equal(vm.number,17);
  assert.equal(vm.color,'BLACK');
  assert.deepEqual(vm.settlement,{kind:'win',wagerMotion:'hold',payoutMotion:'pay',payoutAmount:35_000_000,returnedAmount:36_000_000});
});

test('roulette zero loss sweeps the wager without inventing a payout',()=>{
  const vm=rouletteChipViewModel({stake:5_000_000,betType:'EVEN',round:{number:0,color:'GREEN',netPnl:-5_000_000}});
  assert.equal(vm.number,0);
  assert.equal(vm.settlement.kind,'loss');
  assert.equal(vm.settlement.payoutAmount,0);
  assert.equal(vm.settlement.returnedAmount,0);
});
