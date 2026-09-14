export function describeBaccaratTrace(round){
  const t=round?.trace;
  if(!t)return [];
  const out=[];
  if(t.natural) out.push('Natural 8/9: both sides stand.');
  else {
    out.push(t.playerDrew?`Player drew a third card (${t.playerThirdValue}).`:'Player stood on the initial two cards.');
    out.push(t.bankerDrew?'Banker drew according to the third-card table.':'Banker stood according to the third-card table.');
  }
  const payout={TIE_8_TO_1:'Tie bet pays 8:1.',NON_TIE_PUSH:'Tie result: Player/Banker bets push.',BANKER_0_95_TO_1:'Banker win pays 0.95:1 after commission.',EVEN_MONEY:'Winning side pays 1:1.',LOSS:'Selected side lost.'}[t.payoutRule];
  if(payout)out.push(payout);
  out.push(`Final: Player ${round.playerScore} · Banker ${round.bankerScore} · ${round.winner}.`);
  return out;
}

export function baccaratDealOrder(round){
  const player=round?.player||[],banker=round?.banker||[],out=[];
  if(player[0])out.push({side:'PLAYER',card:player[0],phase:'INITIAL DEAL'});
  if(banker[0])out.push({side:'BANKER',card:banker[0],phase:'INITIAL DEAL'});
  if(player[1])out.push({side:'PLAYER',card:player[1],phase:'INITIAL DEAL'});
  if(banker[1])out.push({side:'BANKER',card:banker[1],phase:'INITIAL DEAL'});
  if(player[2])out.push({side:'PLAYER',card:player[2],phase:'PLAYER DECISION'});
  if(banker[2])out.push({side:'BANKER',card:banker[2],phase:'BANKER DECISION'});
  return out;
}

export function baccaratSequencePhases(round){
  if(!round?.trace)return [];
  const phases=['INITIAL DEAL'];
  if(!round.trace.natural){
    phases.push('PLAYER DECISION','BANKER DECISION');
  }
  phases.push('REVEAL','SETTLEMENT');
  return phases;
}

export function baccaratTraceViewModel(round){
  return {
    winner:round?.winner||'',
    rows:describeBaccaratTrace(round),
    cards:[...(round?.player||[]),...(round?.banker||[])],
    dealOrder:baccaratDealOrder(round),
    phases:baccaratSequencePhases(round)
  };
}

let sequenceTimer=null;
function runSequence(stage,vm){
  clearTimeout(sequenceTimer);
  const cards=[...stage.querySelectorAll('.playing-card')];
  cards.forEach(card=>card.classList.remove('baccarat-visible'));
  stage.dataset.baccaratPhase='0';
  const phaseNodes=[...stage.querySelectorAll('[data-baccarat-phase]')];
  const tick=step=>{
    if(!stage.isConnected)return;
    const visible=Math.min(cards.length,step);
    cards.forEach((card,i)=>card.classList.toggle('baccarat-visible',i<visible));
    const phaseIndex=Math.min(vm.phases.length-1,Math.floor(step/Math.max(1,Math.ceil(cards.length/vm.phases.length))));
    stage.dataset.baccaratPhase=String(phaseIndex);
    phaseNodes.forEach((node,i)=>node.classList.toggle('active',i===phaseIndex));
    if(step<cards.length+2)sequenceTimer=setTimeout(()=>tick(step+1),160);
    else phaseNodes.forEach((node,i)=>node.classList.toggle('active',i===vm.phases.length-1));
  };
  tick(1);
}

function render(round){
  const stage=document.querySelector('.modal-body .stage');
  if(!stage||!round?.trace)return;
  const vm=baccaratTraceViewModel(round);
  stage.querySelector('.baccarat-trace')?.remove();
  const panel=document.createElement('section');
  panel.className='baccarat-trace';
  panel.setAttribute('aria-label','Baccarat round explanation');
  panel.innerHTML=`<div class="baccarat-sequence" aria-label="Baccarat deal sequence">${vm.phases.map((phase,i)=>`<span data-baccarat-phase="${i}"><i>${i+1}</i>${phase}</span>`).join('')}</div><div class="baccarat-trace-head"><span>ROUND EXPLANATION</span><b>${vm.winner}</b></div>${vm.rows.map((x,i)=>`<div class="baccarat-trace-row"><i>${i+1}</i><span>${x}</span></div>`).join('')}`;
  stage.append(panel);
  stage.querySelectorAll('.playing-card').forEach((card,i)=>{
    card.style.setProperty('--bac-delay',`${i*55}ms`);
    card.classList.add('baccarat-deal');
    card.setAttribute('data-deal-index',String(i));
  });
  runSequence(stage,vm);
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function baccaratTraceFetch(input,init){
    const response=await nativeFetch(input,init);
    try{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      if(path==='/api/baccarat/play'&&response.ok){
        const data=await response.clone().json();
        queueMicrotask(()=>requestAnimationFrame(()=>render(data.round)));
      }
    }catch{}
    return response;
  };
}
