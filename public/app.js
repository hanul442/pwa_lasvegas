document.documentElement.dataset.vegasUi='clean-shell';

const surfaces=[...document.querySelectorAll('[data-surface]')];
const navItems=[...document.querySelectorAll('[data-nav]')];
let lastLobbyTrigger=null;

function showSurface(name,{focus=false}={}){
  const target=surfaces.find(surface=>surface.dataset.surface===name);
  if(!target)return;
  surfaces.forEach(surface=>surface.classList.toggle('is-active',surface===target));
  navItems.forEach(item=>item.classList.toggle('is-active',item.dataset.nav===name));
  document.body.classList.toggle('game-mode',name==='table');
  window.scrollTo({top:0,behavior:'auto'});
  if(focus){const heading=target.querySelector('h1');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});}
}

navItems.forEach(item=>item.addEventListener('click',()=>showSurface(item.dataset.nav,{focus:true})));

document.querySelectorAll('[data-game]').forEach(button=>button.addEventListener('click',()=>{
  lastLobbyTrigger=button;
  const title=document.querySelector('#table-title');
  title.textContent=button.querySelector('strong')?.textContent||'Table';
  history.pushState({vegasSurface:'table'},'',`#table-${button.dataset.game}`);
  showSurface('table',{focus:true});
}));

function leaveTable({useHistory=true}={}){
  if(!document.body.classList.contains('game-mode'))return;
  if(useHistory&&history.state?.vegasSurface==='table'){history.back();return;}
  showSurface('lobby');
  lastLobbyTrigger?.focus({preventScroll:true});
}

document.querySelector('[data-back]')?.addEventListener('click',()=>leaveTable());
window.addEventListener('popstate',()=>leaveTable({useHistory:false}));
window.addEventListener('keydown',event=>{if(event.key==='Escape')leaveTable();});

showSurface('lobby');
