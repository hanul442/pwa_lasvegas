// Game API routes, independent of the HTTP runtime (Node server or Cloudflare Worker).
import { publicUser } from './state.mjs';
import { FLOORS, INITIAL_BANKROLL, STAKE_TIERS } from './constants.mjs';
import { validateStakeAgainstFloor } from './stakes.mjs';
import { autoRecharge, floorsFor, lockBet, increaseBetLock, rechargeStatus, requestRecharge, reviewRecharge, settleHouseGame, settleLockedHouseGame, totalBalance, addLedger } from './economy.mjs';
import { buildRankingSnapshot } from './rankings.mjs';
import { activeHybridSeason } from './seasons.mjs';
import { engagementView, weeklySeason, settleFinishedSeason, claimDaily, claimMission, playRescue, pushFeed } from './engagement.mjs';
import { spinSlots, JACKPOT_SEED } from './slots.mjs';
import { buildSocialCompetitionSnapshot, createRival, archiveRival, createChallenge, acceptChallenge, cancelChallenge, settleChallenges } from './social-competition.mjs';
import { startBlackjack, blackjackAction, blackjackPublic, settleBlackjack, playBaccarat, validateBaccaratSideBets, playRoulette, playRouletteBets, validateRouletteBets, playSicBo } from './games.mjs';
import { startBlackjackV2, blackjackV2Action, blackjackV2ActionCost, blackjackV2Public, settleBlackjackV2, blackjackAiRoster } from './blackjack-v2.mjs';
import { activeBlackjackV2Round } from './blackjack-session.mjs';
import { buildInfo } from './build-info.mjs';
import { handleCardRoom } from './card-room.mjs';
import { handleHoldemRoom, roomOfUser } from './holdem-room.mjs';
import { createHoldemSession, dealNextHand, heroAction, standUp, holdemPublic, activeHoldemSession, compactSettled, HOLDEM_ENGINE } from './holdem-session.mjs';
import { stakeTierFor } from './constants.mjs';
import { idempotentInstantRound, instantPublicRound, instantRequestFingerprint, normalizeIdempotencyKey } from './instant-idempotency.mjs';
import { adminAdjust, adminLog } from './admin.mjs';
import { ensureVapid, subscribe, unsubscribe, sendTest } from './notifications.mjs';
import { bearerToken, claimableProfiles, createAccount, findAccount, hashPassword, newSalt, sessionUserId, signIn, signOut, usernameOf, validateCredentials } from './auth.mjs';
import { blackjackActionFingerprint, blackjackStartFingerprint, findBlackjackStartReplay, isBlackjackCommandReplay, recordBlackjackCommand, tagBlackjackStart } from './blackjack-idempotency.mjs';


const LEGACY_BLACKJACK_ENGINE='LEGACY_V1';
const V2_BLACKJACK_ENGINE='MULTI_SPOT_V2';

