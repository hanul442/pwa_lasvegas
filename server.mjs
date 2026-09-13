import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, mutate, publicUser } from './lib/store.mjs';
import { FLOORS, INITIAL_BANKROLL, STAKE_TIERS, stakeTierFor } from './lib/constants.mjs';
import { autoRecharge, floorsFor, lockBet, increaseBetLock, ranking, rechargeStatus, requestRecharge, reviewRecharge, settleHouseGame, settleLockedHouseGame, totalBalance, addLedger } from './lib/economy.mjs';
import { startBlackjack, blackjackAction, blackjackPublic, settleBlackjack, playBaccarat, playRoulette, playSicBo } from './lib/games.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR=path.join(__dirname,'public');
const PORT=Number(process.env.PORT||3000);

function json(res,status,data){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}
function error(res,status,message){json(res,status,{error:message});}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100_000)throw new Error('PAYLOAD_TOO_LARGE');}return raw?JSON.parse(raw):{};}
function actorId(req){return req.headers['x-player-id']||'hanseo';}
function getUser(state,req){const u=state.users[actorId(req)];if(!u)throw new Error('USER_NOT_FOUND');return u;}
function floorBySlug(slug){return FLOORS.find(f=>f.slug===slug)||FLOORS[1];}
function validateStake(user,floorSlug,stake){
  const floor=floorBySlug(floorSlug);
  if(!user.account.unlockedFloors.includes(floor.slug)) throw new Error('FLOOR_LOCKED');
  if(!Number.isSafeInteger(stake)||stake<floor.minBet||stake>floor.maxBet) throw new Error('BET_OUTSIDE_TABLE_LIMIT');
  const tier=stakeTierFor(stake);
  if(!tier||!floor.stakeTiers.includes(tier.slug)) throw new Error('STAKE_TIER_NOT_ALLOWED');
  if(user.account.available<stake) throw new Error('INSUFFICIENT_BANKROLL');
  return {floor,tier};
}
function summarize(state,user){
  const ledger=state.ledger.filter(x=>x.userId===user.id).slice(-50).reverse();
  const requests=state.rechargeRequests.filter(x=>x.userId===user.id).slice(0,10);
  const latestBust=user.bankruptcies?.[0]||null;
  return {
    user:publicUser(user),
    users:Object.values(state.users).map(publicUser),
    floors:floorsFor(user),
    stakeTiers:STAKE_TIERS.map(tier=>({...tier})),
    rankings:{wealth:ranking(state,'wealth'),profit:ranking(state,'profit'),highRoller:ranking(state,'high-roller')},
    recharge:rechargeStatus(user),
    rechargeRequests:requests,
    adminRequests:user.isAdmin?state.rechargeRequests.filter(r=>r.status==='PENDING').map(r=>({...r,nickname:state.users[r.userId]?.nickname})):[],
    ledger,
    feed:state.feed.slice(0,30),
    latestBust,
    serverTime:new Date().toISOString()
  };
}

