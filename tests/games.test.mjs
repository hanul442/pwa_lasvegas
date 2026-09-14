import test from 'node:test';
import assert from 'node:assert/strict';
import { startBlackjack, blackjackAction, settleBlackjack, playBaccarat, playRoulette, playSicBo, baccaratShouldBankerDraw, resolveBaccarat } from '../lib/games.mjs';

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

test('baccarat produces valid score/result and an auditable trace',()=>{
  const r=playBaccarat(1_000_000,'PLAYER');
  assert.ok(['PLAYER','BANKER','TIE'].includes(r.winner));
  assert.ok(r.playerScore>=0&&r.playerScore<=9);assert.ok(r.bankerScore>=0&&r.bankerScore<=9);
  assert.equal(typeof r.trace.playerRule,'string');assert.equal(typeof r.trace.bankerRule,'string');
});

test('baccarat banker third-card table matches canonical draw thresholds',()=>{
  assert.equal(baccaratShouldBankerDraw(2,9),true);
  assert.equal(baccaratShouldBankerDraw(3,8),false);
  assert.equal(baccaratShouldBankerDraw(3,7),true);
  assert.equal(baccaratShouldBankerDraw(4,1),false);
  assert.equal(baccaratShouldBankerDraw(4,2),true);
  assert.equal(baccaratShouldBankerDraw(5,3),false);
  assert.equal(baccaratShouldBankerDraw(5,4),true);
  assert.equal(baccaratShouldBankerDraw(6,5),false);
  assert.equal(baccaratShouldBankerDraw(6,6),true);
  assert.equal(baccaratShouldBankerDraw(7,7),false);
  assert.equal(baccaratShouldBankerDraw(5,null),true);
  assert.equal(baccaratShouldBankerDraw(6,null),false);
});

test('baccarat naturals stand without drawing',()=>{
  const deck=[
    {r:'2',s:'♣'},{r:'3',s:'♣'},
    {r:'4',s:'♣'},{r:'4',s:'♦'},
    {r:'9',s:'♥'},{r:'K',s:'♠'}
  ];
  const r=resolveBaccarat(1_000_000,'PLAYER',deck);
  assert.equal(r.trace.natural,true);
  assert.equal(r.player.length,2);assert.equal(r.banker.length,2);
  assert.equal(r.trace.playerRule,'NATURAL_STAND');assert.equal(r.trace.bankerRule,'NATURAL_STAND');
});

test('baccarat tie pushes non-tie bets and banker win applies commission',()=>{
  const tieDeck=[
    {r:'2',s:'♣'},{r:'3',s:'♣'},
    {r:'A',s:'♣'},{r:'7',s:'♦'},
    {r:'K',s:'♥'},{r:'8',s:'♠'}
  ];
  const tie=resolveBaccarat(1_000_000,'PLAYER',tieDeck);
  assert.equal(tie.winner,'TIE');assert.equal(tie.netPnl,0);assert.equal(tie.trace.payoutRule,'NON_TIE_PUSH');

  const bankerDeck=[
    {r:'2',s:'♣'},{r:'3',s:'♣'},
    {r:'K',s:'♣'},{r:'9',s:'♦'},
    {r:'K',s:'♥'},{r:'8',s:'♠'}
  ];
  const banker=resolveBaccarat(1_000_000,'BANKER',bankerDeck);
  assert.equal(banker.winner,'BANKER');assert.equal(banker.netPnl,950_000);assert.equal(banker.trace.payoutRule,'BANKER_0_95_TO_1');
});

test('roulette result always 0..36',()=>{
  for(let i=0;i<100;i++){const r=playRoulette(1_000_000,'RED');assert.ok(r.number>=0&&r.number<=36);}
});

test('sic bo always rolls three dice and totals 3..18',()=>{
  for(let i=0;i<100;i++){const r=playSicBo(1_000_000,'BIG');assert.equal(r.dice.length,3);assert.ok(r.total>=3&&r.total<=18);}
});
