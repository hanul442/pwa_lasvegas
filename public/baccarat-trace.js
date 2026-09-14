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
  if(!round.trace.natural)phases.push('PLAYER DECISION','BANKER DECISION');
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
  const steps=[...stage.querySelectorAll('.baccarat-deal-step')];
  steps.forEach(step=>step.classList.remove('visible'));
  const phaseNodes=[...stage.querySelectorAll('[data-baccarat-phase]')];
  const activatePhase=phase=>phaseNodes.forEach(node=>node.classList.toggle('active',node.dataset.phaseName===phase));
  const tick=index=>{
    if(!stage.isConnected)return;
    if(index<steps.length){
      const step=steps[index];
      step.classList.add('visible');
      activatePhase(step.dataset.phaseName||'INITIAL DEAL');
      sequenceTimer=setTimeout(()=>tick(index+1),180);
      return;
    }
    activatePhase('REVEAL');
    sequenceTimer=setTimeout(()=>activatePhase('SETTLEMENT'),220);
  };
  tick(0);
}

function render(round){
  const stage=document.querySelector('.modal-body .stage');
  if(!stage||!round?.trace)return;
  const vm=baccaratTraceViewModel(round);
  stage.querySelector('.baccarat-trace')?.remove();
  const panel=document.createElement('section');
  panel.className='baccarat-trace';
  panel.setAttribute('aria-label','Baccarat round explanation');
  panel.innerHTML=`<div class="baccarat-sequence" aria-label="Baccarat round phases">${vm.phases.map((phase,i)=>`<span data-baccarat-phase="${i}" data-phase-name="${phase}"><i>${i+1}</i>${phase}</span>`).join('')}</div><div class="baccarat-deal-strip" aria-label="Baccarat card deal order">${vm.dealOrder.map((step,i)=>`<div class="baccarat-deal-step" data-phase-name="${step.phase}" data-deal-step="${i}"><small>${step.side}</small><b>${step.card}</b></div>`).join('')}</div><div class="baccarat-trace-head"><span>ROUND EXPLANATION</span><b>${vm.winner}</b></div>${vm.rows.map((x,i)=>`<div class="baccarat-trace-row"><i>${i+1}</i><span>${x}</span></div>`).join('')}`;
  stage.append(panel);
  stage.querySelectorAll('.playing-card').forEach((card,i)=>{
    card.style.setProperty('--bac-delay',`${i*55}ms`);
    card.classList.add('baccarat-deal');
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