async function api(req,res,url){
  try{
    if(url.pathname==='/api/health') return json(res,200,{ok:true,service:'social-vegas',time:new Date().toISOString()});
    if(url.pathname==='/api/state'&&req.method==='GET'){
      const state=await loadState(); return json(res,200,summarize(state,getUser(state,req)));
    }
    if(url.pathname==='/api/recharge/auto'&&req.method==='POST'){
      const out=await mutate(state=>{const u=getUser(state,req);const result=autoRecharge(state,u);return {result,state:summarize(state,u)};});return json(res,200,out);
    }
    if(url.pathname==='/api/recharge/request'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{const u=getUser(state,req);const request=requestRecharge(state,u,Number(b.amount),b.reason);return {request,state:summarize(state,u)};});return json(res,200,out);
    }
    if(url.pathname.startsWith('/api/admin/recharge/')&&req.method==='POST'){
      const requestId=url.pathname.split('/').pop();const b=await body(req);const out=await mutate(state=>{const admin=getUser(state,req);const request=reviewRecharge(state,admin,requestId,b.decision,b.approvedAmount?Number(b.approvedAmount):null);return {request,state:summarize(state,admin)};});return json(res,200,out);
    }
    if(url.pathname==='/api/blackjack/start'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{
        const u=getUser(state,req);const stake=Number(b.stake);validateStake(u,b.floor,stake);
        if(state.rounds.some(r=>r.userId===u.id&&r.game==='Blackjack'&&r.status!=='SETTLED')) throw new Error('OPEN_BLACKJACK_ROUND');
        const round=startBlackjack(stake);round.userId=u.id;round.floor=b.floor||'strip';
        lockBet(state,u,{stake,game:'Blackjack',roundId:round.id});state.rounds.push(round);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjack(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:round.stake,netPnl:result.netPnl,roundId:round.id,details:{result:result.result}});
          return {round:result.public,result:result.result,netPnl:result.netPnl,state:summarize(state,u)};
        }
        return {round:blackjackPublic(round,false),state:summarize(state,u)};
      });return json(res,200,out);
    }
    if(url.pathname==='/api/blackjack/action'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{
        const u=getUser(state,req);const round=state.rounds.find(r=>r.id===b.roundId&&r.userId===u.id&&r.game==='Blackjack');if(!round)throw new Error('ROUND_NOT_FOUND');
        const extra=round.stake;
        if(b.action==='DOUBLE') { if(u.account.available<extra)throw new Error('INSUFFICIENT_BANKROLL'); increaseBetLock(state,u,{stake:extra,game:'Blackjack',roundId:round.id}); }
        blackjackAction(round,b.action,u.account.available>=0);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjack(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:round.stake,netPnl:result.netPnl,roundId:round.id,details:{result:result.result}});
          return {round:result.public,result:result.result,netPnl:result.netPnl,state:summarize(state,u)};
        }
        return {round:blackjackPublic(round,false),state:summarize(state,u)};
      });return json(res,200,out);
    }
    if(url.pathname==='/api/baccarat/play'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{const u=getUser(state,req);const stake=Number(b.stake);validateStake(u,b.floor,stake);const round=playBaccarat(stake,b.betType);state.rounds.push({...round,userId:u.id,floor:b.floor||'strip',status:'SETTLED',createdAt:new Date().toISOString()});settleHouseGame(state,u,{game:'Baccarat',stake,netPnl:round.netPnl,roundId:round.id,details:{betType:b.betType,winner:round.winner}});return {round,state:summarize(state,u)};});return json(res,200,out);
    }
    if(url.pathname==='/api/roulette/play'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{const u=getUser(state,req);const stake=Number(b.stake);validateStake(u,b.floor,stake);const round=playRoulette(stake,b.betType,b.target===undefined?null:Number(b.target));state.rounds.push({...round,userId:u.id,floor:b.floor||'strip',status:'SETTLED',createdAt:new Date().toISOString()});settleHouseGame(state,u,{game:'Roulette',stake,netPnl:round.netPnl,roundId:round.id,details:{betType:b.betType,target:b.target,number:round.number}});return {round,state:summarize(state,u)};});return json(res,200,out);
    }
    if(url.pathname==='/api/sicbo/play'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{const u=getUser(state,req);const stake=Number(b.stake);validateStake(u,b.floor,stake);const round=playSicBo(stake,b.betType,b.target===undefined?null:Number(b.target));state.rounds.push({...round,userId:u.id,floor:b.floor||'strip',status:'SETTLED',createdAt:new Date().toISOString()});settleHouseGame(state,u,{game:'Sic Bo',stake,netPnl:round.netPnl,roundId:round.id,details:{betType:b.betType,target:b.target,dice:round.dice}});return {round,state:summarize(state,u)};});return json(res,200,out);
    }
    if(url.pathname==='/api/dev/reset'&&req.method==='POST'&&process.env.NODE_ENV!=='production'){
      const out=await mutate(state=>{const u=getUser(state,req);state.ledger=state.ledger.filter(x=>x.userId!==u.id);state.rounds=state.rounds.filter(r=>r.userId!==u.id);state.rechargeRequests=state.rechargeRequests.filter(r=>r.userId!==u.id);u.account={available:0,locked:0,rawPnl:0,qualifiedPnl:0,totalWagered:0,peakBankroll:0,progressionValue:0,unlockedFloors:[]};u.recharge={lastAt:null,dailyDate:new Date().toISOString().slice(0,10),dailyCount:0,total:0};u.stats={};u.bankruptcies=[];addLedger(state,u,{type:'INITIAL_GRANT',amount:INITIAL_BANKROLL,referenceType:'DEV_RESET'});u.account.unlockedFloors=['downtown','strip'];return summarize(state,u);});return json(res,200,out);
    }
    return error(res,404,'NOT_FOUND');
  }catch(e){const map={FORBIDDEN:403,USER_NOT_FOUND:404,ROUND_NOT_FOUND:404,REQUEST_NOT_FOUND:404,INSUFFICIENT_BANKROLL:409,FLOOR_LOCKED:403,BET_OUTSIDE_TABLE_LIMIT:400,STAKE_TIER_NOT_ALLOWED:400,RECHARGE_NOT_AVAILABLE:409,PENDING_REQUEST_EXISTS:409,OPEN_BLACKJACK_ROUND:409};return error(res,map[e.message]||400,e.message||'BAD_REQUEST');}
}

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function serveStatic(req,res,url){
  let rel=url.pathname==='/'?'index.html':url.pathname.slice(1);
  rel=path.normalize(rel).replace(/^\.\.(\/|\\|$)/,'');
  const file=path.join(PUBLIC_DIR,rel);
  if(!file.startsWith(PUBLIC_DIR))return error(res,403,'FORBIDDEN');
  try{const data=await fs.readFile(file);res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':path.extname(file)==='.html'?'no-store':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'same-origin'});res.end(data);}catch{return error(res,404,'NOT_FOUND');}
}

const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/api/'))return api(req,res,url);return serveStatic(req,res,url);});
server.listen(PORT,'0.0.0.0',()=>console.log(`SOCIAL VEGAS listening on http://0.0.0.0:${PORT}`));
