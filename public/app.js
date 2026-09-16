document.documentElement.dataset.vegasUi='clean-shell';

const surfaces=[...document.querySelectorAll('[data-surface]')];
const navItems=[...document.querySelectorAll('[data-nav]')];
let lastTrigger=null;
let selectedGame=null;

function showSurface(name,{focus=false}={}){
  const target=surfaces.find(surface=>surface.dataset.surface===name);
  if(!target)return;
  surfaces.forEach(surface=>surface.classList.toggle('is-active',surface===target));
  navItems.forEach(item=>item.classList.toggle('is-active',item.dataset.nav===name));
  document.body.classList.toggle('game-mode',name==='table'||name==='tiers');
  window.scrollTo({top:0,behavior:'auto'});
  if(focus){const heading=target.querySelector('h1');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});}
}

navItems.forEach(item=>item.addEventListener('click',()=>showSurface(item.dataset.nav,{focus:true})));

function chooseGame(button){
  lastTrigger=button;
  selectedGame=button.dataset.game;
  document.querySelector('#tier-game-name').textContent=(button.querySelector('strong')?.textContent||selectedGame)+' · select virtual CH range';
  history.pushState({vegasSurface:'tiers'},'',`#tiers-${selectedGame}`);
  showSurface('tiers',{focus:true});
}

document.querySelectorAll('[data-game]').forEach(button=>button.addEventListener('click',()=>chooseGame(button)));

document.querySelectorAll('[data-tier]').forEach(button=>button.addEventListener('click',()=>{
  if(!selectedGame)return;
  const gameName=selectedGame.toUpperCase();
  const tier=button.dataset.tier.toUpperCase();
  document.querySelector('#table-title').textContent=gameName;
  document.querySelector('#table-tier').textContent=`${tier} · LIVE TABLE`;
  document.querySelector('#table-stake').textContent=`${button.querySelector('span').textContent}`;
  history.pushState({vegasSurface:'table'},'',`#table-${selectedGame}-${button.dataset.tier}`);
  showSurface('table',{focus:true});
}));

function restoreTrigger(){lastTrigger?.focus({preventScroll:true});}
function leaveTable({useHistory=true}={}){
  if(!document.body.classList.contains('game-mode'))return;
  if(useHistory&&(history.state?.vegasSurface==='table'||history.state?.vegasSurface==='tiers')){history.back();return;}
  showSurface('games');restoreTrigger();
}

document.querySelector('[data-back]')?.addEventListener('click',()=>leaveTable());
document.querySelector('[data-tier-back]')?.addEventListener('click',()=>leaveTable());
window.addEventListener('popstate',event=>{
  if(event.state?.vegasSurface==='tiers'){showSurface('tiers',{focus:true});return;}
  if(event.state?.vegasSurface==='table'){showSurface('table',{focus:true});return;}
  if(document.body.classList.contains('game-mode')){showSurface('games');restoreTrigger();}
});
window.addEventListener('keydown',event=>{if(event.key==='Escape')leaveTable();});

showSurface('lobby');