const json=(status,data)=>({status,data});
const error=(status,message)=>json(status,{error:message});
// With accounts on (the deployed Worker and Node server), only a signed-in session names the player.
// Unit tests run without them and pick a player with x-player-id, defaulting to the original profile.
function actorId(state,req){
  if(req.authRequired){const uid=sessionUserId(state,bearerToken(req));if(!uid)throw new Error('AUTH_REQUIRED');return uid;}
  return req.header('x-player-id')||'hanseo';
}
function getUser(state,req){const u=state.users[actorId(state,req)];if(!u)throw new Error('USER_NOT_FOUND');return u;}
function floorBySlug(slug){return FLOORS.find(f=>f.slug===slug)||FLOORS[1];}
function validateStake(user,floorSlug,stake){
  return validateStakeAgainstFloor(user,floorBySlug(floorSlug),stake);
}
function summarize(state,user){
  const ledger=state.ledger.filter(x=>x.userId===user.id).slice(-50).reverse();
  const requests=state.rechargeRequests.filter(x=>x.userId===user.id).slice(0,10);
  const latestBust=user.bankruptcies?.[0]||null;
  const season=activeHybridSeason(state)??weeklySeason(state);
  return {
    user:publicUser(user),
    username:usernameOf(state,user.id),
    users:Object.values(state.users).map(publicUser),
    floors:floorsFor(user),
    stakeTiers:STAKE_TIERS.map(tier=>({...tier})),
    rankings:buildRankingSnapshot(state,season),
    socialCompetition:buildSocialCompetitionSnapshot(state,user.id),
    recharge:rechargeStatus(user),
    rechargeRequests:requests,
    adminLog:user.isAdmin?adminLog(state):[],
    adminRequests:user.isAdmin?state.rechargeRequests.filter(r=>r.status==='PENDING').map(r=>({...r,nickname:state.users[r.userId]?.nickname})):[],
    ledger,
    feed:state.feed.slice(0,30),
    engagement:engagementView(state,user),
    jackpot:{pool:state.jackpot?.pool??JACKPOT_SEED,lastWin:state.jackpot?.lastWin??null},
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

function holdemResponse(session,state,user,events,replayed=false){
  const out={session:holdemPublic(session),events,replayed,state:summarize(state,user)};
  if(session.status==='SETTLED')out.netPnl=session.netPnl;
  return out;
}
function settleHoldem(state,user,session){
  settleLockedHouseGame(state,user,{game:"Hold'em",stake:session.buyIn,netPnl:session.netPnl,roundId:session.id,details:{engineVersion:HOLDEM_ENGINE,hands:session.table.handNo,cashOut:session.cashOut}});
  compactSettled(session);
}
// Runs one Hold'em command at most once per idempotency key; a busted player is stood up automatically.
function holdemCommand(state,user,session,key,kind,run){
  if(key&&session.lastCommand?.key===key){
    if(session.lastCommand.kind!==kind)throw new Error('IDEMPOTENCY_CONFLICT');
    return holdemResponse(session,state,user,session.lastCommand.events,true);
  }
  if(session.status==='SETTLED')throw new Error('SESSION_CLOSED');
  const events=run();
  const hand=session.table.hand;
  if(session.status==='SEATED'&&hand?.over&&session.table.seats[0].stack<=0)events.push(...standUp(session));
  if(session.status==='SETTLED')settleHoldem(state,user,session);
  session.lastCommand={key,kind,events};
  return holdemResponse(session,state,user,events,false);
}
function findHoldem(state,user,sessionId){
  const s=state.rounds.find(r=>r.id===sessionId&&r.userId===user.id&&r.engineVersion===HOLDEM_ENGINE);
  if(!s)throw new Error('ROUND_NOT_FOUND');
  return s;
}

// req: {method, header(name), body()}; store: {load(), mutate(fn)}; env: plain object of settings.
export async function handleApi(req,url,store,env={}){
  req={...req,authRequired:Boolean(env.AUTH_REQUIRED)};
  // Every state change first pays out a season or a friends' duel that has just ended.
  const loadState=()=>store.load(),mutate=fn=>store.mutate(state=>{settleFinishedSeason(state);settleChallenges(state);return fn(state);});
  try{
    if(url.pathname==='/api/health') return json(200,{ok:true,service:'social-vegas',time:new Date().toISOString()});
    if(url.pathname==='/api/version'&&req.method==='GET') return json(200,buildInfo(env));
    if(url.pathname==='/api/auth/options'&&req.method==='GET'){
      const state=await loadState(); return json(200,{claimable:claimableProfiles(state)});
    }
    if(url.pathname==='/api/auth/signup'&&req.method==='POST'){
      const b=await req.body();const username=validateCredentials(b.username,b.password);
      const salt=newSalt(),hash=await hashPassword(b.password,salt);
      const claimId=b.claimId?String(b.claimId):null;
      const out=await mutate(state=>{const {token,userId}=createAccount(state,{username,salt,hash,claimId});return {token,state:summarize(state,state.users[userId])};});
      return json(201,out);
    }
    if(url.pathname==='/api/auth/login'&&req.method==='POST'){
      const b=await req.body();
      if(typeof b.password!=='string'||!b.username)throw new Error('BAD_CREDENTIALS');
      const account=findAccount(await loadState(),b.username);
      // Hash even for unknown names so the response time doesn't reveal which accounts exist.
      const hash=await hashPassword(b.password,account?.salt??newSalt());
      const out=await mutate(state=>{const r=signIn(state,b.username,hash);return r?{token:r.token,state:summarize(state,state.users[r.userId])}:null;});
      if(!out)throw new Error('BAD_CREDENTIALS');
      return json(200,out);
    }
    if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
      const token=bearerToken(req);if(token)await store.mutate(state=>{signOut(state,token);});
      return json(200,{ok:true});
    }
    if(url.pathname==='/api/admin/adjust'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const admin=getUser(state,req);const adjustment=adminAdjust(state,admin,b);return {adjustment,state:summarize(state,admin)};});return json(200,out);
    }
    if(url.pathname==='/api/push/key'&&req.method==='GET'){
      let vapid=(await loadState()).push?.vapid;
      if(!vapid)vapid=await mutate(state=>ensureVapid(state));
      return json(200,{publicKey:vapid.publicKey});
    }
    if(url.pathname==='/api/push/subscribe'&&req.method==='POST'){
      const b=await req.body();const origin=req.header('origin');
      const out=await mutate(state=>{const u=getUser(state,req);if(/^https:\/\/[^/]+$/.test(origin||''))(state.push??={}).origin=origin;return subscribe(state,u,b.subscription);});return json(200,out);
    }
    if(url.pathname==='/api/push/unsubscribe'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>unsubscribe(state,getUser(state,req),b.endpoint));return json(200,out);
    }
    if(url.pathname==='/api/push/test'&&req.method==='POST'){
      const u=getUser(await loadState(),req);const out=await sendTest(store,u.id,{fetchFn:env.pushFetch});return json(200,out);
    }
    if(url.pathname==='/api/state'&&req.method==='GET'){
      const state=await loadState(); return json(200,summarize(state,getUser(state,req)));
    }
    const cardRoom=await handleCardRoom(req,url,{mutate,loadState,getUser,summarize,validateStake});
    if(cardRoom) return cardRoom;
    const holdemRoom=await handleHoldemRoom(req,url,{mutate,loadState,getUser,summarize,validateStake,normalizeKey:normalizeIdempotencyKey});
    if(holdemRoom) return holdemRoom;
    if(url.pathname==='/api/blackjack/v2/open'&&req.method==='GET'){
      const state=await loadState();const u=getUser(state,req);const round=activeBlackjackV2Round(state,u.id);
      // Between rounds, the AI players from the last round are still sitting at the table.
      const last=round?null:state.rounds.findLast(r=>r.userId===u.id&&r.game==='Blackjack'&&r.engineVersion===V2_BLACKJACK_ENGINE);
      const seats=(last?.ai||[]).map(a=>({name:a.name,temper:a.temper,stake:a.stake/(a.doubled?2:1)}));
      return json(200,{round:round?blackjackV2Public(round,false):null,floor:round?.floor??null,seats,state:summarize(state,u)});
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
    if(url.pathname==='/api/daily/claim'&&req.method==='POST'){
      const out=await mutate(state=>{const u=getUser(state,req);const claim=claimDaily(state,u);return {claim:{amount:claim.amount,day:claim.day,streak:claim.streak},state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/missions/claim'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const claim=claimMission(state,u,String(b.missionId||''));return {claim,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/rescue'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const rescue=playRescue(state,u,b.pick);return {rescue,state:summarize(state,u)};});return json(200,out);
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
        const u=getUser(state,req),floor=b.floor||'strip';
        // One stake per betting box (b.stakes), or the older single stake repeated over b.spots boxes.
        const stakes=Array.isArray(b.stakes)?b.stakes.map(Number):Array.from({length:Number(b.spots||1)},()=>Number(b.stake));
        const spots=stakes.length;
        // Optional side bets per box: Perfect Pairs (b.pairs) and 21+3 (b.trips), 0 for none.
        const sideList=x=>Array.isArray(x)?x.map(v=>Number(v||0)):[];
        const pairs=sideList(b.pairs),trips=sideList(b.trips),sides=[...pairs,...trips].some(v=>v!==0);
        const baseKey=Array.isArray(b.stakes)?stakes.join('+'):Number(b.stake);
        const fingerprint=blackjackStartFingerprint({engineVersion:V2_BLACKJACK_ENGINE,stake:sides?`${baseKey}|pp:${pairs.join('+')}|t3:${trips.join('+')}`:baseKey,spots,floor});
        const replay=findBlackjackStartReplay(state,{userId:u.id,key,fingerprint,engineVersion:V2_BLACKJACK_ENGINE});
        if(replay)return blackjackV2Response(replay,state,u,true);
        if(spots<1||spots>3)throw new Error('INVALID_SPOTS');
        for(const s of stakes)validateStake(u,b.floor,s);
        if(state.rounds.some(r=>r.userId===u.id&&r.game==='Blackjack'&&r.status!=='SETTLED')) throw new Error('OPEN_BLACKJACK_ROUND');
        // The same AI players mostly stay at this player's table from one round to the next.
        const last=state.rounds.findLast(r=>r.userId===u.id&&r.game==='Blackjack'&&r.engineVersion===V2_BLACKJACK_ENGINE);
        const round=startBlackjackV2(stakes,spots,{pairs,trips,ai:blackjackAiRoster(last?.ai)});round.userId=u.id;round.floor=floor;tagBlackjackStart(round,key,fingerprint);
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
        // Optional pair side bets ride alongside the main bet, each under the table maximum.
        const sides=validateBaccaratSideBets(b.sideBets),total=stake+sides.reduce((a,x)=>a+x.stake,0);
        if(sides.some(x=>x.stake>floorBySlug(floor).maxBet))throw new Error('BET_OUTSIDE_TABLE_LIMIT');
        if(u.account.available<total)throw new Error('INSUFFICIENT_BANKROLL');
        const base=instantRequestFingerprint({game:'Baccarat',stake,floor,betType:b.betType});
        const fingerprint=sides.length?`${base}|${JSON.stringify(sides.map(x=>[x.betType,x.stake]))}`:base;
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Baccarat',key,fingerprint,create:()=>({...playBaccarat(stake,b.betType,sides.length?Object.fromEntries(sides.map(x=>[x.betType,x.stake])):undefined),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Baccarat',stake:attempt.round.stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,winner:attempt.round.winner,...(attempt.round.sideBets?{sideBets:attempt.round.sideBets.map(x=>({betType:x.betType,stake:x.stake,won:x.won}))}:{})}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/roulette/spin'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),floor=b.floor||'strip';const f=floorBySlug(floor);
        const bets=validateRouletteBets(b.bets);const stake=bets.reduce((a,x)=>a+x.stake,0);
        // Each spot stays under the table maximum; together they cover at least the table minimum.
        if(!u.account.unlockedFloors.includes(f.slug))throw new Error('FLOOR_LOCKED');
        if(stake<f.minBet||bets.some(x=>x.stake>f.maxBet))throw new Error('BET_OUTSIDE_TABLE_LIMIT');
        if(u.account.available<stake)throw new Error('INSUFFICIENT_BANKROLL');
        const fingerprint=JSON.stringify({game:'Roulette',floor,bets:bets.map(x=>[x.betType,x.target,x.stake])});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Roulette',key,fingerprint,create:()=>({...playRouletteBets(bets),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:'Roulette',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{spots:bets.length,number:attempt.round.number}});
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
    if(url.pathname==='/api/slots/spin'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'downtown';validateStake(u,floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Slots',stake,floor,betType:'LINE'});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Slots',key,fingerprint,create:()=>({...spinSlots(state,{stake,maxBet:floorBySlug(floor).maxBet}),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed){
          settleHouseGame(state,u,{game:'Slots',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{line:attempt.round.line,jackpot:attempt.round.jackpot}});
          if(attempt.round.jackpot>0)pushFeed(state,{type:'JACKPOT',actorId:u.id,game:'Slots',amount:attempt.round.jackpot});
        }
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/holdem/open'&&req.method==='GET'){
      const state=await loadState();const u=getUser(state,req);const session=activeHoldemSession(state,u.id);
      return json(200,{session:session?holdemPublic(session):null,state:summarize(state,u)});
    }
    if(url.pathname==='/api/holdem/sit'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),buyIn=Number(b.buyIn),floor=b.floor||'downtown';
        const open=activeHoldemSession(state,u.id);
        if(open){if(key&&open.lastCommand?.key===key&&open.lastCommand.kind==='sit')return holdemResponse(open,state,u,open.lastCommand.events,true);throw new Error('OPEN_HOLDEM_SESSION');}
        if(roomOfUser(state,u.id))throw new Error('OPEN_HOLDEM_SESSION');
        validateStake(u,floor,buyIn);
        const session=createHoldemSession({userId:u.id,nickname:u.nickname,buyIn,tier:stakeTierFor(buyIn).slug,opponents:b.opponents??5,floor});
        lockBet(state,u,{stake:buyIn,game:"Hold'em",roundId:session.id,metadata:{engineVersion:HOLDEM_ENGINE,opponents:session.table.seats.length-1}});
        state.rounds.push(session);
        return holdemCommand(state,u,session,key,'sit',()=>dealNextHand(session));
      });return json(200,out);
    }
    if(url.pathname==='/api/holdem/action'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);const session=findHoldem(state,u,b.sessionId);
        return holdemCommand(state,u,session,key,'action',()=>{
          const hand=session.table.hand;
          if(!hand||hand.no!==Number(b.handNo)||hand.seq!==Number(b.seq))throw new Error('STALE_ACTION');
          return heroAction(session,{type:b.action,amount:b.amount===undefined?undefined:Number(b.amount)});
        });
      });return json(200,out);
    }
    if(url.pathname==='/api/holdem/next'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);const session=findHoldem(state,u,b.sessionId);
        return holdemCommand(state,u,session,key,'next',()=>{
          if(session.table.handNo!==Number(b.handNo))throw new Error('STALE_ACTION');
          return dealNextHand(session);
        });
      });return json(200,out);
    }
    if(url.pathname==='/api/holdem/leave'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);const session=findHoldem(state,u,b.sessionId);
        return holdemCommand(state,u,session,key,'leave',()=>standUp(session));
      });return json(200,out);
    }
    if(url.pathname==='/api/dev/reset'&&req.method==='POST'&&env.NODE_ENV!=='production'){
      const out=await mutate(state=>{const u=getUser(state,req);state.ledger=state.ledger.filter(x=>x.userId!==u.id);state.rounds=state.rounds.filter(r=>r.userId!==u.id);state.rechargeRequests=state.rechargeRequests.filter(r=>r.userId!==u.id);u.account={available:0,locked:0,rawPnl:0,qualifiedPnl:0,totalWagered:0,peakBankroll:0,progressionValue:0,unlockedFloors:[]};u.recharge={lastAt:null,dailyDate:new Date().toISOString().slice(0,10),dailyCount:0,total:0};u.stats={};u.bankruptcies=[];addLedger(state,u,{type:'INITIAL_GRANT',amount:INITIAL_BANKROLL,referenceType:'DEV_RESET'});u.account.unlockedFloors=['downtown','strip'];return summarize(state,u);});return json(200,out);
    }
    return error(404,'NOT_FOUND');
  }catch(e){const map={AUTH_REQUIRED:401,BAD_CREDENTIALS:401,ACCOUNT_LOCKED:429,USERNAME_TAKEN:409,PROFILE_NOT_CLAIMABLE:409,SIGNUPS_CLOSED:409,INVALID_AMOUNT:400,INVALID_USERNAME:400,INVALID_PASSWORD:400,FORBIDDEN:403,USER_NOT_FOUND:404,ROUND_NOT_FOUND:404,REQUEST_NOT_FOUND:404,RIVAL_NOT_FOUND:404,CHALLENGE_NOT_FOUND:404,INSUFFICIENT_BANKROLL:409,FLOOR_LOCKED:403,BET_OUTSIDE_TABLE_LIMIT:400,STAKE_TIER_NOT_ALLOWED:400,RECHARGE_NOT_AVAILABLE:409,PENDING_REQUEST_EXISTS:409,OPEN_BLACKJACK_ROUND:409,ROUND_ALREADY_SETTLED:409,RIVAL_ALREADY_ACTIVE:409,RIVAL_NOT_ACTIVE:409,CHALLENGE_ALREADY_OPEN:409,CHALLENGE_NOT_PENDING:409,CHALLENGE_NOT_OPEN:409,INVALID_SOCIAL_TARGET:400,INVALID_CHALLENGE_METRIC:400,INVALID_IDEMPOTENCY_KEY:400,INVALID_SPOTS:400,INSURANCE_NOT_OFFERED:409,INSURANCE_DECISION_REQUIRED:409,IDEMPOTENCY_CONFLICT:409,OPEN_HOLDEM_SESSION:409,STALE_ACTION:409,HAND_IN_PROGRESS:409,HAND_NOT_ACTIVE:409,NOT_YOUR_TURN:409,SESSION_CLOSED:409,NO_CHIPS:409,OPEN_MATGO_ROUND:409,OPEN_GOSTOP_ROUND:409,OPEN_SEOTDA_ROUND:409,ROUND_NOT_ACTIONABLE:409,DAILY_ALREADY_CLAIMED:409,MISSION_NOT_FOUND:404,MISSION_NOT_DONE:409,MISSION_ALREADY_CLAIMED:409,RESCUE_NOT_AVAILABLE:409,INVALID_PICK:400,INVALID_BETS:400,DUPLICATE_BET:400,INVALID_BET_TYPE:400,INVALID_TARGET:400,INVALID_SUBSCRIPTION:400,NO_PUSH_DEVICE:409};return error(map[e.message]||400,e.message||'BAD_REQUEST');}
}
