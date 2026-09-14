const TOTAL_PAYOUT={4:50,5:18,6:14,7:12,8:8,9:6,10:6,11:6,12:6,13:8,14:12,15:14,16:18,17:50};

export function sicBoFacts(dice){
  if(!Array.isArray(dice)||dice.length!==3||dice.some(d=>!Number.isInteger(d)||d<1||d>6))throw new Error('INVALID_SICBO_DICE');
  const total=dice.reduce((a,b)=>a+b,0),triple=dice[0]===dice[1]&&dice[1]===dice[2];
  return {dice:[...dice],total,triple,parity:total%2?'ODD':'EVEN',range:total<=10?'SMALL':total>=11?'BIG':'NONE'};
}

export function describeSicBoRound(round){
  if(!round||!Array.isArray(round.dice))return [];
  const f=sicBoFacts(round.dice),bet=round.betType,target=round.target;
  const selection=bet==='TOTAL'?`TOTAL ${target}`:String(bet||'');
  let rule='';
  if(bet==='SMALL')rule=f.triple?'Triple overrides SMALL.':`${f.total} is ${f.total>=4&&f.total<=10?'inside':'outside'} SMALL (4–10).`;
  else if(bet==='BIG')rule=f.triple?'Triple overrides BIG.':`${f.total} is ${f.total>=11&&f.total<=17?'inside':'outside'} BIG (11–17).`;
  else if(bet==='ODD'||bet==='EVEN')rule=f.triple?`Triple overrides ${bet}.`:`Total parity is ${f.parity}.`;
  else if(bet==='ANY_TRIPLE')rule=f.triple?'All three dice match · pays 24:1.':'Dice are not a triple.';
  else if(bet==='TOTAL')rule=f.total===target?`Exact total hit · pays ${TOTAL_PAYOUT[target]}:1.`:`Exact total missed · result was ${f.total}.`;
  return [
    `Bet: ${selection}.`,
    `Dice: ${f.dice.join(' + ')} = ${f.total}.`,
    f.triple?`Triple detected: ${f.dice[0]}-${f.dice[1]}-${f.dice[2]}.`:'No triple.',
    rule,
    Number(round.netPnl)>0?`Round won · +${Number(round.netPnl).toLocaleString()} CH.`:`Round lost · ${Number(round.netPnl||0).toLocaleString()} CH.`
  ].filter(Boolean);
}

export function sicBoTraceViewModel(round){
  const facts=sicBoFacts(round.dice);
  return {facts,rows:describeSicBoRound(round),won:Number(round.netPnl)>0,netPnl:Number(round.netPnl||0)};
}

const face=n=>['⚀','⚁','⚂','⚃','⚄','⚅'][n-1];
function render(round){
  const stage=document.querySelector('.modal-body .stage');
  if(!stage||!Array.isArray(round?.dice))return;
  const vm=sicBoTraceViewModel(round);
  stage.querySelector('.sicbo-audit')?.remove();
  const panel=document.createElement('section');
  panel.className=`sicbo-audit ${vm.won?'win':'loss'}`;
  panel.setAttribute('aria-label','Sic Bo round explanation');
  panel.innerHTML=`<div class="sicbo-cup" aria-hidden="true"><div class="sicbo-cup-lid">SIC BO</div><div class="sicbo-dice">${vm.facts.dice.map((d,i)=>`<i style="--die:${i}">${face(d)}</i>`).join('')}</div></div><div class="sicbo-audit-head"><span>ROUND AUDIT</span><b>${vm.facts.total}${vm.facts.triple?' · TRIPLE':''}</b></div>${vm.rows.map((row,i)=>`<div class="sicbo-audit-row"><i>${i+1}</i><span>${row}</span></div>`).join('')}`;
  stage.append(panel);
  requestAnimationFrame(()=>panel.classList.add('settled'));
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function sicBoTraceFetch(input,init){
    const response=await nativeFetch(input,init);
    try{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      if(path==='/api/sicbo/play'&&response.ok){
        const data=await response.clone().json();
        queueMicrotask(()=>requestAnimationFrame(()=>render(data.round)));
      }
    }catch{}
    return response;
  };
}
