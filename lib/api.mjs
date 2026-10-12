// Game API routes, independent of the HTTP runtime (Node server or Cloudflare Worker).
import { publicUser, floorOpen } from './state.mjs';
import { FLOORS, INITIAL_BANKROLL, STAKE_TIERS } from './constants.mjs';
import { validateStakeAgainstFloor, validateEventStake } from './stakes.mjs';
import { autoRecharge, floorsFor, lockBet, increaseBetLock, rechargeStatus, requestRecharge, reviewRecharge, settleHouseGame, settleLockedHouseGame, totalBalance, addLedger } from './economy.mjs';
import { buildRankingSnapshot } from './rankings.mjs';
import { activeHybridSeason } from './seasons.mjs';
import { engagementView, weeklySeason, settleFinishedSeason, claimDaily, claimMission, playRescue, pushFeed, claimSupport } from './engagement.mjs';
import { bankView, borrow, repay, fileBankruptcy, processAllLoans } from './bank.mjs';
import { achievementsView, claimAchievement } from './achievements.mjs';
import { spinSlots, JACKPOT_SEED } from './slots.mjs';
import { HORSE_GAME, racingBook, publicCard, playHorseRace } from './horses.mjs';
import { buildSocialCompetitionSnapshot, createRival, archiveRival, createChallenge, acceptChallenge, cancelChallenge, settleChallenges } from './social-competition.mjs';
import { startBlackjack, blackjackAction, blackjackPublic, settleBlackjack, playBaccarat, validateBaccaratSideBets, playRoulette, playRouletteBets, validateRouletteBets, playSicBo } from './games.mjs';
import { startBlackjackV2, blackjackV2Action, blackjackV2ActionCost, blackjackV2Public, settleBlackjackV2, blackjackAiRoster, OCEANS_CREW } from './blackjack-v2.mjs';
import { activeBlackjackV2Round } from './blackjack-session.mjs';
import { buildInfo } from './build-info.mjs';
import { handleCardRoom } from './card-room.mjs';
import { handleHoldemRoom, roomOfUser } from './holdem-room.mjs';
import { handleTableRoom } from './table-room.mjs';
import { createHoldemSession, dealNextHand, heroAction, standUp, holdemPublic, activeHoldemSession, compactSettled, HOLDEM_ENGINE, royaleAfterHand, royaleRebuy, tourneyOpen, ROUNDERS } from './holdem-session.mjs';
import { liveEvents, eventById, eventOpen, weekAt, eventOfWeek, ROTATION, alwaysEvents, EVENT_FLOOR, EVENT_ENTRY } from './events.mjs';
import { trackEventStreak, eventStreakOf } from './event-bonus.mjs';
import { hotTableView, forceHotTable } from './hot-table.mjs';
import { stakeTierFor, isMoney } from './constants.mjs';
import { playDouble, doublePublic, DOUBLE_GAME } from './double-or-nothing.mjs';
import { idempotentInstantRound, instantPublicRound, instantRequestFingerprint, normalizeIdempotencyKey, rouletteSpinFingerprint } from './instant-idempotency.mjs';
import { adminAdjust, adminLog } from './admin.mjs';
import { upgradeEconomy, economyCurrent, ECONOMY_VERSION } from './economy-upgrade.mjs';
import { ensureVapid, subscribe, unsubscribe, sendTest, planNewsPushes, deliverPlan } from './notifications.mjs';
import { newsFor } from './news.mjs';
import { bearerToken, claimableProfiles, createAccount, findAccount, hashPassword, newSalt, sessionUserId, signIn, signOut, usernameOf, validateCredentials } from './auth.mjs';
import { blackjackActionFingerprint, blackjackStartFingerprint, findBlackjackStartReplay, isBlackjackCommandReplay, recordBlackjackCommand, tagBlackjackStart } from './blackjack-idempotency.mjs';


const LEGACY_BLACKJACK_ENGINE='LEGACY_V1';
const V2_BLACKJACK_ENGINE='MULTI_SPOT_V2';

