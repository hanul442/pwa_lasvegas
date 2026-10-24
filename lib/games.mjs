import crypto from 'node:crypto';
import { id } from './state.mjs';
import { payout, isMoney, roundMoney } from './constants.mjs';

const SUITS=['♠','♥','♦','♣'];
const RANKS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const LEGACY_BLACKJACK_ENGINE='LEGACY_V1';

function randInt(max) { return crypto.randomInt(0,max); }
function freshDeck(decks=1) {
  const cards=[];
  for(let d=0;d<decks;d++) for(const s of SUITS) for(const r of RANKS) cards.push({r,s});
  for(let i=cards.length-1;i>0;i--){const j=randInt(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}
  return cards;
}
function cardText(c){return `${c.r}${c.s}`;}
function bjValue(cards){
  let total=0,aces=0;
  for(const c of cards){if(c.r==='A'){aces++;total+=11;}else if(['J','Q','K'].includes(c.r))total+=10;else total+=Number(c.r);}
  while(total>21&&aces>0){total-=10;aces--;}
  return {total,soft:aces>0};
}
function assertLegacyBlackjack(round){
  if(!round||round.game!=='Blackjack'||(round.engineVersion&&round.engineVersion!==LEGACY_BLACKJACK_ENGINE)) throw new Error('BLACKJACK_ENGINE_MISMATCH');
}

export function startBlackjack(stake) {
  const deck=freshDeck(6);
  const player=[deck.pop(),deck.pop()]; const dealer=[deck.pop(),deck.pop()];
  const round={id:id('bj'),game:'Blackjack',engineVersion:LEGACY_BLACKJACK_ENGINE,stake,deck,player,dealer,status:'PLAYER',doubled:false,createdAt:new Date().toISOString()};
  const p=bjValue(player),d=bjValue(dealer);
  if(p.total===21 || d.total===21) round.status='READY_TO_SETTLE';
  return round;
}
export function blackjackPublic(round, reveal=false){
  assertLegacyBlackjack(round);
  return {id:round.id,game:round.game,stake:round.stake,status:round.status,player:round.player.map(cardText),playerValue:bjValue(round.player).total,dealer:[cardText(round.dealer[0]),reveal?cardText(round.dealer[1]):'HIDDEN'],dealerValue:reveal?bjValue(round.dealer).total:null,doubled:round.doubled};
}
export function blackjackAction(round,action,canDouble=true){
  assertLegacyBlackjack(round);
  if(round.status!=='PLAYER') throw new Error('ROUND_NOT_ACTIONABLE');
  if(action==='HIT') { round.player.push(round.deck.pop()); if(bjValue(round.player).total>=21) round.status='READY_TO_SETTLE'; }
  else if(action==='STAND') round.status='READY_TO_SETTLE';
  else if(action==='DOUBLE') { if(round.player.length!==2||round.doubled||!canDouble) throw new Error('DOUBLE_NOT_ALLOWED'); round.doubled=true; round.stake*=2; round.player.push(round.deck.pop()); round.status='READY_TO_SETTLE'; }
  else throw new Error('INVALID_ACTION');
  return round;
}
export function settleBlackjack(round){
  assertLegacyBlackjack(round);
  if(round.status!=='READY_TO_SETTLE') throw new Error('BAD_STATE');
  const p=bjValue(round.player); let d=bjValue(round.dealer);
  const pNatural=round.player.length===2&&p.total===21&&!round.doubled;
  const dNatural=round.dealer.length===2&&d.total===21;
  let netPnl=0,result='PUSH';
  if(p.total>21){netPnl=-round.stake;result='BUST';}
  else if(dNatural){netPnl=pNatural?0:-round.stake;result=pNatural?'PUSH':'DEALER_BLACKJACK';}
  else if(pNatural){netPnl=payout(round.stake,round.stake*1.5);result='BLACKJACK';}
  else {
    while(d.total<17){round.dealer.push(round.deck.pop());d=bjValue(round.dealer);}
    if(d.total>21||p.total>d.total){netPnl=round.stake;result='WIN';}
    else if(p.total<d.total){netPnl=-round.stake;result='LOSS';}
  }
  round.status='SETTLED';round.result={result,netPnl};
  return {netPnl,result,public:blackjackPublic(round,true)};
}

export function baccaratCardValue(c){ if(c.r==='A') return 1; if(['10','J','Q','K'].includes(c.r)) return 0; return Number(c.r); }
export function baccaratScore(cards){return cards.reduce((s,c)=>s+baccaratCardValue(c),0)%10;}
export function baccaratShouldBankerDraw(bankerScore,playerThirdValue=null){
  if(!Number.isInteger(bankerScore)||bankerScore<0||bankerScore>9) throw new Error('INVALID_BANKER_SCORE');
  if(playerThirdValue===null) return bankerScore<=5;
  if(!Number.isInteger(playerThirdValue)||playerThirdValue<0||playerThirdValue>9) throw new Error('INVALID_PLAYER_THIRD');
  if(bankerScore<=2) return true;
  if(bankerScore===3) return playerThirdValue!==8;
  if(bankerScore===4) return playerThirdValue>=2&&playerThirdValue<=7;
  if(bankerScore===5) return playerThirdValue>=4&&playerThirdValue<=7;
  if(bankerScore===6) return playerThirdValue>=6&&playerThirdValue<=7;
  return false;
}
function baccaratPnl(stake,betType,winner,rand){
  if(winner==='TIE'&&betType!=='TIE') return 0;
  if(winner!==betType) return -stake;
  if(betType==='PLAYER') return stake;
  if(betType==='BANKER') return payout(stake,stake*0.95,rand); // the 5% commission; between 100만s it rounds at random, fair on average
  return stake*8;
}
// Pair side bets: the side's first two cards share a rank (K-K, 7-7). Paid 11:1 whoever wins.
export const BACCARAT_SIDE_BETS={PLAYER_PAIR:11,BANKER_PAIR:11};
export function isBaccaratPair(cards){return cards.length>=2&&cards[0].r===cards[1].r;}
// Accepts { PLAYER_PAIR: stake, BANKER_PAIR: stake } (either may be left out); returns [{betType,stake}].
export function validateBaccaratSideBets(raw){
  if(raw===undefined||raw===null)return [];
  if(typeof raw!=='object'||Array.isArray(raw))throw new Error('INVALID_BETS');
  return Object.entries(raw).filter(([,v])=>v!==undefined&&v!==null).map(([betType,v])=>{
    if(!(betType in BACCARAT_SIDE_BETS))throw new Error('INVALID_BET_TYPE');
    const stake=Number(v);if(!Number.isSafeInteger(stake)||stake<=0)throw new Error('INVALID_STAKE');
    return {betType,stake};
  }).sort((a,b)=>a.betType.localeCompare(b.betType));
}
export function resolveBaccarat(stake,betType,sourceDeck,rawSideBets,rand){
  if(!['PLAYER','BANKER','TIE'].includes(betType)) throw new Error('INVALID_BET_TYPE');
  const sides=validateBaccaratSideBets(rawSideBets);
  const deck=[...sourceDeck];
  if(deck.length<6) throw new Error('DECK_TOO_SHORT');
  const player=[deck.pop(),deck.pop()]; const banker=[deck.pop(),deck.pop()];
  const pairs={PLAYER_PAIR:isBaccaratPair(player),BANKER_PAIR:isBaccaratPair(banker)};
  let ps=baccaratScore(player),bs=baccaratScore(banker); let pThird=null,bThird=null;
  const trace={natural:false,playerRule:null,bankerRule:null,playerThirdValue:null};
  if(ps>=8||bs>=8){
    trace.natural=true;trace.playerRule='NATURAL_STAND';trace.bankerRule='NATURAL_STAND';
  } else {
    if(ps<=5){
      pThird=deck.pop();player.push(pThird);ps=baccaratScore(player);
      trace.playerRule='DRAW_0_TO_5';trace.playerThirdValue=baccaratCardValue(pThird);
    } else trace.playerRule='STAND_6_OR_7';
    const pt=trace.playerThirdValue;
    if(baccaratShouldBankerDraw(bs,pt)){
      bThird=deck.pop();banker.push(bThird);trace.bankerRule=pt===null?'DRAW_0_TO_5_NO_PLAYER_THIRD':'DRAW_BY_THIRD_CARD_TABLE';
    } else trace.bankerRule=pt===null?'STAND_6_OR_7_NO_PLAYER_THIRD':'STAND_BY_THIRD_CARD_TABLE';
    bs=baccaratScore(banker);
  }
  const winner=ps>bs?'PLAYER':bs>ps?'BANKER':'TIE';
  const mainPnl=baccaratPnl(stake,betType,winner,rand);
  const round={id:id('bac'),game:'Baccarat',stake,betType,winner,player:player.map(cardText),banker:banker.map(cardText),playerScore:ps,bankerScore:bs,netPnl:mainPnl,pairs,trace:{...trace,playerDrew:Boolean(pThird),bankerDrew:Boolean(bThird),winner,payoutRule:winner==='TIE'?(betType==='TIE'?'TIE_8_TO_1':'NON_TIE_PUSH'):betType===winner?(winner==='BANKER'?'BANKER_0_95_TO_1':'EVEN_MONEY'):'LOSS'}};
  if(!sides.length) return round;
  // With side bets, stake and netPnl cover the whole round; mainStake/mainPnl keep the main bet apart.
  const sideBets=sides.map(b=>{const won=pairs[b.betType];return {...b,won,netPnl:won?b.stake*BACCARAT_SIDE_BETS[b.betType]:-b.stake};});
  return {...round,stake:stake+sideBets.reduce((a,b)=>a+b.stake,0),mainStake:stake,mainPnl,sideBets,netPnl:mainPnl+sideBets.reduce((a,b)=>a+b.netPnl,0)};
}
export function playBaccarat(stake,betType,sideBets){return resolveBaccarat(stake,betType,freshDeck(8),sideBets);}

const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export function playRoulette(stake,betType,target=null,{lightning=null}={}){
  const strikes=lightningStrikes(lightning);
  const number=randInt(37); const color=number===0?'GREEN':RED.has(number)?'RED':'BLACK';
  let won=false,mult=0;
  if(betType==='NUMBER'){ if(!Number.isInteger(target)||target<0||target>36) throw new Error('INVALID_TARGET'); won=number===target;mult=straightMult(target,strikes); }
  else if(betType==='RED'||betType==='BLACK'){won=color===betType;mult=1;}
  else if(betType==='ODD'){won=number!==0&&number%2===1;mult=1;}
  else if(betType==='EVEN'){won=number!==0&&number%2===0;mult=1;}
  else if(betType==='LOW'){won=number>=1&&number<=18;mult=1;}
  else if(betType==='HIGH'){won=number>=19&&number<=36;mult=1;}
  else throw new Error('INVALID_BET_TYPE');
  return {id:id('rou'),game:'Roulette',stake,betType,target,number,color,...(strikes?{lightning:strikes}:{}),netPnl:won?stake*mult:-stake};
}

// 라이트닝 룰렛: before the ball drops, 1 to 5 distinct straight-up numbers are struck and each
// gets a multiplier. A straight-up win on a struck number returns stake × multiplier in total
// (so it nets multiplier − 1); every other straight-up win on that table pays 29:1. Outside,
// dozen and column bets pay as usual. Low multipliers and few strikes are the common case:
// with these weights a straight-up bet returns about 97.5%, the same ballpark as 97.3% on red.
export const LIGHTNING_STRAIGHT_MULT=29;
export const LIGHTNING_MULTIPLIERS=[[50,40],[100,30],[200,16],[300,8],[400,4],[500,2]];
export const LIGHTNING_STRIKE_COUNTS=[[1,40],[2,25],[3,17],[4,11],[5,7]];
function weighted(table,rand){
  const total=table.reduce((a,[,w])=>a+w,0);let r=rand(total);
  for(const [v,w] of table){if(r<w)return v;r-=w;}
  return table[table.length-1][0];
}
export function rollLightning(rand=randInt){
  const count=weighted(LIGHTNING_STRIKE_COUNTS,rand);const picked=new Set();
  while(picked.size<count)picked.add(rand(37));
  return [...picked].map(number=>({number,multiplier:weighted(LIGHTNING_MULTIPLIERS,rand)}));
}
// `lightning` is falsy (a plain table), true (roll the strikes now) or strikes already rolled.
function lightningStrikes(lightning){
  if(!lightning)return null;
  const strikes=lightning===true?rollLightning():lightning;
  const allowed=new Set(LIGHTNING_MULTIPLIERS.map(([m])=>m));
  if(!Array.isArray(strikes)||strikes.length<1||strikes.length>5)throw new Error('INVALID_LIGHTNING');
  const seen=new Set();
  for(const s of strikes){
    if(!Number.isInteger(s?.number)||s.number<0||s.number>36||seen.has(s.number)||!allowed.has(s.multiplier))throw new Error('INVALID_LIGHTNING');
    seen.add(s.number);
  }
  return strikes.map(s=>({number:s.number,multiplier:s.multiplier}));
}
// The net a winning straight-up bet earns per unit staked.
function straightMult(target,strikes){
  if(!strikes)return 35;
  const hit=strikes.find(s=>s.number===target);
  return hit?hit.multiplier-1:LIGHTNING_STRAIGHT_MULT;
}

// One spin, chips on as many spots as the player likes: straight numbers 35:1, dozens and
// columns 2:1, red/black, odd/even and low/high 1:1.
export const ROULETTE_MAX_SPOTS=40;
function rouletteBetWins(betType,target,number,color){
  if(betType==='NUMBER')return number===target;
  if(number===0)return false;
  if(betType==='RED'||betType==='BLACK')return color===betType;
  if(betType==='ODD')return number%2===1;
  if(betType==='EVEN')return number%2===0;
  if(betType==='LOW')return number<=18;
  if(betType==='HIGH')return number>=19;
  if(betType==='DOZEN')return Math.ceil(number/12)===target;
  if(betType==='COLUMN')return ((number-1)%3)+1===target;
  return false;
}
const ROULETTE_MULT={NUMBER:35,DOZEN:2,COLUMN:2,RED:1,BLACK:1,ODD:1,EVEN:1,LOW:1,HIGH:1};
export function validateRouletteBets(bets){
  if(!Array.isArray(bets)||bets.length<1||bets.length>ROULETTE_MAX_SPOTS)throw new Error('INVALID_BETS');
  const seen=new Set();
  return bets.map(b=>{
    const betType=String(b?.betType||'');const stake=Number(b?.stake);
    if(!(betType in ROULETTE_MULT))throw new Error('INVALID_BET_TYPE');
    if(!Number.isSafeInteger(stake)||stake<=0)throw new Error('INVALID_STAKE');
    let target=null;
    if(betType==='NUMBER'){target=Number(b.target);if(!Number.isInteger(target)||target<0||target>36)throw new Error('INVALID_TARGET');}
    if(betType==='DOZEN'||betType==='COLUMN'){target=Number(b.target);if(![1,2,3].includes(target))throw new Error('INVALID_TARGET');}
    const key=`${betType}:${target}`;if(seen.has(key))throw new Error('DUPLICATE_BET');seen.add(key);
    return {betType,target,stake};
  });
}
// `lightning`: falsy for the plain table, true to strike numbers now, or strikes already rolled.
// The strikes are always settled before the ball is chosen; the result is independent of them.
export function playRouletteBets(rawBets,number=randInt(37),lightning=null){
  const bets=validateRouletteBets(rawBets);
  const strikes=lightningStrikes(lightning);
  const color=number===0?'GREEN':RED.has(number)?'RED':'BLACK';
  const results=bets.map(b=>{
    const won=rouletteBetWins(b.betType,b.target,number,color);
    const mult=b.betType==='NUMBER'?straightMult(b.target,strikes):ROULETTE_MULT[b.betType];
    const struck=won&&b.betType==='NUMBER'&&strikes?.find(s=>s.number===b.target);
    return {...b,won,...(struck?{multiplier:struck.multiplier}:{}),netPnl:won?b.stake*mult:-b.stake};
  });
  const stake=bets.reduce((a,b)=>a+b.stake,0);
  return {id:id('rou'),game:'Roulette',stake,bets:results,number,color,...(strikes?{lightning:strikes}:{}),netPnl:results.reduce((a,r)=>a+r.netPnl,0)};
}

// The usual Macau table (2026-10-24 review: the old 18:1 on 5/16 returned only 53%).
export const SICBO_TOTAL_PAY={4:60,5:30,6:17,7:12,8:8,9:6,10:6,11:6,12:6,13:8,14:12,15:17,16:30,17:60};
export const SICBO_ANY_TRIPLE=30;
export function playSicBo(stake,betType,target=null){
  const dice=[randInt(6)+1,randInt(6)+1,randInt(6)+1], total=dice.reduce((a,b)=>a+b,0), triple=dice[0]===dice[1]&&dice[1]===dice[2];
  let won=false,mult=1;
  if(betType==='SMALL'){won=!triple&&total>=4&&total<=10;}
  else if(betType==='BIG'){won=!triple&&total>=11&&total<=17;}
  else if(betType==='ODD'){won=!triple&&total%2===1;}
  else if(betType==='EVEN'){won=!triple&&total%2===0;}
  else if(betType==='TOTAL'){
    if(!Number.isInteger(target)||target<4||target>17) throw new Error('INVALID_TARGET');
    won=total===target;mult=SICBO_TOTAL_PAY[target];
  } else if(betType==='ANY_TRIPLE'){won=triple;mult=SICBO_ANY_TRIPLE;}
  else throw new Error('INVALID_BET_TYPE');
  return {id:id('sic'),game:'Sic Bo',stake,betType,target,dice,total,triple,netPnl:won?stake*mult:-stake};
}
