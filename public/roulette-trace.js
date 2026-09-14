const RED_NUMBERS=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

export function rouletteFacts(number){
  if(!Number.isInteger(number)||number<0||number>36)throw new Error('INVALID_ROULETTE_NUMBER');
  const color=number===0?'GREEN':RED_NUMBERS.has(number)?'RED':'BLACK';
  return {number,color,parity:number===0?'NONE':number%2?'ODD':'EVEN',range:number===0?'NONE':number<=18?'LOW':'HIGH'};
}

export function describeRouletteRound(round){
  if(!round||!Number.isInteger(round.number))return [];
  const f=rouletteFacts(round.number),bet=round.betType,target=round.target;
  const selection=bet==='NUMBER'?`NUMBER ${target}`:bet;
  let rule='';
  if(bet==='NUMBER')rule=round.number===target?'Exact number hit · pays 35:1.':'Exact number missed.';
  else if(bet==='RED'||bet==='BLACK')rule=`Result color is ${f.color}.`;
  else if(bet==='ODD'||bet==='EVEN')rule=round.number===0?'Zero is neither odd nor even.':`Result parity is ${f.parity}.`;
  else if(bet==='LOW'||bet==='HIGH')rule=round.number===0?'Zero is outside 1–18 / 19–36.':`Result range is ${f.range==='LOW'?'1–18':'19–36'}.`;
  return [
    `Bet: ${selection}.`,
    `Winning pocket: ${round.number} · ${f.color}.`,
    rule,
    round.netPnl>0?`Round won · +${round.netPnl.toLocaleString()} CH.`:`Round lost · ${round.netPnl.toLocaleString()} CH.`
  ].filter(Boolean);
}

export function rouletteTraceViewModel(round){
  const facts=rouletteFacts(round.number);
  return {facts,rows:describeRouletteRound(round),won:Number(round.netPnl)>0,netPnl:Number(round.netPnl||0)};
}

function render(round){
  const stage=document.querySelector('.modal-body .stage');
  if(!stage||!Number.isInteger(round?.number))return;
  const vm=rouletteTraceViewModel(round);
  stage.querySelector('.roulette-audit')?.remove();
  const panel=document.createElement('section');
  panel.className=`roulette-audit ${vm.won?'win':'loss'}`;
  panel.setAttribute('aria-label','Roulette round explanation');
  panel.innerHTML=`<div class="roulette-motion" aria-hidden="true"><div class="roulette-rotor"><i></i><b>${vm.facts.number}</b></div><div class="roulette-ball"></div></div><div class="roulette-audit-head"><span>ROUND AUDIT</span><b>${vm.facts.color} ${vm.facts.number}</b></div>${vm.rows.map((row,i)=>`<div class="roulette-audit-row"><i>${i+1}</i><span>${row}</span></div>`).join('')}`;
  stage.append(panel);
  requestAnimationFrame(()=>panel.classList.add('settled'));
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function rouletteTraceFetch(input,init){
    const response=await nativeFetch(input,init);
    try{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      if(path==='/api/roulette/play'&&response.ok){
        const data=await response.clone().json();
        queueMicrotask(()=>requestAnimationFrame(()=>render(data.round)));
      }
    }catch{}
    return response;
  };
}