const json=(status,data)=>({status,data});
// Every error and state carries the economy version, so a page still running an older build reloads.
const error=(status,message)=>json(status,{error:message,economy:ECONOMY_VERSION});
// With accounts on (the deployed Worker and Node server), only a signed-in session names the player.
// Unit tests run without them and pick a player with x-player-id, defaulting to the original profile.
function actorId(state,req){
  if(req.authRequired){const uid=sessionUserId(state,bearerToken(req));if(!uid)throw new Error('AUTH_REQUIRED');return uid;}
  return req.header('x-player-id')||'hanseo';
}
function getUser(state,req){const u=state.users[actorId(state,req)];if(!u)throw new Error('USER_NOT_FOUND');return u;}
function floorBySlug(slug){return FLOORS.find(f=>f.slug===slug)||FLOORS[0];}
function validateStake(user,floorSlug,stake,event=null){
  return event?validateEventStake(user,floorBySlug(floorSlug),stake,event):validateStakeAgainstFloor(user,floorBySlug(floorSlug),stake);
}
function summarize(state,user){
  const ledger=state.ledger.filter(x=>x.userId===user.id).slice(-50).reverse();
  const requests=state.rechargeRequests.filter(x=>x.userId===user.id).slice(0,10);
  const latestBust=user.bankruptcies?.[0]||null;
  const season=activeHybridSeason(state)??weeklySeason(state);
  return {
    economy:ECONOMY_VERSION,
    events:liveEvents(),
    // 핫 딜러 타임: the game paying +50% on wins right now (or null) and the next one.
    ...hotTableView(),
    // This week's event first, then the weeks after it, one per event in the rotation.
    eventEntry:{floor:EVENT_FLOOR,entry:EVENT_ENTRY},
    eventsAlways:alwaysEvents(),
    eventSchedule:Array.from({length:ROTATION.length},(_,k)=>eventOfWeek(Math.max(0,weekAt())+k)),
    eventStreaks:{...(user.eventStreaks||{})},
    rounders:{level:user.rounders?.level??0,beaten:user.rounders?.beaten??0,boss:ROUNDERS.bosses[user.rounders?.level??0].name},
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
    bank:bankView(user),
    achievements:achievementsView(user),
    jackpot:{pool:state.jackpot?.pool??JACKPOT_SEED,lastWin:state.jackpot?.lastWin??null},
    latestBust,
    serverTime:new Date().toISOString()
  };
}
// Event tables (lib/events.mjs) a house game may be played at: the event must be running and
// belong to that game.
function eventFor(b,game){
  if(!b.event)return null;
  const ev=eventById(b.event);
  if(!ev||ev.game!==game||!eventOpen(ev))throw new Error('EVENT_CLOSED');
  return ev.id;
}
// A round that earned the 핫 딜러 타임 bonus (lib/hot-table.mjs) carries it for the settle label.
function hotOf(round,tx){if(tx?.metadata?.hotTable)round.hotTable=tx.metadata.hotTable;return tx;}
function blackjackV2Response(round,state,user,replayed=false){
  const settled=round.status==='SETTLED';
  const view=blackjackV2Public(round,settled);
  const out={round:view,replayed,state:summarize(state,user)};
  if(settled){
    out.result=view.hands.map(h=>({handId:h.id,spot:h.spot,result:h.result?.result,netPnl:h.result?.netPnl,playerValue:h.value}));
    out.netPnl=round.netPnl;
    if(round.hotTable)out.hotTable=round.hotTable;
  }
  if(round.event)out.eventStreak=round.eventStreak??eventStreakOf(user,round.event);
  return out;
}
function legacyBlackjackResponse(round,state,user,replayed=false){
  const settled=round.status==='SETTLED';
  const out={round:blackjackPublic(round,settled),replayed,state:summarize(state,user)};
  if(settled){out.result=round.result?.result??null;out.netPnl=round.result?.netPnl??0;if(round.hotTable)out.hotTable=round.hotTable;}
  return out;
}

