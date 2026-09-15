const INSTANT_PATHS=new Set(['/api/baccarat/play','/api/roulette/play','/api/sicbo/play']);
const PREFIX='sv-instant-request';
const memoryKeys=new Map();

function requestPath(input){
  try{
    if(typeof input==='string')return new URL(input,location.href).pathname;
    if(input instanceof URL)return input.pathname;
    if(input?.url)return new URL(input.url,location.href).pathname;
  }catch{}
  return null;
}

function playerFrom(input,init){
  try{
    const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
    return headers.get('x-player-id')||'hanseo';
  }catch{return 'hanseo';}
}

function slot(path,player){return `${PREFIX}:${player}:${path}`;}
function freshKey(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`;
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
  const existing=readKey(name);
  if(existing)return existing;
  const key=freshKey();writeKey(name,key);return key;
}

if(typeof window!=='undefined'&&typeof fetch==='function'){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function instantIdempotentFetch(input,init={}){
    const path=requestPath(input);
    if(!INSTANT_PATHS.has(path)||(init.method||'GET').toUpperCase()!=='POST')return nativeFetch(input,init);
    const player=playerFrom(input,init),name=slot(path,player);
    const headers=new Headers(init.headers||(input instanceof Request?input.headers:undefined));
    if(!headers.has('x-idempotency-key'))headers.set('x-idempotency-key',pendingKey(name));
    try{
      const response=await nativeFetch(input,{...init,headers});
      if(response.ok||(response.status>=400&&response.status<500))clearKey(name);
      return response;
    }catch(error){
      throw error;
    }
  };
}
