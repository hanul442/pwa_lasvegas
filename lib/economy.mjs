import { notePeak } from './rank-tier.mjs';
import { noteRp, rpEra, rpPointsNow, rpTierStart } from './rank-points.mjs';
import { DAILY_RECHARGE_LIMIT, FLOORS, INITIAL_BANKROLL, RECHARGE_COOLDOWN_MS, RECHARGE_TARGET, REFERENCE_PRICES, MONEY_UNIT, isMoney, roundMoney, ceilMoney } from './constants.mjs';
import { id, recalcUnlocks, netWorth, debtOf, seasonOwedOf, floorOpen, hasFloorPass, floorEntered } from './state.mjs';
import { onRoundSettled, autoBailout } from './engagement.mjs';
import { hotTableBonus, HOT_BONUS } from './hot-table.mjs';
import { tallyRow } from './tally.mjs';
import { noteUsage } from './usage.mjs';
import { noteWrapped } from './wrapped.mjs';
import { noteDay, noteBust, todayView, monthView } from './loss-tally.mjs';
import { formatMoney } from '../public/js/money.js';

const GAME_SETTLEMENT_TYPES=new Set(['GAME_WIN','GAME_LOSS','GAME_PUSH']);

export const RECHARGE_OPEN = false;

function today(now = Date.now()) { return new Date(now).toISOString().slice(0,10); }

export function totalBalance(user) { return user.account.available + user.account.locked; }

function assertRoundUnsettled(state,user,roundId){
  const duplicate=Array.isArray(state?.ledger)&&state.ledger.some(tx=>
    tx?.userId===user.id&&
    tx.referenceType==='GAME_ROUND'&&
    tx.referenceId===roundId&&
    GAME_SETTLEMENT_TYPES.has(tx.type)
  );
  if(duplicate)throw new Error('ROUND_ALREADY_SETTLED');
}

// Called with the player after every ledger row (lib/achievements.mjs notes finished goals here).
export const ledgerWatchers = [];

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
  // Floors open on what a player is worth right now, chips minus debt (한서's call); an open floor
  // stays open, though a player worth a thousand of its smallest bets no longer sits there.
  user.account.progressionValue = netWorth(user);
  // The month's rank counts only what a player is worth free of debt: borrowed chips that win
  // count once the loan is repaid (2026-10-19 경제 점검).
  if (debtOf(user) === 0) notePeak(user, user.account.progressionValue);
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
  tallyRow(state, tx);
  noteUsage(state, tx);
  // A newcomer's first chips (start money, first day's pay) open several floors at once before
  // they have played a hand; that's no news for the rest of the casino.
  for (const floor of user.account.totalWagered > 0 ? newly : []) {
    state.feed.unshift({ id:id('feed'), type:'FLOOR_UNLOCK', actorId:user.id, text:`${user.nickname} unlocked ${floor.name}.`, createdAt:new Date().toISOString() });
  }
  if (lockedDelta < 0 && seasonOwedOf(user) > 0) takeSeasonOwed(state, user, -lockedDelta, Math.max(0, amount));
  for (const watch of ledgerWatchers) watch(user);
  return tx;
}

// Chips that were on a table when the season closed (lib/rank-season.mjs) go to the house as the
// round they sat in comes off the table, winnings and all: a hand opened with last month's chips
// pays out last month's money, so an all-in a minute before midnight is no free roll into the new
// month (2026-10-26 리셋 리허설). Each release settles that much of what is owed, at the round's
// payout: half the stake released takes half of what came back.
function takeSeasonOwed(state, user, released, returned) {
  const owed = seasonOwedOf(user);
  const settles = Math.min(owed, released);
  const share = released > 0 ? settles / released : 1;
  const take = Math.min(user.account.available, Math.max(0, Math.floor(returned * share / MONEY_UNIT) * MONEY_UNIT));
  user.account.seasonOwed = Math.max(0, owed - settles);
  if (take > 0) addLedger(state, user, { type: 'SEASON_RESET', amount: -take, referenceType: 'RANK_SEASON', referenceId: null, metadata: { fromTable: true } });
}

