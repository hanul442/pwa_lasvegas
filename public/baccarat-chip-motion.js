import { chipStackMarkup } from './casino-chip-motion.js';

const ROOT = 'sv-baccarat-chip-motion';
const amountFrom = text => {
  const s=String(text||'').replace(/,/g,'');
  const e=s.match(/([0-9.]+)억/), m=s.match(/([0-9.]+)만/);
  if(e) return Math.round(Number(e[1])*1e8);
  if(m) return Math.round(Number(m[1])*1e4);
  const n=s.match(/[0-9]+/); return n?Number(n[0]):0;
};
const selectedBet=()=>amountFrom(document.querySelector('[data-bet].on')?.textContent);
const selectedSide=()=>document.querySelector('[data-choice^="baccarat:"].on')?.dataset.choice?.split(':')[1]||'PLAYER';

function mount(){
  if(!document.querySelector('[data-choice^="baccarat:"]')) return document.getElementById(ROOT)?.remove();
  const stage=document.querySelector('.modal-body .stage'); if(!stage) return;
  let root=document.getElementById(ROOT);
  if(!root){ root=document.createElement('section'); root.id=ROOT; root.className='baccarat-chip-motion'; stage.before(root); }
  const stake=selectedBet(), side=selectedSide(), result=stage.querySelector('h3');
  const settled=Boolean(result), won=result?.classList.contains('good');
  const motion=settled?(won?'return':'sweep'):'place';
  const payout=settled&&won?Math.max(0,amountFrom(result.textContent.replace(/^.*?·/,''))):0;
  root.innerHTML=`<div class="bcm-board" aria-label="Baccarat fictional CH wager"><div><small>${side}</small>${chipStackMarkup({amount:stake,minUnit:stake||1,motion,role:'wager',label:`${stake.toLocaleString('ko-KR')} fictional CH wager on ${side}`})}</div>${payout?`<div class="bcm-house"><small>PAYOUT</small>${chipStackMarkup({amount:payout,minUnit:stake||1,motion:'pay',role:'payout',label:`${payout.toLocaleString('ko-KR')} fictional CH payout`})}</div>`:''}</div><p>${settled?(won?'WIN · dealer pushes fictional CH payout':'LOSS · house sweeps wager'):'BETTING · chips staged before deal'}</p>`;
}

const observer=new MutationObserver(()=>queueMicrotask(mount));
observer.observe(document.documentElement,{childList:true,subtree:true});
addEventListener('click',e=>{ if(e.target.closest('[data-bet],[data-choice^="baccarat:"]')) requestAnimationFrame(mount); });
mount();
