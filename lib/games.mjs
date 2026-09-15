import crypto from 'node:crypto';
import { id } from './store.mjs';

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
  if(!['READY_TO_SETTLE','PLAYER'].includes(round.status)) throw new Error('BAD_STATE');
  const p=bjValue(round.player); let d=bjValue(round.dealer);
  const pNatural=round.player.length===2&&p.total===21&&!round.doubled;
  const dNatural=round.dealer.length===2&&d.total===21;
  let netPnl=0,result='PUSH';
  if(p.total>21){netPnl=-round.stake;result='BUST';}
  else if(dNatural){netPnl=pNatural?0:-round.stake;result=pNatural?'PUSH':'DEALER_BLACKJACK';}
  else if(pNatural){netPnl=Math.floor(round.stake*1.5);result='BLACKJACK';}
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
function baccaratPnl(stake,betType,winner){
  if(winner==='TIE'&&betType!=='TIE') return 0;
  if(winner!==betType) return -stake;
  if(betType==='PLAYER') return stake;
  if(betType==='BANKER') return Math.floor(stake*0.95);
  return stake*8;
}
export function resolveBaccarat(stake,betType,sourceDeck){
  if(!['PLAYER','BANKER','TIE'].includes(betType)) throw new Error('INVALID_BET_TYPE');
  const deck=[...sourceDeck];
  if(deck.length<6) throw new Error('DECK_TOO_SHORT');
  const player=[deck.pop(),deck.pop()]; const banker=[deck.pop(),deck.pop()];
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
  const netPnl=baccaratPnl(stake,betType,winner);
  return {id:id('bac'),game:'Baccarat',stake,betType,winner,player:player.map(cardText),banker:banker.map(cardText),playerScore:ps,bankerScore:bs,netPnl,trace:{...trace,playerDrew:Boolean(pThird),bankerDrew:Boolean(bThird),winner,payoutRule:winner==='TIE'?(betType==='TIE'?'TIE_8_TO_1':'NON_TIE_PUSH'):betType===winner?(winner==='BANKER'?'BANKER_0_95_TO_1':'EVEN_MONEY'):'LOSS'}};
}
export function playBaccarat(stake,betType){return resolveBaccarat(stake,betType,freshDeck(8));}

const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export function playRoulette(stake,betType,target=null){
  const number=randInt(37); const color=number===0?'GREEN':RED.has(number)?'RED':'BLACK';
  let won=false,mult=0;
  if(betType==='NUMBER'){ if(!Number.isInteger(target)||target<0||target>36) throw new Error('INVALID_TARGET'); won=number===target;mult=35; }
  else if(betType==='RED'||betType==='BLACK'){won=color===betType;mult=1;}
  else if(betType==='ODD'){won=number!==0&&number%2===1;mult=1;}
  else if(betType==='EVEN'){won=number!==0&&number%2===0;mult=1;}
  else if(betType==='LOW'){won=number>=1&&number<=18;mult=1;}
  else if(betType==='HIGH'){won=number>=19&&number<=36;mult=1;}
  else throw new Error('INVALID_BET_TYPE');
  return {id:id('rou'),game:'Roulette',stake,betType,target,number,color,netPnl:won?stake*mult:-stake};
}

export function playSicBo(stake,betType,target=null){
  const dice=[randInt(6)+1,randInt(6)+1,randInt(6)+1], total=dice.reduce((a,b)=>a+b,0), triple=dice[0]===dice[1]&&dice[1]===dice[2];
  let won=false,mult=1;
  if(betType==='SMALL'){won=!triple&&total>=4&&total<=10;}
  else if(betType==='BIG'){won=!triple&&total>=11&&total<=17;}
  else if(betType==='ODD'){won=!triple&&total%2===1;}
  else if(betType==='EVEN'){won=!triple&&total%2===0;}
  else if(betType==='TOTAL'){
    if(!Number.isInteger(target)||target<4||target>17) throw new Error('INVALID_TARGET');
    const pay={4:50,5:18,6:14,7:12,8:8,9:6,10:6,11:6,12:6,13:8,14:12,15:14,16:18,17:50};won=total===target;mult=pay[target];
  } else if(betType==='ANY_TRIPLE'){won=triple;mult=24;}
  else throw new Error('INVALID_BET_TYPE');
  return {id:id('sic'),game:'Sic Bo',stake,betType,target,dice,total,triple,netPnl:won?stake*mult:-stake};
}