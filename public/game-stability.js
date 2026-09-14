const PATH_TO_GAME=new Map([
  ['/api/baccarat/play','baccarat'],
  ['/api/roulette/play','roulette'],
  ['/api/sicbo/play','sicbo']
]);
const busy=new Set();
const nativeFetch=window.fetch.bind(window);

function requestPath(input){
  try{
    if(typeof input==='string')return new URL(input,location.href).pathname;
    if(input instanceof URL)return input.pathname;
    if(input?.url)return new URL(input.url,location.href).pathname;
  }catch{}
  return null;
}

function setBusy(game,on){
  if(on)document.body.dataset.busyGame=game;
  else if(document.body.dataset.busyGame===game)delete document.body.dataset.busyGame;
  document.querySelectorAll(`[data-play="${game}"]`).forEach(button=>{
    button.disabled=on;
    button.setAttribute('aria-busy',on?'true':'false');
    if(on){
      button.dataset.stableLabel=button.textContent;
      button.textContent=game==='roulette'?'SPINNING…':game==='sicbo'?'ROLLING…':'DEALING…';
    }else if(button.dataset.stableLabel){
      button.textContent=button.dataset.stableLabel;
      delete button.dataset.stableLabel;
    }
  });
}

window.fetch=async function guardedFetch(input,init){
  const path=requestPath(input);
  const game=PATH_TO_GAME.get(path);
  if(!game)return nativeFetch(input,init);
  if(busy.has(game))throw new Error('GAME_REQUEST_IN_PROGRESS');
  busy.add(game);setBusy(game,true);
  try{return await nativeFetch(input,init);}
  finally{busy.delete(game);setBusy(game,false);}
};

document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-play]');
  if(!button)return;
  const game=button.dataset.play;
  if(!busy.has(game))return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
},true);
