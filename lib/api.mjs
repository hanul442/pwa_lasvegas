// Game API routes, independent of the HTTP runtime (Node server or Cloudflare Worker).
import { publicUser } from './state.mjs';
import { FLOORS, INITIAL_BANKROLL, STAKE_TIERS } from './constants.mjs';
import { validateStakeAgainstFloor } from './stakes.mjs';
import { autoRecharge, floorsFor, lockBet, increaseBetLock, rechargeStatus, requestRecharge, reviewRecharge, settleHouseGame, settleLockedHouseGame, totalBalance, addLedger } from './economy.mjs';
import { buildRankingSnapshot } from './rankings.mjs';
import { activeHybridSeason } from './seasons.mjs';
import { buildSocialCompetitionSnapshot, createRival, archiveRival, createChallenge, acceptChallenge, cancelChallenge } from './social-competition.mjs';
import { startBlackjack, blackjackAction, blackjackPublic, settleBlackjack, playBaccarat, playRoulette, playSicBo } from './games.mjs';
import { startBlackjackV2, blackjackV2Action, blackjackV2ActionCost, blackjackV2Public, settleBlackjackV2 } from './blackjack-v2.mjs';
import { activeBlackjackV2Round } from './blackjack-session.mjs';
import { buildInfo } from './build-info.mjs';
import { handleCardRoom } from './card-room.mjs';
import { idempotentInstantRound, instantPublicRound, instantRequestFingerprint, normalizeIdempotencyKey } from './instant-idempotency.mjs';
import { blackjackActionFingerprint, blackjackStartFingerprint, findBlackjackStartReplay, isBlackjackCommandReplay, recordBlackjackCommand, tagBlackjackStart } from './blackjack-idempotency.mjs';


const LEGACY_BLACKJACK_ENGINE='LEGACY_V1';
const V2_BLACKJACK_ENGINE='MULTI_SPOT_V2';

const json=(status,data)=>({status,data});
const error=(status,message)=>json(status,{error:message});
function actorId(req){return req.header('x-player-id')||'hanseo';}
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
function blackjackV2Response(round,state,user,replayed=false){
  const settled=round.status==='SETTLED';
  const view=blackjackV2Public(round,settled);
  const out={round:view,replayed,state:summarize(state,user)};
  if(settled){
    out.result=view.hands.map(h=>({handId:h.id,spot:h.spot,result:h.result?.result,netPnl:h.result?.netPnl,playerValue:h.value}));
    out.netPnl=round.netPnl;
  }
  return out;
}
function legacyBlackjackResponse(round,state,user,replayed=false){
  const settled=round.status==='SETTLED';
  const out={round:blackjackPublic(round,settled),replayed,state:summarize(state,user)};
  if(settled){out.result=round.result?.result??null;out.netPnl=round.result?.netPnl??0;}
  return out;
}

