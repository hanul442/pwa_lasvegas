import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, mutate } from './lib/store.mjs';
import { handleApi, prepareState } from './lib/api.mjs';
import { runPushRound, runNightlyRound } from './lib/notifications.mjs';
import { previewFor, injectPreview, isInvitePath } from './lib/link-preview.mjs';
import { findByRef } from './lib/referral.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR=path.join(__dirname,'public');
const PORT=Number(process.env.PORT||3000);
const store={load:loadState,mutate};

function error(res,status,message){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify({error:message}));
}
async function readBody(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100_000)throw new Error('PAYLOAD_TOO_LARGE');}return raw?JSON.parse(raw):{};}
async function api(req,res,url){
  const {status,data}=await handleApi({method:req.method,header:name=>req.headers[name],body:()=>readBody(req)},url,store,{...process.env,AUTH_REQUIRED:true});
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.mp3':'audio/mpeg','.m4a':'audio/mp4','.woff2':'font/woff2'};
async function serveStatic(req,res,url){
  let rel=url.pathname==='/'?'index.html':url.pathname.slice(1);
  rel=path.normalize(rel).replace(/^\.\.(\/|\\|$)/,'');
  const file=path.join(PUBLIC_DIR,rel);
  if(!file.startsWith(PUBLIC_DIR))return error(res,403,'FORBIDDEN');
  try{const data=await fs.readFile(file);res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':path.extname(file)==='.html'||rel==='sw.js'?'no-store':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'same-origin'});res.end(data);}catch{return error(res,404,'NOT_FOUND');}
}

// Invite links (/j): the page with the inviter's link preview, as worker/index.mjs serves it.
async function invitePage(req,res,url){
  const html=await fs.readFile(path.join(PUBLIC_DIR,'index.html'),'utf8');const p=url.searchParams;
  const inviter=findByRef(await loadState(),p.get('r'))?.nickname||null;
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(injectPreview(html,previewFor({inviter,game:p.get('g'),tier:p.get('t'),code:String(p.get('join')||'').toUpperCase()},url.origin),url.href));
}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/'))return api(req,res,url);if(isInvitePath(url.pathname))return invitePage(req,res,url);return serveStatic(req,res,url);});
server.listen(PORT,'0.0.0.0',()=>console.log(`SOCIAL VEGAS listening on http://0.0.0.0:${PORT}`));
// Same hourly reminder round the Worker's cron runs.
// Like the cron, it runs on the hour, as that hour's 핫 테이블 opens (lib/hot-table.mjs).
const pushRound=()=>runPushRound(store,{prepare:prepareState}).catch(e=>console.error('push round',e));
const HOUR=60*60*1000;
setTimeout(()=>{pushRound();setInterval(pushRound,HOUR).unref();},HOUR-Date.now()%HOUR+2000).unref();
// The Worker's evening minute cron (밤 9시 토너먼트); cheap enough to run all day here.
setInterval(()=>runNightlyRound(store,{prepare:prepareState}).catch(e=>console.error('nightly round',e)),60*1000).unref();