// A round played in 100만s settles in 100만s: whatever an engine worked out between units rounds
// to the nearest one, and a loss never takes more than the stake.
const inUnits = (stake, netPnl) => !isMoney(stake) || netPnl < -stake ? netPnl : Math.max(-stake, roundMoney(netPnl));

export function lockBet(state,user,{stake,game,roundId,metadata={}}) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  return addLedger(state,user,{type:'BET_LOCK',amount:-stake,lockedDelta:stake,referenceType:'GAME_ROUND',referenceId:roundId,metadata:{game,stake,...metadata}});
}

export function increaseBetLock(state,user,{stake,game,roundId,metadata={}}) {
  return lockBet(state,user,{stake,game,roundId,metadata:{...metadata,incremental:true}});
}

// 핫 딜러 타임 (lib/hot-table.mjs): a solo house round that opts in with `hot` and wins at the hot
// game inside its window pays the house-funded bonus on top, in the same settlement row.
function withHotBonus(game,stake,netPnl,details,hot){
  const bonus=hot?hotTableBonus(game,stake,netPnl):0;
  return bonus>0?{netPnl:netPnl+bonus,details:{...details,hotTable:{bonus,rate:HOT_BONUS}}}:{netPnl,details};
}

// `wagered` defaults to the released lock; games that reserve a deposit larger than the bet pass the real wager.
export function settleLockedHouseGame(state,user,{game,stake,netPnl,roundId,details={},wagered=stake,hot=false}) {
  assertRoundUnsettled(state,user,roundId);
  netPnl = inUnits(stake, netPnl);
  ({netPnl,details}=withHotBonus(game,stake,netPnl,details,hot));
  if (user.account.locked < stake) throw new Error('LOCKED_STAKE_MISMATCH');
  user.account.totalWagered += wagered;
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
  updateStats(user,game,wagered,netPnl);
  onRoundSettled(state,user,{game,stake:wagered,netPnl});
  if (netPnl <= -3_000_000_000) noteBigLoss(state,user,game,netPnl);
  if (totalBalance(user) === 0) createBankruptcy(state,user,{game,loss:Math.abs(netPnl),stake,roundId});
  return tx;
}

export function settleHouseGame(state, user, {game, stake, netPnl, roundId, details={}, hot=false}) {
  assertRoundUnsettled(state,user,roundId);
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('INVALID_STAKE');
  if (user.account.available < stake) throw new Error('INSUFFICIENT_BANKROLL');
  netPnl = inUnits(stake, netPnl);
  ({netPnl,details}=withHotBonus(game,stake,netPnl,details,hot));
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
  onRoundSettled(state,user,{game,stake,netPnl});
  if (netPnl <= -3_000_000_000) noteBigLoss(state,user,game,netPnl);
  if (totalBalance(user) === 0) createBankruptcy(state,user,{game,loss:Math.abs(netPnl),stake,roundId});
  return tx;
}

// A 30억+ loss goes on the floor feed. The amount is kept as a number and each screen words it
// with the shared money format (lib/news.mjs, public/js/lounge.js), never as 3,000,000,000원.
function noteBigLoss(state, user, game, netPnl) {
  const amount = Math.abs(netPnl);
  state.feed.unshift({id:id('feed'), type:'BIG_LOSS', actorId:user.id, game, amount, text:`${user.nickname}님이 큰 판에서 ${formatMoney(amount)}을 잃었어요.`, createdAt:new Date().toISOString()});
}

