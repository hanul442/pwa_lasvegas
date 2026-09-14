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

function render(round){
  const stage=document.querySelector('.modal-body .stage');
  if(!stage||!round?.trace)return;
  stage.querySelector('.baccarat-trace')?.remove();
  const panel=document.createElement('section');
  panel.className='baccarat-trace';
  panel.innerHTML=`<div class="baccarat-trace-head"><span>ROUND EXPLANATION</span><b>${round.winner}</b></div>${describeBaccaratTrace(round).map((x,i)=>`<div class="baccarat-trace-row"><i>${i+1}</i><span>${x}</span></div>`).join('')}`;
  stage.append(panel);
  stage.querySelectorAll('.playing-card').forEach((card,i)=>{card.style.setProperty('--bac-delay',`${i*70}ms`);card.classList.add('baccarat-deal')});
}

const nativeFetch=window.fetch.bind(window);
window.fetch=async function baccaratTraceFetch(input,init){
  const response=await nativeFetch(input,init);
  try{
    const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
    if(path==='/api/baccarat/play'&&response.ok){
      const clone=response.clone();
      const data=await clone.json();
      queueMicrotask(()=>requestAnimationFrame(()=>render(data.round)));
    }
  }catch{}
  return response;
};
