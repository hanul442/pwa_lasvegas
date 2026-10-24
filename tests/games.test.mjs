import test from 'node:test';
import assert from 'node:assert/strict';
import { startBlackjack, blackjackAction, blackjackPublic, settleBlackjack, playBaccarat, playRoulette, playSicBo, baccaratShouldBankerDraw, resolveBaccarat, isBaccaratPair, validateBaccaratSideBets } from '../lib/games.mjs';

test('blackjack round starts with two cards each',()=>{
  const r=startBlackjack(1_000_000);
  assert.equal(r.player.length,2);assert.equal(r.dealer.length,2);
  assert.equal(r.engineVersion,'LEGACY_V1');
});

test('legacy blackjack rejects multi-spot v2 round objects',()=>{
  const v2Round={id:'bj2_test',game:'Blackjack',engineVersion:'MULTI_SPOT_V2',status:'PLAYER',hands:[],dealer:[],stake:1_000_000};
  assert.throws(()=>blackjackAction(v2Round,'HIT',true),/BLACKJACK_ENGINE_MISMATCH/);
  assert.throws(()=>settleBlackjack(v2Round),/BLACKJACK_ENGINE_MISMATCH/);
  assert.throws(()=>blackjackPublic(v2Round,false),/BLACKJACK_ENGINE_MISMATCH/);
});

test('blackjack settlement fails closed while player action is still open',()=>{
  for(let i=0;i<50;i++){
    const r=startBlackjack(1_000_000);
    if(r.status==='PLAYER'){
      assert.throws(()=>settleBlackjack(r),/BAD_STATE/);
      assert.equal(r.status,'PLAYER');
      return;
    }
  }
  assert.fail('could not find actionable round');
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
  const banker=resolveBaccarat(20_000_000,'BANKER',bankerDeck);
  assert.equal(banker.winner,'BANKER');assert.equal(banker.netPnl,19_000_000);
  // Between 100만s the 5% goes up or down a unit at random (fair on average): 100만 wins 100만 95% of the time.
  assert.equal(resolveBaccarat(1_000_000,'BANKER',bankerDeck,null,()=>0.94).netPnl,1_000_000);
  assert.equal(resolveBaccarat(1_000_000,'BANKER',bankerDeck,null,()=>0.96).netPnl,0);
  assert.equal(resolveBaccarat(10_000_000,'BANKER',bankerDeck,null,()=>0.4).netPnl,10_000_000);
  assert.equal(resolveBaccarat(10_000_000,'BANKER',bankerDeck,null,()=>0.6).netPnl,9_000_000);assert.equal(banker.trace.payoutRule,'BANKER_0_95_TO_1');
});

test('roulette result always 0..36',()=>{
  for(let i=0;i<100;i++){const r=playRoulette(1_000_000,'RED');assert.ok(r.number>=0&&r.number<=36);}
});

test('sic bo always rolls three dice and totals 3..18',()=>{
  for(let i=0;i<100;i++){const r=playSicBo(1_000_000,'BIG');assert.equal(r.dice.length,3);assert.ok(r.total>=3&&r.total<=18);}
});

test('roulette takes chips on many spots in one spin and pays each on its own', async () => {
  const { playRouletteBets } = await import('../lib/games.mjs');
  const bets = [
    { betType: 'NUMBER', target: 17, stake: 100 },
    { betType: 'RED', stake: 200 },
    { betType: 'DOZEN', target: 2, stake: 300 },
    { betType: 'COLUMN', target: 2, stake: 400 },
    { betType: 'ODD', stake: 50 }
  ];
  // 17 is black, odd, second dozen, second column.
  const r = playRouletteBets(bets, 17);
  assert.equal(r.stake, 1050);
  assert.deepEqual(r.bets.map(b => b.netPnl), [3500, -200, 600, 800, 50]);
  assert.equal(r.netPnl, 3500 - 200 + 600 + 800 + 50);
  // Zero loses every outside bet.
  assert.equal(playRouletteBets([{ betType: 'EVEN', stake: 10 }, { betType: 'LOW', stake: 10 }, { betType: 'COLUMN', target: 3, stake: 10 }], 0).netPnl, -30);
  assert.throws(() => playRouletteBets([{ betType: 'RED', stake: 1 }, { betType: 'RED', stake: 1 }]), /DUPLICATE_BET/);
  assert.throws(() => playRouletteBets([{ betType: 'DOZEN', target: 4, stake: 1 }]), /INVALID_TARGET/);
  assert.throws(() => playRouletteBets([]), /INVALID_BETS/);
});