function updateStats(user, game, stake, netPnl) {
  noteWrapped(user, { game, stake, netPnl }); // before the lifetime stats count it (lib/wrapped.mjs)
  noteDay(user, { netPnl, balance: totalBalance(user), game });
  noteRp(user, { game, stake, netPnl }); // RP 베타 (lib/rank-points.mjs)
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

function createBankruptcy(state,user,{game,loss,stake=0,roundId}) {
  noteBust(user);
  // sessionLoss is the hand that emptied the wallet; `today` is the whole day up to it (lib/loss-tally.mjs).
  const record={id:id('bust'),userId:user.id,game,sessionLoss:loss,stake,peakBankroll:user.account.peakBankroll,today:todayView(user),month:monthView(user),busts:(user.bankruptcies?.length||0)+1,roundId,createdAt:new Date().toISOString(),comparisons:comparisons(loss)};
  user.bankruptcies.unshift(record);
  // Only the newest bust keeps its chip curve (the bust screen's chart); every state carries the list.
  for (const b of user.bankruptcies.slice(1)) if (b?.today?.curve) delete b.today.curve;
  state.feed.unshift({id:id('feed'),type:'BANKRUPTCY',actorId:user.id,text:`💀 ${user.nickname} went BANKRUPT.`,game,amount:loss,createdAt:new Date().toISOString(),bankruptcyId:record.id});
  record.bailout=autoBailout(state,user);
  return record;
}

export function comparisons(amount) {
  return REFERENCE_PRICES.map(p=>({...p,count:Math.floor(amount/p.price)})).filter(x=>x.count>=1).sort((a,b)=>b.price-a.price).slice(0,4);
}

export function rechargeStatus(user, now = Date.now()) {
  if (user.recharge.dailyDate !== today(now)) {
    user.recharge.dailyDate=today(now); user.recharge.dailyCount=0;
  }
  const total=totalBalance(user);
  const eligibleBalance=total < RECHARGE_TARGET;
  const cooldownRemaining=user.recharge.lastAt ? Math.max(0,RECHARGE_COOLDOWN_MS-(now-Date.parse(user.recharge.lastAt))) : 0;
  const remainingDaily=Math.max(0,DAILY_RECHARGE_LIMIT-user.recharge.dailyCount);
  const amount=Math.max(0,ceilMoney(RECHARGE_TARGET-total)); // tops up in whole 100만s
  // Retired 2026-10-19 (경제 점검): the 구제금융 covers an empty wallet, so the free top-up no longer runs.
  return {eligible:RECHARGE_OPEN && eligibleBalance && cooldownRemaining===0 && remainingDaily>0 && amount>0, amount, cooldownRemaining,remainingDaily,target:RECHARGE_TARGET};
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
  const allowed=[100_000_000,300_000_000,500_000_000];
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
    if (![100_000_000,300_000_000,500_000_000].includes(amount)) throw new Error('INVALID_APPROVED_AMOUNT');
    addLedger(state,user,{type:'ADMIN_GRANT',amount,referenceType:'RECHARGE_REQUEST',referenceId:req.id,metadata:{approvedBy:admin.id}});
    req.status=amount===req.requestedAmount?'APPROVED':'PARTIALLY_APPROVED';
    req.approvedAmount=amount;
  } else req.status='DECLINED';
  req.reviewedAt=new Date().toISOString(); req.reviewedBy=admin.id;
  return req;
}

export function ranking(state,type='wealth') {
  const rows=Object.values(state.users).map(u=>({id:u.id,nickname:u.nickname,accent:u.accent,wealth:netWorth(u),profit:u.account.qualifiedPnl,wagered:u.account.totalWagered,peak:u.account.peakBankroll}));
  const key=type==='profit'?'profit':type==='high-roller'?'wagered':'wealth';
  return rows.sort((a,b)=>b[key]-a[key]).map((r,i)=>({...r,rank:i+1,value:r[key]}));
}

export function floorsFor(user) {
  if (rpEra()) {
    // The RP era: floor i opens at the tier one above its own number (아이언·브론즈 share the Gold Room).
    const points = rpPointsNow(user);
    return FLOORS.map((f,i)=>{const rpNeed=i===0?0:rpTierStart(i+1);const open=floorOpen(user,f);return {...f,rpNeed,unlocked:open,passed:true,entered:open,open,outgrown:false,progress:rpNeed?Math.max(0,Math.min(1,points/rpNeed)):1,remaining:0,rpRemaining:Math.max(0,Math.ceil(rpNeed-points))};});
  }
  return FLOORS.map(f=>({...f,unlocked:user.account.unlockedFloors.includes(f.slug),passed:hasFloorPass(user,f),entered:floorEntered(user,f),open:floorOpen(user,f),outgrown:floorEntered(user,f)&&!floorOpen(user,f),progress:Math.max(0,Math.min(1,user.account.progressionValue/Math.max(1,f.threshold))),remaining:Math.max(0,f.threshold-user.account.progressionValue)}));
}