// req: {method, header(name), body()}; store: {load(), mutate(fn)}; env: plain object of settings.
export async function handleApi(req,url,store,env={}){
  const loadState=()=>store.load(),mutate=fn=>store.mutate(fn);
  try{
    if(url.pathname==='/api/health') return json(200,{ok:true,service:'social-vegas',time:new Date().toISOString()});
    if(url.pathname==='/api/version'&&req.method==='GET') return json(200,buildInfo(env));
    if(url.pathname==='/api/state'&&req.method==='GET'){
      const state=await loadState(); return json(200,summarize(state,getUser(state,req)));
    }
    const cardRoom=await handleCardRoom(req,url,{mutate,loadState,getUser,summarize,validateStake});
    if(cardRoom) return cardRoom;
    if(url.pathname==='/api/blackjack/v2/open'&&req.method==='GET'){
      const state=await loadState();const u=getUser(state,req);const round=activeBlackjackV2Round(state,u.id);
      return json(200,{round:round?blackjackV2Public(round,false):null,floor:round?.floor??null,state:summarize(state,u)});
    }
    if(url.pathname==='/api/social/rivals'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const rival=createRival(state,u.id,b.opponentId);return {rival,state:summarize(state,u)};});return json(201,out);
    }
    if(/^\/api\/social\/rivals\/[^/]+\/archive$/.test(url.pathname)&&req.method==='POST'){
      const rivalId=url.pathname.split('/')[4];const out=await mutate(state=>{const u=getUser(state,req);const rival=archiveRival(state,u.id,rivalId);return {rival,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/social/challenges'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const challenge=createChallenge(state,u.id,b.opponentId,b.metric);return {challenge,state:summarize(state,u)};});return json(201,out);
    }
    if(/^\/api\/social\/challenges\/[^/]+\/accept$/.test(url.pathname)&&req.method==='POST'){
      const challengeId=url.pathname.split('/')[4];const out=await mutate(state=>{const u=getUser(state,req);const challenge=acceptChallenge(state,u.id,challengeId);return {challenge,state:summarize(state,u)};});return json(200,out);
    }
    if(/^\/api\/social\/challenges\/[^/]+\/cancel$/.test(url.pathname)&&req.method==='POST'){
      const challengeId=url.pathname.split('/')[4];const out=await mutate(state=>{const u=getUser(state,req);const challenge=cancelChallenge(state,u.id,challengeId);return {challenge,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/recharge/auto'&&req.method==='POST'){
      const out=await mutate(state=>{const u=getUser(state,req);const result=autoRecharge(state,u);return {result,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/recharge/request'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const request=requestRecharge(state,u,Number(b.amount),b.reason);return {request,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname.startsWith('/api/admin/recharge/')&&req.method==='POST'){
      const requestId=url.pathname.split('/').pop();const b=await req.body();const out=await mutate(state=>{const admin=getUser(state,req);const request=reviewRecharge(state,admin,requestId,b.decision,b.approvedAmount?Number(b.approvedAmount):null);return {request,state:summarize(state,admin)};});return json(200,out);
    }
    if(url.pathname==='/api/blackjack/v2/start'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),spots=Number(b.spots||1),floor=b.floor||'strip';
        const fingerprint=blackjackStartFingerprint({engineVersion:V2_BLACKJACK_ENGINE,stake,spots,floor});
        const replay=findBlackjackStartReplay(state,{userId:u.id,key,fingerprint,engineVersion:V2_BLACKJACK_ENGINE});
        if(replay)return blackjackV2Response(replay,state,u,true);
        validateStake(u,b.floor,stake);
        if(state.rounds.some(r=>r.userId===u.id&&r.game==='Blackjack'&&r.status!=='SETTLED')) throw new Error('OPEN_BLACKJACK_ROUND');
        const round=startBlackjackV2(stake,spots);round.userId=u.id;round.floor=floor;tagBlackjackStart(round,key,fingerprint);
        lockBet(state,u,{stake:round.stake,game:'Blackjack',roundId:round.id,metadata:{engineVersion:round.engineVersion,spots}});state.rounds.push(round);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjackV2(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:result.totalStake,netPnl:result.netPnl,roundId:round.id,details:{engineVersion:round.engineVersion,spots,outcomes:result.outcomes}});
        }
        return blackjackV2Response(round,state,u,false);
      });return json(200,out);
    }
    if(url.pathname==='/api/blackjack/v2/action'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);const round=state.rounds.find(r=>r.id===b.roundId&&r.userId===u.id&&r.game==='Blackjack'&&r.engineVersion===V2_BLACKJACK_ENGINE);if(!round)throw new Error('ROUND_NOT_FOUND');
        const handIndex=Number(b.handIndex);const fingerprint=blackjackActionFingerprint({engineVersion:V2_BLACKJACK_ENGINE,roundId:round.id,handIndex,action:b.action});
        if(isBlackjackCommandReplay(round,key,fingerprint))return blackjackV2Response(round,state,u,true);
        const extra=blackjackV2ActionCost(round,b.action,handIndex);
        if(extra>0){if(u.account.available<extra)throw new Error('INSUFFICIENT_BANKROLL');increaseBetLock(state,u,{stake:extra,game:'Blackjack',roundId:round.id,metadata:{engineVersion:round.engineVersion,action:b.action,handIndex}});}
        blackjackV2Action(round,b.action,handIndex);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjackV2(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:result.totalStake,netPnl:result.netPnl,roundId:round.id,details:{engineVersion:round.engineVersion,spots:round.spots,outcomes:result.outcomes}});
        }
        recordBlackjackCommand(round,key,fingerprint);
        return blackjackV2Response(round,state,u,false);
      });return json(200,out);
    }
    if(url.pathname==='/api/blackjack/start'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip';
        const fingerprint=blackjackStartFingerprint({engineVersion:LEGACY_BLACKJACK_ENGINE,stake,spots:1,floor});
        const replay=findBlackjackStartReplay(state,{userId:u.id,key,fingerprint,engineVersion:LEGACY_BLACKJACK_ENGINE});
        if(replay)return legacyBlackjackResponse(replay,state,u,true);
        validateStake(u,b.floor,stake);
        if(state.rounds.some(r=>r.userId===u.id&&r.game==='Blackjack'&&r.status!=='SETTLED')) throw new Error('OPEN_BLACKJACK_ROUND');
        const round=startBlackjack(stake);round.userId=u.id;round.floor=floor;tagBlackjackStart(round,key,fingerprint);
        lockBet(state,u,{stake,game:'Blackjack',roundId:round.id});state.rounds.push(round);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjack(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:round.stake,netPnl:result.netPnl,roundId:round.id,details:{result:result.result}});
        }
        return legacyBlackjackResponse(round,state,u,false);
      });return json(200,out);
    }
    if(url.pathname==='/api/blackjack/action'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);const round=state.rounds.find(r=>r.id===b.roundId&&r.userId===u.id&&r.game==='Blackjack'&&(!r.engineVersion||r.engineVersion===LEGACY_BLACKJACK_ENGINE));if(!round)throw new Error('ROUND_NOT_FOUND');
        const engineVersion=round.engineVersion||LEGACY_BLACKJACK_ENGINE;const fingerprint=blackjackActionFingerprint({engineVersion,roundId:round.id,handIndex:null,action:b.action});
        if(isBlackjackCommandReplay(round,key,fingerprint))return legacyBlackjackResponse(round,state,u,true);
        const extra=round.stake;
        if(b.action==='DOUBLE') { if(u.account.available<extra)throw new Error('INSUFFICIENT_BANKROLL'); increaseBetLock(state,u,{stake:extra,game:'Blackjack',roundId:round.id}); }
        blackjackAction(round,b.action,u.account.available>=0);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjack(round);settleLockedHouseGame(state,u,{game:'Blackjack',stake:round.stake,netPnl:result.netPnl,roundId:round.id,details:{result:result.result}});
        }
        recordBlackjackCommand(round,key,fingerprint);
        return legacyBlackjackResponse(round,state,u,false);
      });return json(200,out);
    }
    if(url.pathname==='/api/baccarat/play'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip';validateStake(u,b.floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Baccarat',stake,floor,betType:b.betType});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Baccarat',key,fingerprint,create:()=>({...playBaccarat(stake,b.betType),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Baccarat',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,winner:attempt.round.winner}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/roulette/play'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip',target=b.target===undefined?null:Number(b.target);validateStake(u,b.floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Roulette',stake,floor,betType:b.betType,target});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Roulette',key,fingerprint,create:()=>({...playRoulette(stake,b.betType,target),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Roulette',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,target,number:attempt.round.number}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/sicbo/play'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip',target=b.target===undefined?null:Number(b.target);validateStake(u,b.floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Sic Bo',stake,floor,betType:b.betType,target});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Sic Bo',key,fingerprint,create:()=>({...playSicBo(stake,b.betType,target),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Sic Bo',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,target,dice:attempt.round.dice}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/dev/reset'&&req.method==='POST'&&env.NODE_ENV!=='production'){
      const out=await mutate(state=>{const u=getUser(state,req);state.ledger=state.ledger.filter(x=>x.userId!==u.id);state.rounds=state.rounds.filter(r=>r.userId!==u.id);state.rechargeRequests=state.rechargeRequests.filter(r=>r.userId!==u.id);u.account={available:0,locked:0,rawPnl:0,qualifiedPnl:0,totalWagered:0,peakBankroll:0,progressionValue:0,unlockedFloors:[]};u.recharge={lastAt:null,dailyDate:new Date().toISOString().slice(0,10),dailyCount:0,total:0};u.stats={};u.bankruptcies=[];addLedger(state,u,{type:'INITIAL_GRANT',amount:INITIAL_BANKROLL,referenceType:'DEV_RESET'});u.account.unlockedFloors=['downtown','strip'];return summarize(state,u);});return json(200,out);
    }
    return error(404,'NOT_FOUND');
  }catch(e){const map={FORBIDDEN:403,USER_NOT_FOUND:404,ROUND_NOT_FOUND:404,REQUEST_NOT_FOUND:404,RIVAL_NOT_FOUND:404,CHALLENGE_NOT_FOUND:404,INSUFFICIENT_BANKROLL:409,FLOOR_LOCKED:403,BET_OUTSIDE_TABLE_LIMIT:400,STAKE_TIER_NOT_ALLOWED:400,RECHARGE_NOT_AVAILABLE:409,PENDING_REQUEST_EXISTS:409,OPEN_BLACKJACK_ROUND:409,ROUND_ALREADY_SETTLED:409,RIVAL_ALREADY_ACTIVE:409,RIVAL_NOT_ACTIVE:409,CHALLENGE_ALREADY_OPEN:409,CHALLENGE_NOT_PENDING:409,CHALLENGE_NOT_OPEN:409,INVALID_SOCIAL_TARGET:400,INVALID_CHALLENGE_METRIC:400,INVALID_IDEMPOTENCY_KEY:400,IDEMPOTENCY_CONFLICT:409,OPEN_MATGO_ROUND:409,OPEN_SEOTDA_ROUND:409,NOT_YOUR_TURN:409,ROUND_NOT_ACTIONABLE:409};return error(map[e.message]||400,e.message||'BAD_REQUEST');}
}
