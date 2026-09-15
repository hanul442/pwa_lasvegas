const BLACKJACK_POST_PATHS=new Set([
  '/api/blackjack/v2/start',
  '/api/blackjack/v2/action',
  '/api/blackjack/start',
  '/api/blackjack/action'
]);
const V2_RECOVERY_PATH='/api/blackjack/v2/open';
const PREFIX='sv-blackjack-command';
const memoryKeys=new Map();

function requestPath(input){
  try{
    if(typeof input==='string')return new URL(input,location.href).pathname;
    if(input instanceof URL)return input.pathname;
    if(input?.url)return new URL(input.url,location.href).pathname;
  }catch{}
  return null;
}
function requestMethod(input,init){return String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();}
function requestHeaders(input,init){return new Headers(init?.headers||(input instanceof Request?input.headers:undefined));}
function playerFrom(headers){return headers.get('x-player-id')||'hanseo';}
function slot(path,player){return `${PREFIX}:${player}:${path}`;}
function freshKey(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  return `bj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`;
}
function readKey(name){
  try{return sessionStorage.getItem(name)||memoryKeys.get(name)||null;}catch{return memoryKeys.get(name)||null;}
}
function writeKey(name,key){
  memoryKeys.set(name,key);
  try{sessionStorage.setItem(name,key);}catch{}
}
function clearKey(name){
  memoryKeys.delete(name);
  try{sessionStorage.removeItem(name);}catch{}
}
function pendingKey(name){
  const current=readKey(name);
  if(current)return current;
  const key=freshKey();writeKey(name,key);return key;
}
function clearV2Pending(player){
  clearKey(slot('/api/blackjack/v2/start',player));
  clearKey(slot('/api/blackjack/v2/action',player));
}
async function responseIsReadable(response){
  try{await response.clone().json();return true;}catch{return false;}
}

if(typeof window!=='undefined'&&typeof fetch==='function'){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function blackjackIdempotentFetch(input,init={}){
    const path=requestPath(input),method=requestMethod(input,init),headers=requestHeaders(input,init),player=playerFrom(headers);
    if(path===V2_RECOVERY_PATH&&method==='GET'){
      const response=await nativeFetch(input,init);
      if(response.ok&&await responseIsReadable(response))clearV2Pending(player);
      return response;
    }
    if(!BLACKJACK_POST_PATHS.has(path)||method!=='POST')return nativeFetch(input,init);
    const name=slot(path,player),managed=!headers.has('x-idempotency-key');
    if(managed)headers.set('x-idempotency-key',pendingKey(name));
    const response=await nativeFetch(input,{...init,headers});
    if(managed){
      if(response.ok){if(await responseIsReadable(response))clearKey(name);}
      else if(response.status>=400&&response.status<500)clearKey(name);
    }
    return response;
  };
}
