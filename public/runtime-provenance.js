const ROOT_ID='runtime-provenance';

export function normalizeRuntimeVersion(v={}){
  return {
    commit:v.commit||v.gitCommit||null,
    branch:v.branch||v.gitBranch||null,
    deploymentId:v.deploymentId||v.deployment_id||null,
    environment:v.environment||null,
    provenanceAvailable:Boolean(v.provenanceAvailable??v.commit??v.gitCommit)
  };
}

export function runtimeStatus(version){
  const v=normalizeRuntimeVersion(version);
  if(!v.provenanceAvailable||!v.commit)return {kind:'warn',label:'PROVENANCE UNAVAILABLE',detail:'Runtime revision cannot be verified.'};
  return {kind:'ok',label:'RUNTIME IDENTIFIED',detail:`${v.commit.slice(0,12)}${v.branch?` · ${v.branch}`:''}`};
}

function esc(s){return String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function card(version,error=''){
  const v=normalizeRuntimeVersion(version),s=error?{kind:'bad',label:'VERSION CHECK FAILED',detail:error}:runtimeStatus(v);
  return `<article id="${ROOT_ID}" class="runtime-proof ${s.kind}"><div class="runtime-proof-head"><div><small>DEPLOYMENT PROVENANCE</small><h2>${esc(s.label)}</h2><p>${esc(s.detail)}</p></div><button type="button" data-runtime-refresh>REFRESH</button></div><dl><div><dt>COMMIT</dt><dd>${esc(v.commit)}</dd></div><div><dt>BRANCH</dt><dd>${esc(v.branch)}</dd></div><div><dt>DEPLOYMENT</dt><dd>${esc(v.deploymentId)}</dd></div><div><dt>ENVIRONMENT</dt><dd>${esc(v.environment)}</dd></div></dl><p class="runtime-proof-note">Read-only diagnostics. This panel never changes bankroll, games, ledger, or deployment state.</p></article>`;
}

async function fetchVersion(){
  const r=await fetch('/api/version',{headers:{accept:'application/json'},cache:'no-store'});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function mount(){
  if(!document.querySelector('.content'))return;
  const isControl=[...document.querySelectorAll('[data-page]')].some(b=>b.classList.contains('active')&&b.dataset.page==='admin');
  if(!isControl){document.getElementById(ROOT_ID)?.remove();return;}
  if(document.getElementById(ROOT_ID))return;
  const host=document.querySelector('.content');
  host.insertAdjacentHTML('beforeend',card({}));
  try{document.getElementById(ROOT_ID)?.remove();host.insertAdjacentHTML('beforeend',card(await fetchVersion()));}
  catch(e){document.getElementById(ROOT_ID)?.remove();host.insertAdjacentHTML('beforeend',card({},e.message));}
}

document.addEventListener('click',e=>{
  if(e.target.closest?.('[data-runtime-refresh]')){document.getElementById(ROOT_ID)?.remove();mount();return;}
  if(e.target.closest?.('[data-page="admin"]'))setTimeout(mount,0);
},true);

new MutationObserver(()=>mount()).observe(document.getElementById('app'),{childList:true,subtree:true});
mount();
