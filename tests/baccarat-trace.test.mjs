import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBaccaratTrace, baccaratTraceViewModel } from '../public/baccarat-trace.js';

test('natural baccarat trace explains stand and final result',()=>{
  const round={winner:'PLAYER',playerScore:9,bankerScore:7,player:['9♠','K♥'],banker:['7♦','Q♣'],trace:{natural:true,playerDrew:false,bankerDrew:false,payoutRule:'EVEN_MONEY'}};
  assert.deepEqual(describeBaccaratTrace(round),[
    'Natural 8/9: both sides stand.',
    'Winning side pays 1:1.',
    'Final: Player 9 · Banker 7 · PLAYER.'
  ]);
});

test('third-card and banker commission are visible in trace view model',()=>{
  const round={winner:'BANKER',playerScore:4,bankerScore:6,player:['2♠','A♥','A♣'],banker:['2♦','3♣','A♦'],trace:{natural:false,playerDrew:true,playerThirdValue:1,bankerDrew:true,payoutRule:'BANKER_0_95_TO_1'}};
  const vm=baccaratTraceViewModel(round);
  assert.equal(vm.winner,'BANKER');
  assert.deepEqual(vm.cards,['2♠','A♥','A♣','2♦','3♣','A♦']);
  assert.match(vm.rows.join(' '),/Player drew a third card \(1\)/);
  assert.match(vm.rows.join(' '),/Banker drew according to the third-card table/);
  assert.match(vm.rows.join(' '),/0\.95:1/);
});
