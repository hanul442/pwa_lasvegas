function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(value){const n=Number(value||0);const e=Math.floor(n/1e8),m=Math.floor((n%1e8)/1e4),r=Math.floor(n%1e4);let out=e?`${e.toLocaleString()}억`:'';if(m)out+=`${out?' ':''}${m.toLocaleString()}만`;if(!out&&r)out=r.toLocaleString();return out||'0';}
const TABLES=[
  {id:'obsidian-blackjack',game:'Blackjack',name:'Obsidian Blackjack',tag:'MULTI-SPOT · SPLIT · DOUBLE'},
  {id:'rouge-baccarat',game:'Baccarat',name:'Rouge Baccarat',tag:'NATURAL · THIRD-CARD AUDIT'},
  {id:'zero-chamber',game:'Roulette',name:'Zero Chamber',tag:'EUROPEAN · SINGLE ZERO'},
  {id:'dragon-dice',game:'Sic Bo',name:'Dragon Dice',tag:'TRIPLE · TOTAL · BIG/SMALL'}
];
function safeRecord(record){if(!record||typeof record.nickname!=='string'||!Number.isFinite(Number(record.value)))return null;return{nickname:record.nickname,value:Number(record.value)};}
export function vaultRecordRoomModel(state){
  const vault=Array.isArray(state?.floors)?state.floors.find(f=>f.slug==='vault'):null;
  const records=state?.rankings?.records;
  if(!vault||!records)return{enabled:false};
  const vip=records.vip||{};
  return{
    enabled:true,
    unlocked:Boolean(vault.unlocked),
    threshold:Number(vault.threshold||0),
    remaining:Number(vault.remaining||0),
    progress:Math.max(0,Math.min(1,Number(vault.progress||0))),
    minBet:Number(vault.minBet||0),
    maxBet:Number(vault.maxBet||0),
    records:[
      ['WEALTH',safeRecord(vip.wealth||records.wealth)],
      ['QUALIFIED PROFIT',safeRecord(vip.profit||records.profit)],
      ['HIGH ROLLER',safeRecord(vip.highRoller||records.highRoller)],
      ['PEAK BANKROLL',safeRecord(vip.peakBankroll||records.peakBankroll)]
    ].filter(([,r])=>r),
    tables:TABLES.map(t=>({...t}))
  };
}
function html(model){if(!model.enabled)return'';return `<section id="vault-record-room" class="vault-record-room ${model.unlocked?'unlocked':'locked'}"><div class="vault-hero"><div><small>TOP FLOOR · SPECIAL ACCESS</small><h2>THE VAULT</h2><p>${model.unlocked?'Access granted. The record room and signature tables are open.':`${fmt(model.remaining)} CH progression remains before permanent access.`}</p></div><span>${model.unlocked?'ACCESS GRANTED':'LOCKED'}</span></div><div class="vault-progress"><div><i style="width:${Math.max(2,model.progress*100)}%"></i></div><small>${fmt(model.minBet)}–${fmt(model.maxBet)} CH · VIP stakes only</small></div><div class="vault-layout"><article class="vault-panel"><header><small>HALL OF RECORDS</small><b>All-time prestige</b></header><div class="vault-record-grid">${model.records.map(([label,r])=>`<div><span>${esc(label)}</span><b>${esc(r.nickname)}</b><strong>${fmt(r.value)} CH</strong></div>`).join('')}</div></article><article class="vault-panel"><header><small>SIGNATURE TABLES</small><b>Special floor roster</b></header><div class="vault-table-list">${model.tables.map(t=>`<div><span>${esc(t.game)}</span><b>${esc(t.name)}</b><small>${esc(t.tag)}</small></div>`).join('')}</div></article></div><p class="vault-disclaimer">Prestige records only. CH is fictional, non-redeemable game currency with no cash value or exchange rate.</p></section>`;}
async function fetchState(){const playerId=localStorage.getItem('sv-player')||'hanseo';const response=await fetch('/api/state',{headers:{'x-player-id':playerId}});if(!response.ok)throw new Error('VAULT_STATE_FAILED');return response.json();}
let decorating=false;
async function decorate(){if(decorating)return;const content=document.querySelector('.content');const heading=content?.querySelector('.head h1');if(!content||heading?.textContent?.trim()!=='Vegas Floors'||content.querySelector('#vault-record-room'))return;decorating=true;try{const state=await fetchState();const model=vaultRecordRoomModel(state);const markup=html(model);if(markup)content.insertAdjacentHTML('beforeend',markup);}catch{}finally{decorating=false;}}
if(typeof document!=='undefined'){let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(async()=>{queued=false;await decorate();});};addEventListener('DOMContentLoaded',schedule,{once:true});new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});}
