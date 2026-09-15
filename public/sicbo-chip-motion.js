import { chipSettlement, chipStackMarkup } from './casino-chip-motion.js';

const ROOT='sv-sicbo-chip-motion';
const OPTIONS=['SMALL','BIG','ODD','EVEN','ANY_TRIPLE','TOTAL'];

export function sicBoBetLabel(betType,target=10){
  return betType==='TOTAL'?`TOTAL ${Number.isInteger(Number(target))?Number(target):10}`:String(betType||'BIG').replace('_',' ');
}

export function sicBoChipViewModel({stake=0,betType='BIG',target=10,round=null,pending=false}={}){
  const wager=Math.max(0,Number(stake)||0);
  const selection=sicBoBetLabel(betType,target);
  if(!round)return {stake:wager,betType,target,selection,phase:pending?'locked':'betting',settlement:null,total:null,dice:null};
  const settlement=chipSettlement(Number(round.netPnl)||0,wager);
  return {stake:wager,betType,target,selection,phase:'settled',settlement,total:Number(round.total),dice:Array.isArray(round.dice)?[...round.dice]:[],netPnl:Number(round.netPnl)||0};
}

const amountFrom=text=>{
  const s=String(text||'').replace(/,/g,'');
  const e=s.match(/([0-9.]+)억/),m=s.match(/([0-9.]+)만/);
  if(e)return Math.round(Number(e[1])*1e8);
  if(m)return Math.round(Number(m[1])*1e4);
  const n=s.match(/[0-9]+/);return n?Number(n[0]):0;
};
const selectedBet=()=>amountFrom(document.querySelector('[data-bet].on')?.textContent);
const selectedType=()=>document.querySelector('[data-choice^="sicbo:"].on')?.dataset.choice?.split(':')[1]||'BIG';
let current=null;

function scheduleMount(){queueMicrotask(()=>requestAnimationFrame(mount));}

function mount(){
  if(!document.querySelector('[data-choice^="sicbo:"]')){document.getElementById(ROOT)?.remove();current=null;return;}
  const stage=document.querySelector('.modal-body .stage');if(!stage)return;
  const source=current||{stake:selectedBet(),betType:selectedType(),target:10,round:null,pending:false};
  const vm=sicBoChipViewModel(source);
  let root=document.getElementById(ROOT);
  if(!root){root=document.createElement('section');root.id=ROOT;root.className='sicbo-chip-motion';stage.before(root);}
  const signature=JSON.stringify([vm.stake,vm.betType,vm.target,vm.phase,vm.total,vm.dice,vm.netPnl]);
  if(root.dataset.signature===signature)return;
  root.dataset.signature=signature;
  const settled=vm.phase==='settled',s=vm.settlement;
  const wagerMotion=vm.phase==='locked'?'hold':settled?s.wagerMotion:'place';
  const tiles=OPTIONS.map(type=>{
    const active=type===vm.betType,label=sicBoBetLabel(type,10);
    return `<div class="scm-tile${active?' active':''}${settled&&active?` ${s.kind}`:''}"><span>${label}</span>${active?chipStackMarkup({amount:vm.stake,minUnit:vm.stake||1,motion:wagerMotion,role:'wager',label:`${vm.stake.toLocaleString('ko-KR')} fictional CH wager on ${vm.selection}`}):''}</div>`;
  }).join('');
  const payout=settled&&s.kind==='win'?`<div class="scm-payout"><small>DEALER PAYOUT</small>${chipStackMarkup({amount:s.payoutAmount,minUnit:vm.stake||1,motion:'pay',role:'payout',label:`${s.payoutAmount.toLocaleString('ko-KR')} fictional CH Sic Bo profit`})}</div>`:'';
  const dice=settled&&vm.dice?.length?` · ${vm.dice.join('-')} = ${vm.total}`:'';
  const status=vm.phase==='locked'?'NO MORE BETS · DICE IN MOTION':!settled?'BETTING OPEN · SELECTED CHIPS ON TABLE':s.kind==='win'?`WIN${dice} · DEALER PAYS`:s.kind==='push'?`PUSH · STAKE RETURNED`:`LOSS${dice} · HOUSE SWEEPS WAGER`;
  root.innerHTML=`<div class="scm-head"><span>SIC BO CHIP TABLE</span><b>${status}</b></div><div class="scm-layout" aria-label="Sic Bo fictional CH betting layout">${tiles}</div>${payout}<p>FICTIONAL CH · NON-REDEEMABLE · settlement follows the authoritative server round.</p>`;
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function sicBoChipFetch(input,init){
    let isSicBo=false,payload=null;
    try{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      isSicBo=path==='/api/sicbo/play';
      if(isSicBo&&init?.body)payload=JSON.parse(init.body);
    }catch{}
    if(!isSicBo)return nativeFetch(input,init);
    current={stake:Number(payload?.stake)||selectedBet(),betType:payload?.betType||selectedType(),target:Number(payload?.target??10),round:null,pending:true};
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
  addEventListener('click',e=>{if(e.target.closest('[data-bet],[data-choice^="sicbo:"]')){current=null;scheduleMount();}});
  mount();
}
