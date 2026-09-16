// VEGAS UI V2 visual adapter.
// Keeps existing game/account behavior intact and decorates each render with the approved brand system.
const V2_LOGO='/assets/vegas-logo.svg';
const gameKeys={blackjack:'blackjack',roulette:'roulette',baccarat:'baccarat','sic bo':'sicbo',"texas hold'em":'holdem','섯다':'seotda','맞고':'matgo',slots:'slots','vip lounge':'vip'};
const navIcons=['⌂','◆','♛','◇','◎','⚙'];
const liveRooms=new Set(['blackjack','roulette','baccarat','sicbo']);
let queued=false;
function gameKeyFromTitle(text=''){
  const t=text.trim().toLowerCase();
  return gameKeys[t]||Object.entries(gameKeys).find(([label])=>t.includes(label))?.[1]||t.replace(/[^a-z0-9가-힣]+/g,'-');
}
function decorateBrand(){
  const brand=document.querySelector('.brand');
  if(brand&&!brand.querySelector('.vegas-brand-lockup')){
    brand.insertAdjacentHTML('afterbegin',`<div class="vegas-brand-lockup"><img class="vegas-brand-wordmark" src="${V2_LOGO}" alt="VEGAS"><small>PRIVATE TABLE CLUB</small></div>`);
  }
  document.querySelectorAll('.sidebar nav button').forEach((button,index)=>{
    if(!button.dataset.v2Icon) button.dataset.v2Icon=navIcons[index]||'•';
  });
}
function decorateHome(){
  const content=document.querySelector('.content');
  if(!content) return;
  const head=content.querySelector(':scope > .head:first-child');
  const title=head?.querySelector('h1');
  if(head&&title&&!head.querySelector('.vegas-hero-wordmark')){
    const img=document.createElement('img');
    img.className='vegas-hero-wordmark';img.src=V2_LOGO;img.alt='VEGAS';
    title.before(img);
    const kicker=head.querySelector('span');if(kicker&&/CASINO HOME/i.test(kicker.textContent)) kicker.textContent='WELCOME TO VEGAS';
  }
  const section=content.querySelector('.game-grid')?.closest('.block')?.querySelector('.section-title h2');
  if(section&&section.textContent.trim()==='TABLES') section.textContent='PLAY NOW';
  content.querySelectorAll('.game-grid .game').forEach(card=>{
    const h3=card.querySelector('h3');if(!h3)return;
    const key=gameKeyFromTitle(h3.textContent);
    card.dataset.v2Game=key;
    if(!card.querySelector('.vegas-game-art')){
      const art=document.createElement('div');art.className='vegas-game-art';
      const icon=card.querySelector('.game-icon');
      if(icon) icon.before(art); else card.prepend(art);
    }
  });
}
function decorateModal(){
  document.querySelectorAll('.overlay .modal').forEach(modal=>{
    modal.classList.add('vegas-game-modal');
    const title=modal.querySelector('header h2')?.textContent||'';
    const key=gameKeyFromTitle(title);
    modal.dataset.v2Game=key;
    modal.classList.toggle('v2-live-room',liveRooms.has(key));
    modal.classList.toggle('v2-win',Boolean(modal.querySelector('.stage .good,.stage h3.good')));
    modal.classList.toggle('v2-loss',Boolean(modal.querySelector('.stage .bad,.stage h3.bad')));
    const close=modal.querySelector('[data-close]');
    if(close&&!close.getAttribute('aria-label')) close.setAttribute('aria-label','게임 닫기');
    const phase=modal.querySelector('.roulette')?'roulette-result':modal.querySelector('.dice')?'dice-result':modal.querySelector('.playing-card')?'card-table':'ready';
    modal.dataset.v2Phase=phase;
  });
}
function decorate(){
  document.body.classList.add('vegas-v2');
  document.documentElement.style.colorScheme='dark';
  const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.setAttribute('content','#050505');
  if(document.title==='SOCIAL VEGAS') document.title='VEGAS';
  decorateBrand();decorateHome();decorateModal();
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate()})}
new MutationObserver(schedule).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
window.addEventListener('DOMContentLoaded',schedule,{once:true});
schedule();
