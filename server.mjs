import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, mutate, publicUser } from './lib/store.mjs';
import { FLOORS, INITIAL_BANKROLL, STAKE_TIERS } from './lib/constants.mjs';
import { validateStakeAgainstFloor } from './lib/stakes.mjs';
import { autoRecharge, floorsFor, lockBet, increaseBetLock, rechargeStatus, requestRecharge, reviewRecharge, settleHouseGame, settleLockedHouseGame, totalBalance, addLedger } from './lib/economy.mjs';
import { buildRankingSnapshot } from './lib/rankings.mjs';
import { activeHybridSeason } from './lib/seasons.mjs';
import { buildSocialCompetitionSnapshot, createRival, archiveRival, createChallenge, acceptChallenge, cancelChallenge } from './lib/social-competition.mjs';
import { startBlackjack, blackjackAction, blackjackPublic, settleBlackjack, playBaccarat, playRoulette, playSicBo } from './lib/games.mjs';
import { startBlackjackV2, blackjackV2Action, blackjackV2ActionCost, blackjackV2Public, settleBlackjackV2 } from './lib/blackjack-v2.mjs';
import { activeBlackjackV2Round } from './lib/blackjack-session.mjs';
import { buildInfo } from './lib/build-info.mjs';
import { idempotentInstantRound, instantPublicRound, instantRequestFingerprint, normalizeIdempotencyKey } from './lib/instant-idempotency.mjs';

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
  return validateStakeAgainstFloor(user,floorBySlug(floorSlug),stake);
}
function summarize(state,user){
  const ledger=state.ledger.filter(x=>x.userId===user.id).slice(-50).reverse();
  const requests=state.rechargeRequests.filter(x=>x.userId===user.id).slice(0,10);
  const latestBust=user.bankruptcies?.[0]||null;
  const season=activeHybridSeason(state);
  return {
    user:publicUser(user),
    users:Object.values(state.users).map(publicUser),
    floors:floorsFor(user),
    stakeTiers:STAKE_TIERS.map(tier=>({...tier})),
    rankings:buildRankingSnapshot(state,season),
    socialCompetition:buildSocialCompetitionSnapshot(state,user.id),
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
    if(url.pathname==='/api/version'&&req.method==='GET') return json(res,200,buildInfo());
    if(url.pathname==='/api/state'&&req.method==='GET'){
      const state=await loadState(); return json(res,200,summarize(state,getUser(state,req)));
    }
    if(url.pathname==='/api/blackjack/v2/open'&&req.method==='GET'){
      const state=await loadState();const u=getUser(state,req);const round=activeBlackjackV2Round(state,u.id);
      return json(res,200,{round:round?blackjackV2Public(round,false):null,floor:round?.floor??null,state:summarize(state,u)});
    }
    if(url.pathname==='/api/social/rivals'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{const u=getUser(state,req);const rival=createRival(state,u.id,b.opponentId);return {rival,state:summarize(state,u)};});return json(res,201,out);
    }
    if(/^\/api\/social\/rivals\/[^/]+\/archive$/.test(url.pathname)&&req.method==='POST'){
      const rivalId=url.pathname.split('/')[4];const out=await mutate(state=>{const u=getUser(state,req);const rival=archiveRival(state,u.id,rivalId);return {rival,state:summarize(state,u)};});return json(res,200,out);
    }
    if(url.pathname==='/api/social/challenges'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{const u=getUser(state,req);const challenge=createChallenge(state,u.id,b.opponentId,b.metric);return {challenge,state:summarize(state,u)};});return json(res,201,out);
    }
    if(/^\/api\/social\/challenges\/[^/]+\/accept$/.test(url.pathname)&&req.method==='POST'){
      const challengeId=url.pathname.split('/')[4];const out=await mutate(state=>{const u=getUser(state,req);const challenge=acceptChallenge(state,u.id,challengeId);return {challenge,state:summarize(state,u)};});return json(res,200,out);
    }
    if(/^\/api\/social\/challenges\/[^/]+\/cancel$/.test(url.pathname)&&req.method==='POST'){
      const challengeId=url.pathname.split('/')[4];const out=await mutate(state=>{const u=getUser(state,req);const challenge=cancelChallenge(state,u.id,challengeId);return {challenge,state:summarize(state,u)};});return json(res,200,out);
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
    if(url.pathname==='/api/blackjack/v2/start'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{
        const u=getUser(state,req);const stake=Number(b.stake);const spots=Number(b.spots||1);validateStake(u,b.floor,stake);
        if(state.rounds.some(r=>r.userId===u.id&&r.game==='Blackjack'&&r.status!=='SETTLED')) throw new Error('OPEN_BLACKJACK_ROUND');
        const round=startBlackjackV2(stake,spots);round.userId=u.id;round.floor=b.floor||'strip';
        lockBet(state,u,{stake:round.stake,game:'Blackjack',roundId:round.id,metadata:{engineVersion:round.engineVersion,spots}});state.rounds.push(round);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjackV2(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:result.totalStake,netPnl:result.netPnl,roundId:round.id,details:{engineVersion:round.engineVersion,spots,outcomes:result.outcomes}});
          return {round:result.public,result:result.outcomes,netPnl:result.netPnl,state:summarize(state,u)};
        }
        return {round:blackjackV2Public(round,false),state:summarize(state,u)};
      });return json(res,200,out);
    }
    if(url.pathname==='/api/blackjack/v2/action'&&req.method==='POST'){
      const b=await body(req);const out=await mutate(state=>{
        const u=getUser(state,req);const round=state.rounds.find(r=>r.id===b.roundId&&r.userId===u.id&&r.game==='Blackjack'&&r.engineVersion==='MULTI_SPOT_V2');if(!round)throw new Error('ROUND_NOT_FOUND');
        const handIndex=Number(b.handIndex);const extra=blackjackV2ActionCost(round,b.action,handIndex);
        if(extra>0){if(u.account.available<extra)throw new Error('INSUFFICIENT_BANKROLL');increaseBetLock(state,u,{stake:extra,game:'Blackjack',roundId:round.id,metadata:{engineVersion:round.engineVersion,action:b.action,handIndex}});}
        blackjackV2Action(round,b.action,handIndex);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjackV2(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:result.totalStake,netPnl:result.netPnl,roundId:round.id,details:{engineVersion:round.engineVersion,spots:round.spots,outcomes:result.outcomes}});
          return {round:result.public,result:result.outcomes,netPnl:result.netPnl,state:summarize(state,u)};
        }
        return {round:blackjackV2Public(round,false),state:summarize(state,u)};
      });return json(res,200,out);
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
      const b=await body(req);const key=normalizeIdempotencyKey(req.headers['x-idempotency-key']);const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip';validateStake(u,b.floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Baccarat',stake,floor,betType:b.betType});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Baccarat',key,fingerprint,create:()=>({...playBaccarat(stake,b.betType),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Baccarat',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,winner:attempt.round.winner}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(res,200,out);
    }
    if(url.pathname==='/api/roulette/play'&&req.method==='POST'){
      const b=await body(req);const key=normalizeIdempotencyKey(req.headers['x-idempotency-key']);const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip',target=b.target===undefined?null:Number(b.target);validateStake(u,b.floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Roulette',stake,floor,betType:b.betType,target});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Roulette',key,fingerprint,create:()=>({...playRoulette(stake,b.betType,target),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Roulette',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,target,number:attempt.round.number}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(res,200,out);
    }
    if(url.pathname==='/api/sicbo/play'&&req.method==='POST'){
      const b=await body(req);const key=normalizeIdempotencyKey(req.headers['x-idempotency-key']);const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip',target=b.target===undefined?null:Number(b.target);validateStake(u,b.floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Sic Bo',stake,floor,betType:b.betType,target});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Sic Bo',key,fingerprint,create:()=>({...playSicBo(stake,b.betType,target),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Sic Bo',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,target,dice:attempt.round.dice}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(res,200,out);
    }
    if(url.pathname==='/api/dev/reset'&&req.method==='POST'&&process.env.NODE_ENV!=='production'){
      const out=await mutate(state=>{const u=getUser(state,req);state.ledger=state.ledger.filter(x=>x.userId!==u.id);state.rounds=state.rounds.filter(r=>r.userId!==u.id);state.rechargeRequests=state.rechargeRequests.filter(r=>r.userId!==u.id);u.account={available:0,locked:0,rawPnl:0,qualifiedPnl:0,totalWagered:0,peakBankroll:0,progressionValue:0,unlockedFloors:[]};u.recharge={lastAt:null,dailyDate:new Date().toISOString().slice(0,10),dailyCount:0,total:0};u.stats={};u.bankruptcies=[];addLedger(state,u,{type:'INITIAL_GRANT',amount:INITIAL_BANKROLL,referenceType:'DEV_RESET'});u.account.unlockedFloors=['downtown','strip'];return summarize(state,u);});return json(res,200,out);
    }
    return error(res,404,'NOT_FOUND');
  }catch(e){const map={FORBIDDEN:403,USER_NOT_FOUND:404,ROUND_NOT_FOUND:404,REQUEST_NOT_FOUND:404,RIVAL_NOT_FOUND:404,CHALLENGE_NOT_FOUND:404,INSUFFICIENT_BANKROLL:409,FLOOR_LOCKED:403,BET_OUTSIDE_TABLE_LIMIT:400,STAKE_TIER_NOT_ALLOWED:400,RECHARGE_NOT_AVAILABLE:409,PENDING_REQUEST_EXISTS:409,OPEN_BLACKJACK_ROUND:409,RIVAL_ALREADY_ACTIVE:409,RIVAL_NOT_ACTIVE:409,CHALLENGE_ALREADY_OPEN:409,CHALLENGE_NOT_PENDING:409,CHALLENGE_NOT_OPEN:409,INVALID_SOCIAL_TARGET:400,INVALID_CHALLENGE_METRIC:400,INVALID_IDEMPOTENCY_KEY:400,IDEMPOTENCY_CONFLICT:409};return error(res,map[e.message]||400,e.message||'BAD_REQUEST');}
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