test('baccarat pair side bets read the first two cards of each side and pay 11:1', () => {
  assert.equal(isBaccaratPair([{ r: 'K', s: '♠' }, { r: 'K', s: '♥' }]), true);
  assert.equal(isBaccaratPair([{ r: 'K', s: '♠' }, { r: 'Q', s: '♠' }]), false);
  assert.equal(isBaccaratPair([{ r: '10', s: '♠' }, { r: 'J', s: '♠' }]), false);
  // Cards come off the end: player 7-7, banker K-9 (banker natural 9, player 4 stands).
  const deck = [{ r: '2', s: '♣' }, { r: '3', s: '♣' }, { r: '9', s: '♦' }, { r: 'K', s: '♣' }, { r: '7', s: '♥' }, { r: '7', s: '♠' }];
  const r = resolveBaccarat(20_000_000, 'BANKER', deck, { PLAYER_PAIR: 200_000, BANKER_PAIR: 100_000 });
  assert.equal(r.winner, 'BANKER');
  assert.deepEqual(r.pairs, { PLAYER_PAIR: true, BANKER_PAIR: false });
  assert.equal(r.mainPnl, 19_000_000);
  assert.deepEqual(r.sideBets.map(b => [b.betType, b.won, b.netPnl]), [['BANKER_PAIR', false, -100_000], ['PLAYER_PAIR', true, 2_200_000]]);
  assert.equal(r.stake, 20_300_000);
  assert.equal(r.mainStake, 20_000_000);
  assert.equal(r.netPnl, 19_000_000 + 2_200_000 - 100_000);
  // Without side bets the round reads exactly as before.
  const plain = resolveBaccarat(1_000_000, 'PLAYER', deck);
  assert.equal(plain.netPnl, -1_000_000);
  assert.equal(plain.stake, 1_000_000);
  assert.equal(plain.sideBets, undefined);
  // Only the first two cards count: player A-2 draws another A, still no pair.
  const third = [{ r: 'Q', s: '♣' }, { r: 'A', s: '♦' }, { r: '7', s: '♦' }, { r: 'K', s: '♦' }, { r: '2', s: '♠' }, { r: 'A', s: '♠' }];
  const t = resolveBaccarat(1_000_000, 'TIE', third, { PLAYER_PAIR: 100_000 });
  assert.equal(t.player.length, 3);
  assert.equal(t.player[0][0], t.player[2][0]);
  assert.equal(t.pairs.PLAYER_PAIR, false);
  assert.equal(t.sideBets[0].netPnl, -100_000);
});

test('baccarat side bets are validated', () => {
  assert.deepEqual(validateBaccaratSideBets(undefined), []);
  assert.deepEqual(validateBaccaratSideBets({ BANKER_PAIR: 5 }), [{ betType: 'BANKER_PAIR', stake: 5 }]);
  assert.throws(() => validateBaccaratSideBets({ TIE_PAIR: 5 }), /INVALID_BET_TYPE/);
  assert.throws(() => validateBaccaratSideBets({ PLAYER_PAIR: 0 }), /INVALID_STAKE/);
  assert.throws(() => validateBaccaratSideBets({ PLAYER_PAIR: 1.5 }), /INVALID_STAKE/);
  assert.throws(() => validateBaccaratSideBets([1]), /INVALID_BETS/);
});

test('lightning roulette: a struck straight-up win returns stake × multiplier in total', async () => {
  const { playRouletteBets } = await import('../lib/games.mjs');
  const strikes = [{ number: 17, multiplier: 200 }, { number: 4, multiplier: 50 }];
  const bets = [
    { betType: 'NUMBER', target: 17, stake: 100 },
    { betType: 'NUMBER', target: 4, stake: 100 },
    { betType: 'RED', stake: 200 },
    { betType: 'DOZEN', target: 2, stake: 300 }
  ];
  const r = playRouletteBets(bets, 17, strikes);
  assert.deepEqual(r.lightning, strikes);
  // 200x in total: the 100 stake comes back as 20,000, a net of 19,900.
  assert.equal(r.bets[0].netPnl, 100 * 200 - 100);
  assert.equal(r.bets[0].multiplier, 200);
  assert.equal(r.bets[1].netPnl, -100);
  // Outside bets are untouched by lightning: red loses on black 17, the second dozen pays 2:1.
  assert.equal(r.bets[2].netPnl, -200);
  assert.equal(r.bets[3].netPnl, 600);
  assert.equal(r.netPnl, 19_900 - 100 - 200 + 600);
});

