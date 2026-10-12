// Pure state helpers shared by the Node server and the Cloudflare Worker (no file or network access).
import crypto from 'node:crypto';
import { INITIAL_BANKROLL, FLOORS } from './constants.mjs';

export function id(prefix='id') { return `${prefix}_${crypto.randomUUID()}`; }

function defaultUser(idValue, nickname, isAdmin=false, accent='♠', bankroll=INITIAL_BANKROLL) {
  const now = new Date().toISOString();
  return {
    id: idValue, nickname, isAdmin, accent,
    account: {
      available: bankroll,
      locked: 0,
      rawPnl: 0,
      qualifiedPnl: 0,
      totalWagered: 0,
      peakBankroll: bankroll,
      progressionValue: bankroll,
      unlockedFloors: ['corner']
    },
    recharge: { lastAt: null, dailyDate: now.slice(0,10), dailyCount: 0, total: 0 },
    stats: {},
    bankruptcies: [],
    createdAt: now
  };
}

const ACCENTS = ['♠','♥','◆','♣','●','▲','★','■'];
// A new player joins with the starting bankroll, recorded in the ledger like the seeded players.
export function newUser(state, idValue, nickname) {
  const user = defaultUser(idValue, nickname, false, ACCENTS[Object.keys(state.users).length % ACCENTS.length]);
  state.users[idValue] = user;
  state.ledger.push({
    id:id('tx'), userId:idValue, type:'INITIAL_GRANT', amount:INITIAL_BANKROLL,
    availableBefore:0, availableAfter:INITIAL_BANKROLL, lockedBefore:0, lockedAfter:0,
    rawPnlDelta:0, qualifiedPnlDelta:0, referenceType:'SYSTEM', referenceId:null,
    createdAt:user.createdAt, metadata:{signup:true}
  });
  user.credit = { score: 500 };
  return user;
}

export function defaultState() {
  const now = new Date().toISOString();
  // The original profile and the demo regulars were seeded before the bank existed, with 10억 each.
  const SEED = 1_000_000_000;
  const users = {
    hanseo: defaultUser('hanseo','HANSEO',true,'♠',SEED),
    min: defaultUser('min','MIN',false,'◆',SEED),
    june: defaultUser('june','JUNE',false,'●',SEED),
    zero: defaultUser('zero','ZERO',false,'▲',SEED)
  };
  // Demo variety is fully accounted for in the seed ledger below.
  users.min.account.available = 3_820_000_000;
  users.min.account.peakBankroll = 3_820_000_000;
  users.min.account.progressionValue = 3_820_000_000;
  users.june.account.available = 740_000_000;
  users.june.account.rawPnl = -260_000_000;
  users.june.account.qualifiedPnl = -260_000_000;
  users.june.account.progressionValue = 740_000_000;
  users.zero.account.available = 12_400_000_000;
  users.zero.account.peakBankroll = 12_400_000_000;
  users.zero.account.progressionValue = 12_400_000_000;
  users.zero.account.qualifiedPnl = 9_400_000_000;
  users.zero.account.rawPnl = 9_400_000_000;
  users.zero.account.totalWagered = 9_400_000_000;
  const ledger=[];
  for (const u of Object.values(users)) {
    recalcUnlocks(u);
    ledger.push({
      id:id('tx'), userId:u.id, type:'INITIAL_GRANT', amount:SEED,
      availableBefore:0, availableAfter:SEED, lockedBefore:0, lockedAfter:0,
      rawPnlDelta:0, qualifiedPnlDelta:0, referenceType:'SYSTEM', referenceId:null,
      createdAt:now, metadata:{seeded:true}
    });
  }
  ledger.push({id:id('tx'),userId:'min',type:'ADMIN_GRANT',amount:2_820_000_000,availableBefore:1_000_000_000,availableAfter:3_820_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:0,qualifiedPnlDelta:0,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true}});
  ledger.push({id:id('tx'),userId:'june',type:'GAME_LOSS',amount:-260_000_000,availableBefore:1_000_000_000,availableAfter:740_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:-260_000_000,qualifiedPnlDelta:-260_000_000,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true,game:'Blackjack',stake:260_000_000}});
  ledger.push({id:id('tx'),userId:'zero',type:'GAME_WIN',amount:9_400_000_000,availableBefore:1_000_000_000,availableAfter:10_400_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:9_400_000_000,qualifiedPnlDelta:9_400_000_000,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true,game:'Baccarat',stake:9_400_000_000}});
  ledger.push({id:id('tx'),userId:'zero',type:'ADMIN_GRANT',amount:2_000_000_000,availableBefore:10_400_000_000,availableAfter:12_400_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:0,qualifiedPnlDelta:0,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true}});
  return {
    meta: { version: 1, economy: 3, createdAt: now, updatedAt: now },
    users,
    ledger,
    rechargeRequests: [],
    rounds: [],
    feed: [
      { id:id('feed'), type:'SYSTEM', actorId:null, text:'SOCIAL VEGAS table floor is open.', createdAt:now }
    ]
  };
}

export function publicUser(user) {
  return {
    id:user.id, nickname:user.nickname, isAdmin:user.isAdmin, accent:user.accent,
    account:{...user.account}, recharge:{...user.recharge}, stats:{...user.stats},
    bankruptcies:[...user.bankruptcies]
  };
}

// What a player owes the bank right now (interest is added to each loan as days pass).
export function debtOf(user) {
  return (Array.isArray(user?.loans) ? user.loans : []).reduce((sum, loan) => sum + (loan.balance || 0), 0);
}
// Chips held, on the table included, minus debt. Floors open and close on this.
export function netWorth(user) {
  return user.account.available + user.account.locked - debtOf(user);
}

// A floor a player may sit at now: opened once, and not yet outgrown.
export function floorOpen(user, floor) {
  if (!floor) return false;
  return user.account.unlockedFloors.includes(floor.slug) && (floor.ceiling == null || netWorth(user) <= floor.ceiling);
}

// The smallest bet at the cheapest table a player may sit at now. Pay, handouts and loan limits
// are counted in these, so they mean the same at The Corner as in The Vault.
export function tableBase(user) {
  return FLOORS.find(f => floorOpen(user, f))?.minBet ?? FLOORS[0].minBet;
}

export function recalcUnlocks(user) {
  const newlyUnlocked=[];
  for (const floor of FLOORS) {
    if (user.account.progressionValue >= floor.threshold && !user.account.unlockedFloors.includes(floor.slug)) {
      user.account.unlockedFloors.push(floor.slug);
      newlyUnlocked.push(floor);
    }
  }
  return newlyUnlocked;
}
