import { chipSettlement, chipStackMarkup } from './casino-chip-motion.js';

const ROOT='sv-roulette-chip-motion';
const OPTIONS=['RED','BLACK','ODD','EVEN','LOW','HIGH','NUMBER'];

export function rouletteBetLabel(betType,target=17){
  return betType==='NUMBER'?`NUMBER ${Number.isInteger(Number(target))?Number(target):17}`:String(betType||'RED');
}

export function rouletteChipViewModel({stake=0,betType='RED',target=17,round=null,pending=false}={}){
  const wager=Math.max(0,Number(stake)||0);
  const selection=rouletteBetLabel(betType,target);
  if(!round)return {stake:wager,betType,target,selection,phase:pending?'locked':'betting',settlement:null,number:null,color:null};
  const settlement=chipSettlement(Number(round.netPnl)||0,wager);
  return {stake:wager,betType,target,selection,phase:'settled',settlement,number:Number(round.number),color:String(round.color||''),netPnl:Number(round.netPnl)||0};
}

const amountFrom=text=>{
  const s=String(text||'').replace(/,/g,'');
  const e=s.match(/([0-9.]+)억/),m=s.match(/([0-9.]+)만/);
  if(e)return Math.round(Number(e[1])*1e8);
  if(m)return Math.round(Number(m[1])*1e4);
  const n=s.match(/[0-9]+/);return n?Number(n[0]):0;
};
const selectedBet=()=>amountFrom(document.querySelector('[data-bet].on')?.textContent);
const selectedType=()=>document.querySelector('[data-choice^="roulette:"].on')?.dataset.choice?.split(':')[1]||'RED';
let current=null;

function scheduleMount(){queueMicrotask(()=>requestAnimationFrame(mount));}

function mount(){
  if(!document.querySelector('[data-choice^="roulette:"]')){document.getElementById(ROOT)?.remove();current=null;return;}
  const stage=document.querySelector('.modal-body .stage');if(!stage)return;
  const source=current||{stake:selectedBet(),betType:selectedType(),target:17,round:null,pending:false};
  const vm=rouletteChipViewModel(source);
  let root=document.getElementById(ROOT);
  if(!root){root=document.createElement('section');root.id=ROOT;root.className='roulette-chip-motion';stage.before(root);}
  const signature=JSON.stringify([vm.stake,vm.betType,vm.target,vm.phase,vm.number,vm.color,vm.netPnl]);
  if(root.dataset.signature===signature)return;
  root.dataset.signature=signature;
  const settled=vm.phase==='settled',s=vm.settlement;
  const wagerMotion=vm.phase==='locked'?'hold':settled?s.wagerMotion:'place';
  const tiles=OPTIONS.map(type=>{
    const active=type===vm.betType,label=rouletteBetLabel(type,17);
    const extra=type==='RED'?' red':type==='BLACK'?' black':type==='NUMBER'?' number':'';
    return `<div class="rcm-tile${active?' active':''}${extra}${settled&&active?` ${s.kind}`:''}"><span>${label}</span>${active?chipStackMarkup({amount:vm.stake,minUnit:vm.stake||1,motion:wagerMotion,role:'wager',label:`${vm.stake.toLocaleString('ko-KR')} fictional CH wager on ${vm.selection}`}):''}</div>`;
  }).join('');
  const payout=settled&&s.kind==='win'?`<div class="rcm-payout"><small>DEALER PAYOUT</small>${chipStackMarkup({amount:s.payoutAmount,minUnit:vm.stake||1,motion:'pay',role:'payout',label:`${s.payoutAmount.toLocaleString('ko-KR')} fictional CH roulette profit`})}</div>`:'';
  const status=vm.phase==='locked'?'NO MORE BETS · WHEEL SPINNING':!settled?'BETTING OPEN · SELECTED CHIPS ON LAYOUT':s.kind==='win'?`WIN · ${vm.color} ${vm.number} · DEALER PAYS`:s.kind==='push'?`PUSH · STAKE RETURNED`:`LOSS · ${vm.color} ${vm.number} · HOUSE SWEEPS WAGER`;
  root.innerHTML=`<div class="rcm-head"><span>ROULETTE CHIP TABLE</span><b>${status}</b></div><div class="rcm-layout" aria-label="Roulette fictional CH betting layout">${tiles}</div>${payout}<p>FICTIONAL CH · NON-REDEEMABLE · settlement follows the authoritative server round.</p>`;
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function rouletteChipFetch(input,init){
    let isRoulette=false,payload=null;
    try{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      isRoulette=path==='/api/roulette/play';
      if(isRoulette&&init?.body)payload=JSON.parse(init.body);
    }catch{}
    if(!isRoulette)return nativeFetch(input,init);
    current={stake:Number(payload?.stake)||selectedBet(),betType:payload?.betType||selectedType(),target:Number(payload?.target??17),round:null,pending:true};
    scheduleMount();
    const response=await nativeFetch(input,init);
    try{
      if(response.ok){const data=await response.clone().json();current={...current,pending:false,round:data.round};}
      else current=null;
    }catch{current=null;}
    scheduleMount();
    return response;
  };
  const observer=new MutationObserver(scheduleMount);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('click',e=>{if(e.target.closest('[data-bet],[data-choice^="roulette:"]')){current=null;scheduleMount();}});
  mount();
}
