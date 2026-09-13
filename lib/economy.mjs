import { DAILY_RECHARGE_LIMIT, FLOORS, INITIAL_BANKROLL, RECHARGE_COOLDOWN_MS, RECHARGE_TARGET, REFERENCE_PRICES } from './constants.mjs';
import { id, recalcUnlocks } from './store.mjs';

function today() { return new Date().toISOString().slice(0,10); }

export function totalBalance(user) { return user.account.available + user.account.locked; }

export function addLedger(state, user, {type, amount, lockedDelta=0, rawPnlDelta=0, qualifiedPnlDelta=0, referenceType='SYSTEM', referenceId=null, metadata={}}) {
  const before = user.account.available;
  const lockedBefore = user.account.locked;
  const after = before + amount;
  const lockedAfter = lockedBefore + lockedDelta;
  if (after < 0 || lockedAfter < 0) throw new Error('INSUFFICIENT_BANKROLL');
  user.account.available = after;
  user.account.locked = lockedAfter;
  user.account.rawPnl += rawPnlDelta;
  user.account.qualifiedPnl += qualifiedPnlDelta;
  user.account.progressionValue = Math.max(0, INITIAL_BANKROLL + user.account.qualifiedPnl);
  user.account.peakBankroll = Math.max(user.account.peakBankroll, totalBalance(user));
  const newly = recalcUnlocks(user);
  const tx = {
    id:id('tx'), userId:user.id, type, amount,
    availableBefore:before, availableAfter:after, lockedBefore, lockedAfter,
    rawPnlDelta, qualifiedPnlDelta,
    referenceType, referenceId, metadata,
    createdAt:new Date().toISOString()
  };
  state.ledger.push(tx);
  for (const floor of newly) {
    state.feed.unshift({ id:id('feed'), type:'FLOOR_UNLOCK', actorId:user.id, text:`${user.nickname} unlocked ${floor.name}.`, createdAt:new Date().toISOString() });
  }
  return tx;
}

export function lockBet(state,user,{stake,game,roundId,metadata={}}) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  return addLedger(state,user,{type:'BET_LOCK',amount:-stake,lockedDelta:stake,referenceType:'GAME_ROUND',referenceId:roundId,metadata:{game,stake,...metadata}});
}

export function increaseBetLock(state,user,{stake,game,roundId,metadata={}}) {
  return lockBet(state,user,{stake,game,roundId,metadata:{...metadata,incremental:true}});
}

export function settleLockedHouseGame(state,user,{game,stake,netPnl,roundId,details={}}) {
  if (user.account.locked < stake) throw new Error('LOCKED_STAKE_MISMATCH');
  user.account.totalWagered += stake;
  const grossReturn = stake + netPnl;
  if (grossReturn < 0) throw new Error('INVALID_SETTLEMENT');
  const tx=addLedger(state,user,{
    type: netPnl >= 0 ? (netPnl === 0 ? 'GAME_PUSH' : 'GAME_WIN') : 'GAME_LOSS',
    amount:grossReturn,
    lockedDelta:-stake,
    rawPnlDelta:netPnl,
    qualifiedPnlDelta:netPnl,
    referenceType:'GAME_ROUND',referenceId:roundId,metadata:{game,stake,...details}
  });
  updateStats(user,game,stake,netPnl);
  if (netPnl >= 300_000_000) state.feed.unshift({id:id('feed'), type:'BIG_WIN', actorId:user.id, text:`${user.nickname} won +${netPnl.toLocaleString('ko-KR')} CH at ${game}.`, createdAt:new Date().toISOString()});
  if (netPnl <= -300_000_000) state.feed.unshift({id:id('feed'), type:'BIG_LOSS', actorId:user.id, text:`${user.nickname} lost ${Math.abs(netPnl).toLocaleString('ko-KR')} CH at ${game}.`, createdAt:new Date().toISOString()});
  if (totalBalance(user) === 0) createBankruptcy(state,user,{game,loss:Math.abs(netPnl),roundId});
  return tx;
}

export function settleHouseGame(state, user, {game, stake, netPnl, roundId, details={}}) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  user.account.totalWagered += stake;
  const tx = addLedger(state,user,{
    type: netPnl >= 0 ? (netPnl === 0 ? 'GAME_PUSH' : 'GAME_WIN') : 'GAME_LOSS',
    amount:netPnl,
    rawPnlDelta:netPnl,
    qualifiedPnlDelta:netPnl,
    referenceType:'GAME_ROUND',
    referenceId:roundId,
    metadata:{game, stake, ...details}
  });
  updateStats(user, game, stake, netPnl);
  if (netPnl >= 300_000_000) state.feed.unshift({id:id('feed'), type:'BIG_WIN', actorId:user.id, text:`${user.nickname} won +${netPnl.toLocaleString('ko-KR')} CH at ${game}.`, createdAt:new Date().toISOString()});
  if (netPnl <= -300_000_000) state.feed.unshift({id:id('feed'), type:'BIG_LOSS', actorId:user.id, text:`${user.nickname} lost ${Math.abs(netPnl).toLocaleString('ko-KR')} CH at ${game}.`, createdAt:new Date().toISOString()});
  if (totalBalance(user) === 0) createBankruptcy(state,user,{game,loss:Math.abs(netPnl),roundId});
  return tx;
}