test('lightning roulette: an unstruck straight-up win pays 29:1, the plain table still 35:1', async () => {
  const { playRouletteBets, playRoulette, LIGHTNING_STRAIGHT_MULT } = await import('../lib/games.mjs');
  assert.equal(LIGHTNING_STRAIGHT_MULT, 29);
  const bet = [{ betType: 'NUMBER', target: 8, stake: 10 }, { betType: 'BLACK', stake: 10 }, { betType: 'COLUMN', target: 2, stake: 10 }];
  const lit = playRouletteBets(bet, 8, [{ number: 9, multiplier: 500 }]);
  assert.equal(lit.bets[0].netPnl, 290);
  assert.equal(lit.bets[0].multiplier, undefined);
  assert.equal(lit.bets[1].netPnl, 10);
  assert.equal(lit.bets[2].netPnl, 20);
  const plain = playRouletteBets(bet, 8);
  assert.equal(plain.bets[0].netPnl, 350);
  assert.equal(plain.lightning, undefined);
  // The single-bet route follows the same rule.
  for (let i = 0; i < 200; i++) {
    const r = playRoulette(10, 'NUMBER', 8, { lightning: true });
    const hit = r.lightning.find(s => s.number === 8);
    assert.equal(r.netPnl, r.number !== 8 ? -10 : hit ? 10 * hit.multiplier - 10 : 290);
  }
  // Lightning that was not rolled by the rules is refused.
  assert.throws(() => playRouletteBets(bet, 8, [{ number: 8, multiplier: 1000 }]), /INVALID_LIGHTNING/);
  assert.throws(() => playRouletteBets(bet, 8, [{ number: 8, multiplier: 50 }, { number: 8, multiplier: 50 }]), /INVALID_LIGHTNING/);
  assert.throws(() => playRouletteBets(bet, 8, []), /INVALID_LIGHTNING/);
});

test('lightning strikes: 1 to 5 distinct numbers, 50x to 500x, low multipliers most common', async () => {
  const { rollLightning, playRouletteBets, LIGHTNING_MULTIPLIERS, LIGHTNING_STRIKE_COUNTS } = await import('../lib/games.mjs');
  const allowed = new Set([50, 100, 200, 300, 400, 500]);
  assert.deepEqual(new Set(LIGHTNING_MULTIPLIERS.map(([m]) => m)), allowed);
  const seen = new Map();
  const counts = new Map();
  for (let i = 0; i < 5000; i++) {
    const strikes = rollLightning();
    assert.ok(strikes.length >= 1 && strikes.length <= 5);
    assert.equal(new Set(strikes.map(s => s.number)).size, strikes.length);
    counts.set(strikes.length, (counts.get(strikes.length) || 0) + 1);
    for (const s of strikes) {
      assert.ok(Number.isInteger(s.number) && s.number >= 0 && s.number <= 36);
      assert.ok(allowed.has(s.multiplier));
      seen.set(s.multiplier, (seen.get(s.multiplier) || 0) + 1);
    }
  }
  // Every multiplier shows up, and each step up the ladder is rarer than the one below it.
  const ladder = [50, 100, 200, 300, 400, 500].map(m => seen.get(m) || 0);
  assert.ok(ladder.every(n => n > 0));
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] < ladder[i - 1], `${ladder}`);
  assert.ok((counts.get(1) || 0) > (counts.get(5) || 0));
  // Server-side spins always carry their strikes.
  assert.ok(playRouletteBets([{ betType: 'RED', stake: 1 }], undefined, true).lightning.length >= 1);
  // The weights keep a straight-up bet near a normal roulette return (about 97%).
  const w = t => t.reduce((a, [, x]) => a + x, 0);
  const eCount = LIGHTNING_STRIKE_COUNTS.reduce((a, [k, x]) => a + k * x, 0) / w(LIGHTNING_STRIKE_COUNTS);
  const eMult = LIGHTNING_MULTIPLIERS.reduce((a, [m, x]) => a + m * x, 0) / w(LIGHTNING_MULTIPLIERS);
  const p = eCount / 37;
  const rtp = (p * eMult + (1 - p) * 30) / 37;
  assert.ok(rtp > 0.95 && rtp < 0.985, `straight-up return ${rtp}`);
});
