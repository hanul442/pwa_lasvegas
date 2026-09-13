import test from 'node:test';
import assert from 'node:assert/strict';
import { startBlackjack, blackjackAction, settleBlackjack, playBaccarat, playRoulette, playSicBo } from '../lib/games.mjs';

test('blackjack round starts with two cards each',()=>{
  const r=startBlackjack(1_000_000);
  assert.equal(r.player.length,2);assert.equal(r.dealer.length,2);
});

test('blackjack double doubles stake and ends player action',()=>{
  for(let i=0;i<50;i++){
    const r=startBlackjack(1_000_000);
    if(r.status==='PLAYER'){
      blackjackAction(r,'DOUBLE',true);
      assert.equal(r.stake,2_000_000);assert.equal(r.player.length,3);assert.equal(r.status,'READY_TO_SETTLE');
      const out=settleBlackjack(r);assert.ok(Number.isInteger(out.netPnl));return;
    }
  }
  assert.fail('could not find actionable round');
});

test('baccarat produces valid score/result',()=>{
  const r=playBaccarat(1_000_000,'PLAYER');
  assert.ok(['PLAYER','BANKER','TIE'].includes(r.winner));
  assert.ok(r.playerScore>=0&&r.playerScore<=9);assert.ok(r.bankerScore>=0&&r.bankerScore<=9);
});

test('roulette result always 0..36',()=>{
  for(let i=0;i<100;i++){const r=playRoulette(1_000_000,'RED');assert.ok(r.number>=0&&r.number<=36);}
});

test('sic bo always rolls three dice and totals 3..18',()=>{
  for(let i=0;i<100;i++){const r=playSicBo(1_000_000,'BIG');assert.equal(r.dice.length,3);assert.ok(r.total>=3&&r.total<=18);}
});