function updateStats(user, game, stake, netPnl) {
  const s = user.stats[game] ?? { rounds:0,wins:0,losses:0,pushes:0,wagered:0,pnl:0,biggestWin:0,biggestLoss:0,biggestBet:0 };
  s.rounds++;
  s.wagered += stake;
  s.pnl += netPnl;
  s.biggestBet = Math.max(s.biggestBet,stake);
  if (netPnl > 0) { s.wins++; s.biggestWin=Math.max(s.biggestWin,netPnl); }
  else if (netPnl < 0) { s.losses++; s.biggestLoss=Math.max(s.biggestLoss,Math.abs(netPnl)); }
  else s.pushes++;
  user.stats[game]=s;
}

function createBankruptcy(state,user,{game,loss,roundId}) {
  const record={id:id('bust'),userId:user.id,game,sessionLoss:loss,peakBankroll:user.account.peakBankroll,roundId,createdAt:new Date().toISOString(),comparisons:comparisons(loss)};
  user.bankruptcies.unshift(record);
  state.feed.unshift({id:id('feed'),type:'BANKRUPTCY',actorId:user.id,text:`💀 ${user.nickname} went BANKRUPT.`,createdAt:new Date().toISOString(),bankruptcyId:record.id});
  return record;
}

export function comparisons(amount) {
  return REFERENCE_PRICES.map(p=>({...p,count:Math.floor(amount/p.price)})).filter(x=>x.count>=1).sort((a,b)=>b.price-a.price).slice(0,4);
}

export function rechargeStatus(user) {
  if (user.recharge.dailyDate !== today()) {
    user.recharge.dailyDate=today(); user.recharge.dailyCount=0;
  }
  const total=totalBalance(user);
  const eligibleBalance=total < RECHARGE_TARGET;
  const cooldownRemaining=user.recharge.lastAt ? Math.max(0,RECHARGE_COOLDOWN_MS-(Date.now()-Date.parse(user.recharge.lastAt))) : 0;
  const remainingDaily=Math.max(0,DAILY_RECHARGE_LIMIT-user.recharge.dailyCount);
  const amount=Math.max(0,RECHARGE_TARGET-total);
  return {eligible:eligibleBalance && cooldownRemaining===0 && remainingDaily>0 && amount>0, amount, cooldownRemaining,remainingDaily,target:RECHARGE_TARGET};
}

export function autoRecharge(state,user) {
  const status=rechargeStatus(user);
  if (!status.eligible) throw new Error('RECHARGE_NOT_AVAILABLE');
  const tx=addLedger(state,user,{type:'AUTO_RECHARGE',amount:status.amount,referenceType:'RECHARGE',metadata:{dailyCount:user.recharge.dailyCount+1}});
  user.recharge.lastAt=new Date().toISOString();
  user.recharge.dailyCount++;
  user.recharge.total += status.amount;
  return {tx,status:rechargeStatus(user)};
}

export function requestRecharge(state,user,amount,reason='Continue playing') {
  const allowed=[10_000_000,30_000_000,50_000_000];
  if (!allowed.includes(amount)) throw new Error('INVALID_REQUEST_AMOUNT');
  if (state.rechargeRequests.some(r=>r.userId===user.id && r.status==='PENDING')) throw new Error('PENDING_REQUEST_EXISTS');
  const req={id:id('req'),userId:user.id,requestedAmount:amount,approvedAmount:null,reason,status:'PENDING',createdAt:new Date().toISOString(),reviewedAt:null,reviewedBy:null};
  state.rechargeRequests.unshift(req); return req;
}

export function reviewRecharge(state,admin,requestId,decision,approvedAmount=null) {
  if (!admin.isAdmin) throw new Error('FORBIDDEN');
  const req=state.rechargeRequests.find(r=>r.id===requestId);
  if (!req || req.status!=='PENDING') throw new Error('REQUEST_NOT_FOUND');
  const user=state.users[req.userId];
  if (decision==='APPROVE') {
    const amount=approvedAmount ?? req.requestedAmount;
    if (![10_000_000,30_000_000,50_000_000].includes(amount)) throw new Error('INVALID_APPROVED_AMOUNT');
    addLedger(state,user,{type:'ADMIN_GRANT',amount,referenceType:'RECHARGE_REQUEST',referenceId:req.id,metadata:{approvedBy:admin.id}});
    req.status=amount===req.requestedAmount?'APPROVED':'PARTIALLY_APPROVED';
    req.approvedAmount=amount;
  } else req.status='DECLINED';
  req.reviewedAt=new Date().toISOString(); req.reviewedBy=admin.id;
  return req;
}

export function ranking(state,type='wealth') {
  const rows=Object.values(state.users).map(u=>({id:u.id,nickname:u.nickname,accent:u.accent,wealth:totalBalance(u),profit:u.account.qualifiedPnl,wagered:u.account.totalWagered,peak:u.account.peakBankroll}));
  const key=type==='profit'?'profit':type==='high-roller'?'wagered':'wealth';
  return rows.sort((a,b)=>b[key]-a[key]).map((r,i)=>({...r,rank:i+1,value:r[key]}));
}

export function floorsFor(user) {
  return FLOORS.map(f=>({...f,unlocked:user.account.unlockedFloors.includes(f.slug),progress:Math.min(1,user.account.progressionValue/Math.max(1,f.threshold)),remaining:Math.max(0,f.threshold-user.account.progressionValue)}));
}