function holdemResponse(session,state,user,events,replayed=false){
  const out={session:holdemPublic(session),events,replayed,state:summarize(state,user)};
  if(session.status==='SETTLED')out.netPnl=session.netPnl;
  return out;
}
function settleHoldem(state,user,session){
  const r=session.royale;
  settleLockedHouseGame(state,user,{game:"Hold'em",stake:session.buyIn,netPnl:session.netPnl,roundId:session.id,details:{engineVersion:HOLDEM_ENGINE,hands:session.table.handNo,cashOut:session.cashOut,...(r?{event:r.event||'royale',place:r.place,rebuys:r.rebuys}:{})}});
  // Casino Royale and The Whale Room: the house adds a champion's bonus of 4 buy-ins on top of the
  // pot, and hands the runner-up their buy-in back. A forfeit earns nothing.
  const sixMax=r&&(r.event||'royale')!=='rounders';
  if(sixMax&&!r.forfeit&&(r.place===1||r.place===2)){
    const bonus=r.entry*(r.place===1?4:1);
    addLedger(state,user,{type:'EVENT_BONUS',amount:bonus,referenceType:'EVENT',referenceId:session.id,metadata:{event:r.event||'royale',place:r.place}});
    r.bonus=bonus;
  }
  // 라운더스: beating a boss moves the ladder up and pays a bounty of (step + 1) buy-ins.
  if(r?.event==='rounders'&&r.place===1){
    const step=r.boss??0;
    const bounty=(step+1)*r.entry;
    addLedger(state,user,{type:'EVENT_BONUS',amount:bounty,referenceType:'EVENT',referenceId:session.id,metadata:{event:'rounders',boss:ROUNDERS.bosses[step].name}});
    r.bounty=bounty;
    user.rounders={level:Math.min(step+1,ROUNDERS.bosses.length-1),beaten:Math.max(user.rounders?.beaten??0,step+1)};
  }
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
  if(session.royale)events.push(...royaleAfterHand(session));
  else if(session.status==='SEATED'&&hand?.over&&session.table.seats[0].stack<=0)events.push(...standUp(session));
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
  // Dev-only hook to hold a hot table open for screenshots; never in production.
  if(env.NODE_ENV!=='production'&&env.HOT_TABLE_FORCE!==undefined)forceHotTable(env.HOT_TABLE_FORCE);
  // Every state change first pays out a season or a friends' duel that has just ended.
  // After the change, big news it made (a jackpot, a duel) goes out as push notifications.
  const loadState=()=>store.load(),mutate=async fn=>{
    let news=null;
    const out=await store.mutate(async state=>{upgradeEconomy(state);processAllLoans(state);settleFinishedSeason(state);settleChallenges(state);const r=await fn(state);news={plan:planNewsPushes(state),vapid:state.push?.vapid,origin:state.push?.origin};return r;});
    if(news?.plan.length)await deliverPlan(store,news,{fetchFn:env.pushFetch,subject:env.VAPID_SUBJECT});
    return out;
  };
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
    if(url.pathname==='/api/news'&&req.method==='GET'){
      const state=await loadState();const u=getUser(state,req);const since=Number(url.searchParams.get('since'));
      return json(200,{items:Number.isFinite(since)&&since>0?newsFor(state,u.id,since):[],now:Date.now()});
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
      let state=await loadState();
      if(!economyCurrent(state)){await mutate(()=>null);state=await loadState();}
      return json(200,summarize(state,getUser(state,req)));
    }
    const cardRoom=await handleCardRoom(req,url,{mutate,loadState,getUser,summarize,validateStake});
    if(cardRoom) return cardRoom;
    const holdemRoom=await handleHoldemRoom(req,url,{mutate,loadState,getUser,summarize,validateStake,normalizeKey:normalizeIdempotencyKey});
    if(holdemRoom) return holdemRoom;
    const tableRoom=await handleTableRoom(req,url,{mutate,loadState,getUser,summarize,validateStake,normalizeKey:normalizeIdempotencyKey});
    if(tableRoom) return tableRoom;
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
    if(url.pathname==='/api/support/claim'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const claim=claimSupport(state,u,String(b.kind||''));return {claim,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/achievements/claim'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const claim=claimAchievement(state,u,String(b.id||''));return {claim,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/bank/borrow'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const loan=borrow(state,u,{lender:String(b.lender||''),amount:Number(b.amount),days:Number(b.days)});return {loan,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/bank/repay'&&req.method==='POST'){
      const b=await req.body();const out=await mutate(state=>{const u=getUser(state,req);const result=repay(state,u,{loanId:String(b.loanId||''),amount:b.amount==null?null:Number(b.amount)});return {result,state:summarize(state,u)};});return json(200,out);
    }
    if(url.pathname==='/api/bank/bankruptcy'&&req.method==='POST'){
      const out=await mutate(state=>{const u=getUser(state,req);const result=fileBankruptcy(state,u);return {result,state:summarize(state,u)};});return json(200,out);
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
        const event=eventFor(b,'blackjack');
        const fingerprint=blackjackStartFingerprint({engineVersion:V2_BLACKJACK_ENGINE,stake:sides?`${baseKey}|pp:${pairs.join('+')}|t3:${trips.join('+')}`:baseKey,spots,floor:event?`${floor}|${event}`:floor});
        const replay=findBlackjackStartReplay(state,{userId:u.id,key,fingerprint,engineVersion:V2_BLACKJACK_ENGINE});
        if(replay)return blackjackV2Response(replay,state,u,true);
        if(spots<1||spots>3)throw new Error('INVALID_SPOTS');
        for(const s of stakes)validateStake(u,b.floor,s,event);
        if(state.rounds.some(r=>r.userId===u.id&&r.game==='Blackjack'&&r.status!=='SETTLED')) throw new Error('OPEN_BLACKJACK_ROUND');
        // The same AI players mostly stay at this player's table from one round to the next.
        const last=state.rounds.findLast(r=>r.userId===u.id&&r.game==='Blackjack'&&r.engineVersion===V2_BLACKJACK_ENGINE);
        const round=startBlackjackV2(stakes,spots,{pairs,trips,ai:event==='oceans'?OCEANS_CREW.map(x=>({...x})):blackjackAiRoster(last?.event?[]:last?.ai)});round.userId=u.id;round.floor=floor;if(event)round.event=event;tagBlackjackStart(round,key,fingerprint);
        lockBet(state,u,{stake:round.stake,game:'Blackjack',roundId:round.id,metadata:{engineVersion:round.engineVersion,spots}});state.rounds.push(round);
        if(round.status==='READY_TO_SETTLE'){
          const result=settleBlackjackV2(round);hotOf(round,settleLockedHouseGame(state,u,{game:'Blackjack',stake:result.totalStake,netPnl:result.netPnl,roundId:round.id,details:{engineVersion:round.engineVersion,spots,outcomes:result.outcomes},hot:!round.event}));
          if(round.event)round.eventStreak=trackEventStreak(state,u,{event:round.event,net:result.netPnl,floorMin:floorBySlug(floor).minBet,roundId:round.id});
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
          const result=settleBlackjackV2(round);hotOf(round,settleLockedHouseGame(state,u,{game:'Blackjack',stake:result.totalStake,netPnl:result.netPnl,roundId:round.id,details:{engineVersion:round.engineVersion,spots:round.spots,outcomes:result.outcomes},hot:!round.event}));
          if(round.event)round.eventStreak=trackEventStreak(state,u,{event:round.event,net:result.netPnl,floorMin:floorBySlug(round.floor).minBet,roundId:round.id});
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
          const result=settleBlackjack(round);hotOf(round,settleLockedHouseGame(state,u,{game:'Blackjack',stake:round.stake,netPnl:result.netPnl,roundId:round.id,details:{result:result.result},hot:true}));
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
          const result=settleBlackjack(round);hotOf(round,settleLockedHouseGame(state,u,{game:'Blackjack',stake:round.stake,netPnl:result.netPnl,roundId:round.id,details:{result:result.result},hot:true}));
        }
        recordBlackjackCommand(round,key,fingerprint);
        return legacyBlackjackResponse(round,state,u,false);
      });return json(200,out);
    }
    if(url.pathname==='/api/baccarat/play'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip';validateStake(u,b.floor,stake,b.event?eventFor(b,'baccarat'):null);
        // Optional pair side bets ride alongside the main bet, each under the table maximum.
        const sides=validateBaccaratSideBets(b.sideBets),total=stake+sides.reduce((a,x)=>a+x.stake,0);
        if(sides.some(x=>x.stake>floorBySlug(floor).maxBet))throw new Error('BET_OUTSIDE_TABLE_LIMIT');if(sides.some(x=>!isMoney(x.stake)))throw new Error('BET_NOT_IN_UNITS');
        if(u.account.available<total)throw new Error('INSUFFICIENT_BANKROLL');
        const event=eventFor(b,'baccarat');
        const base=instantRequestFingerprint({game:'Baccarat',stake,floor:event?`${floor}|${event}`:floor,betType:b.betType});
        const fingerprint=sides.length?`${base}|${JSON.stringify(sides.map(x=>[x.betType,x.stake]))}`:base;
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Baccarat',key,fingerprint,create:()=>({...playBaccarat(stake,b.betType,sides.length?Object.fromEntries(sides.map(x=>[x.betType,x.stake])):undefined),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)hotOf(attempt.round,settleHouseGame(state,u,{game:'Baccarat',stake:attempt.round.stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,winner:attempt.round.winner,...(attempt.round.sideBets?{sideBets:attempt.round.sideBets.map(x=>({betType:x.betType,stake:x.stake,won:x.won}))}:{})},hot:!event}));
        if(event&&!attempt.replayed)attempt.round.eventStreak=trackEventStreak(state,u,{event,net:attempt.round.netPnl,floorMin:floorBySlug(floor).minBet,roundId:attempt.round.id});
        const pub=instantPublicRound(attempt.round);
        return {round:pub,replayed:attempt.replayed,...(event?{eventStreak:attempt.round.eventStreak??eventStreakOf(u,event)}:{}),state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/roulette/spin'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),floor=b.floor||'strip';const f=floorBySlug(floor);
        const bets=validateRouletteBets(b.bets);const stake=bets.reduce((a,x)=>a+x.stake,0);
        // Each spot stays under the table maximum; together they cover at least the table minimum.
        if(!u.account.unlockedFloors.includes(f.slug))throw new Error('FLOOR_LOCKED');
        if(!floorOpen(u,f))throw new Error('FLOOR_OUTGROWN');
        if(stake<f.minBet||bets.some(x=>x.stake>f.maxBet))throw new Error('BET_OUTSIDE_TABLE_LIMIT');
        if(bets.some(x=>!isMoney(x.stake)))throw new Error('BET_NOT_IN_UNITS');
        if(u.account.available<stake)throw new Error('INSUFFICIENT_BANKROLL');
        // 라이트닝 mode: the server strikes the numbers and sets their multipliers, never the client.
        const lightning=b.lightning===true;
        const fingerprint=rouletteSpinFingerprint({floor,bets,lightning});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Roulette',key,fingerprint,create:()=>({...playRouletteBets(bets,undefined,lightning),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)hotOf(attempt.round,settleHouseGame(state,u,{game:'Roulette',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{spots:bets.length,number:attempt.round.number,...(attempt.round.lightning?{lightning:attempt.round.lightning}:{})},hot:true}));
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/roulette/play'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip',target=b.target===undefined?null:Number(b.target);validateStake(u,b.floor,stake);
        const lightning=b.lightning===true;
        const fingerprint=instantRequestFingerprint({game:'Roulette',stake,floor,betType:b.betType,target,lightning});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Roulette',key,fingerprint,create:()=>({...playRoulette(stake,b.betType,target,{lightning}),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)hotOf(attempt.round,settleHouseGame(state,u,{game:'Roulette',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,target,number:attempt.round.number,...(attempt.round.lightning?{lightning:attempt.round.lightning}:{})},hot:true}));
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/sicbo/play'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||'strip',target=b.target===undefined?null:Number(b.target);validateStake(u,b.floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Sic Bo',stake,floor,betType:b.betType,target});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Sic Bo',key,fingerprint,create:()=>({...playSicBo(stake,b.betType,target),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)hotOf(attempt.round,settleHouseGame(state,u,{game:'Sic Bo',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType:b.betType,target,dice:attempt.round.dice},hot:true}));
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/slots/spin'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||FLOORS[0].slug;validateStake(u,floor,stake);
        const fingerprint=instantRequestFingerprint({game:'Slots',stake,floor,betType:'LINE'});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:'Slots',key,fingerprint,create:()=>({...spinSlots(state,{stake,maxBet:floorBySlug(floor).maxBet}),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed){
          hotOf(attempt.round,settleHouseGame(state,u,{game:'Slots',stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{line:attempt.round.line,jackpot:attempt.round.jackpot},hot:true}));
          if(attempt.round.jackpot>0)pushFeed(state,{type:'JACKPOT',actorId:u.id,game:'Slots',amount:attempt.round.jackpot});
        }
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    // 경마: the card (runners and odds) for the next race, then one bet that runs it and settles.
    if(url.pathname==='/api/horses/card'&&req.method==='GET'){
      const seen=await loadState();const me=getUser(seen,req);
      if(me.racing?.card)return json(200,{card:publicCard(me.racing.card)});
      const out=await mutate(state=>({card:publicCard(racingBook(getUser(state,req)).card)}));return json(200,out);
    }
    if(url.pathname==='/api/horses/race'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),stake=Number(b.stake),floor=b.floor||FLOORS[0].slug,pick=Number(b.pick),betType=String(b.betType||''),cardId=String(b.cardId||'');validateStake(u,floor,stake);
        const fingerprint=`${instantRequestFingerprint({game:HORSE_GAME,stake,floor,betType,target:pick})}|${cardId}`;
        const attempt=idempotentInstantRound(state,{userId:u.id,game:HORSE_GAME,key,fingerprint,create:()=>({...playHorseRace(u,{stake,betType,pick,cardId}),userId:u.id,floor,status:'SETTLED',createdAt:new Date().toISOString()})});
        if(!attempt.replayed)settleHouseGame(state,u,{game:HORSE_GAME,stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{betType,pick,odds:attempt.round.odds,order:attempt.round.order}});
        return {round:instantPublicRound(attempt.round),replayed:attempt.replayed,next:publicCard(racingBook(u).card),state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/holdem/open'&&req.method==='GET'){
      const state=await loadState();const u=getUser(state,req);const session=activeHoldemSession(state,u.id);
      return json(200,{session:session?holdemPublic(session):null,state:summarize(state,u)});
    }
    if(url.pathname==='/api/holdem/sit'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req),buyIn=Number(b.buyIn),floor=b.floor||FLOORS[0].slug;
        const open=activeHoldemSession(state,u.id);
        if(open){if(key&&open.lastCommand?.key===key&&open.lastCommand.kind==='sit')return holdemResponse(open,state,u,open.lastCommand.events,true);throw new Error('OPEN_HOLDEM_SESSION');}
        if(roomOfUser(state,u.id))throw new Error('OPEN_HOLDEM_SESSION');
        // Tournament events (Casino Royale, 라운더스 헤즈업, The Whale Room): only at the event table, only for players
        // holding the event entry, and the buy-in is always the table maximum.
        const event=b.royale?'royale':b.event==='rounders'||b.event==='whale'?b.event:null;
        validateStake(u,floor,buyIn,event);
        if(event&&!tourneyOpen(event))throw new Error('EVENT_CLOSED');
        if(event&&buyIn!==floorBySlug(floor).maxBet)throw new Error('BET_OUTSIDE_TABLE_LIMIT');
        const session=createHoldemSession({userId:u.id,nickname:u.nickname,buyIn,tier:stakeTierFor(buyIn).slug,opponents:b.opponents??5,floor,event,boss:u.rounders?.level??0});
        lockBet(state,u,{stake:buyIn,game:"Hold'em",roundId:session.id,metadata:{engineVersion:HOLDEM_ENGINE,opponents:session.table.seats.length-1,...(event?{event}:{})}});
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
    if(url.pathname==='/api/holdem/rebuy'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);const session=findHoldem(state,u,b.sessionId);
        return holdemCommand(state,u,session,key,'rebuy',()=>{
          const entry=session.royale?.entry;
          if(!entry||!session.royale.canRebuy)throw new Error('REBUY_NOT_OFFERED');
          if(u.account.available<entry)throw new Error('INSUFFICIENT_BANKROLL');
          const events=royaleRebuy(session);
          increaseBetLock(state,u,{stake:entry,game:"Hold'em",roundId:session.id,metadata:{reason:'ROYALE_REBUY'}});
          return events;
        });
      });return json(200,out);
    }
    if(url.pathname==='/api/holdem/leave'&&req.method==='POST'){
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);const session=findHoldem(state,u,b.sessionId);
        return holdemCommand(state,u,session,key,'leave',()=>standUp(session));
      });return json(200,out);
    }
    if(url.pathname==='/api/double'&&req.method==='POST'){
      // 더블 오어 낫띵: stake a fresh blackjack/baccarat win (or the last double) on one card's colour.
      const b=await req.body();const key=normalizeIdempotencyKey(req.header('x-idempotency-key'));const out=await mutate(state=>{
        const u=getUser(state,req);
        const fingerprint=instantRequestFingerprint({game:DOUBLE_GAME,stake:0,floor:String(b.roundId||''),betType:b.pick});
        const attempt=idempotentInstantRound(state,{userId:u.id,game:DOUBLE_GAME,key,fingerprint,create:()=>{
          const parent=state.rounds.find(r=>r&&r.id===b.roundId&&r.userId===u.id);
          if(!parent)throw new Error('ROUND_NOT_FOUND');
          const round=playDouble(parent,u.id,b.pick);
          parent.doubledBy=round.id;
          return round;
        }});
        if(!attempt.replayed)settleHouseGame(state,u,{game:DOUBLE_GAME,stake:attempt.round.stake,netPnl:attempt.round.netPnl,roundId:attempt.round.id,details:{parent:attempt.round.parent,origin:attempt.round.origin,step:attempt.round.step,pick:attempt.round.pick,card:attempt.round.card}});
        return {double:doublePublic(attempt.round),replayed:attempt.replayed,state:summarize(state,u)};
      });return json(200,out);
    }
    if(url.pathname==='/api/dev/reset'&&req.method==='POST'&&env.NODE_ENV!=='production'){
      const out=await mutate(state=>{const u=getUser(state,req);state.ledger=state.ledger.filter(x=>x.userId!==u.id);state.rounds=state.rounds.filter(r=>r.userId!==u.id);state.rechargeRequests=state.rechargeRequests.filter(r=>r.userId!==u.id);u.account={available:0,locked:0,rawPnl:0,qualifiedPnl:0,totalWagered:0,peakBankroll:0,progressionValue:0,unlockedFloors:[]};u.recharge={lastAt:null,dailyDate:new Date().toISOString().slice(0,10),dailyCount:0,total:0};u.stats={};u.bankruptcies=[];addLedger(state,u,{type:'INITIAL_GRANT',amount:INITIAL_BANKROLL,referenceType:'DEV_RESET'});u.account.unlockedFloors=[FLOORS[0].slug];u.loans=[];u.credit={score:500};return summarize(state,u);});return json(200,out);
    }
    return error(404,'NOT_FOUND');
  }catch(e){const map={AUTH_REQUIRED:401,BAD_CREDENTIALS:401,ACCOUNT_LOCKED:429,USERNAME_TAKEN:409,PROFILE_NOT_CLAIMABLE:409,SIGNUPS_CLOSED:409,INVALID_AMOUNT:400,AMOUNT_NOT_IN_UNITS:400,INVALID_USERNAME:400,INVALID_PASSWORD:400,FORBIDDEN:403,USER_NOT_FOUND:404,ROUND_NOT_FOUND:404,REQUEST_NOT_FOUND:404,RIVAL_NOT_FOUND:404,CHALLENGE_NOT_FOUND:404,INSUFFICIENT_BANKROLL:409,FLOOR_LOCKED:403,FLOOR_OUTGROWN:403,LOAN_REFUSED:409,LOAN_OVER_LIMIT:400,LENDER_NOT_FOUND:404,INVALID_TERM:400,LOAN_NOT_FOUND:404,REPAY_OVER_BALANCE:400,BANKRUPTCY_NOT_AVAILABLE:409,SUPPORT_ALREADY_CLAIMED:409,WELFARE_NOT_QUALIFIED:409,INVALID_SUPPORT:400,ACHIEVEMENT_NOT_FOUND:404,ACHIEVEMENT_ALREADY_CLAIMED:409,ACHIEVEMENT_NOT_DONE:409,BET_OUTSIDE_TABLE_LIMIT:400,BET_NOT_IN_UNITS:400,STAKE_TIER_NOT_ALLOWED:400,RECHARGE_NOT_AVAILABLE:409,PENDING_REQUEST_EXISTS:409,OPEN_BLACKJACK_ROUND:409,ROUND_ALREADY_SETTLED:409,RIVAL_ALREADY_ACTIVE:409,RIVAL_NOT_ACTIVE:409,CHALLENGE_ALREADY_OPEN:409,CHALLENGE_NOT_PENDING:409,CHALLENGE_NOT_OPEN:409,INVALID_SOCIAL_TARGET:400,INVALID_CHALLENGE_METRIC:400,INVALID_IDEMPOTENCY_KEY:400,INVALID_SPOTS:400,INSURANCE_NOT_OFFERED:409,INSURANCE_DECISION_REQUIRED:409,IDEMPOTENCY_CONFLICT:409,OPEN_HOLDEM_SESSION:409,STALE_ACTION:409,HAND_IN_PROGRESS:409,HAND_NOT_ACTIVE:409,NOT_YOUR_TURN:409,SESSION_CLOSED:409,NO_CHIPS:409,OPEN_MATGO_ROUND:409,OPEN_GOSTOP_ROUND:409,OPEN_SEOTDA_ROUND:409,ROUND_NOT_ACTIONABLE:409,DAILY_ALREADY_CLAIMED:409,MISSION_NOT_FOUND:404,MISSION_NOT_DONE:409,MISSION_ALREADY_CLAIMED:409,RESCUE_NOT_AVAILABLE:409,INVALID_PICK:400,DOUBLE_NOT_OFFERED:409,EVENT_CLOSED:409,EVENT_ENTRY_REQUIRED:409,EVENT_FLOOR_ONLY:400,REBUY_NOT_OFFERED:409,INVALID_BETS:400,DUPLICATE_BET:400,INVALID_BET_TYPE:400,INVALID_TARGET:400,RACE_CARD_STALE:409,INVALID_SUBSCRIPTION:400,NO_PUSH_DEVICE:409};const res=error(map[e.message]||400,e.message||'BAD_REQUEST');if(e.detail)res.data.detail=e.detail;return res;}
}
