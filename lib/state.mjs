// Pure state helpers shared by the Node server and the Cloudflare Worker (no file or network access).
import crypto from 'node:crypto';
import { INITIAL_BANKROLL, FLOORS } from './constants.mjs';

export function id(prefix='id') { return `${prefix}_${crypto.randomUUID()}`; }

function defaultUser(idValue, nickname, isAdmin=false, accent='♠') {
  const now = new Date().toISOString();
  return {
    id: idValue, nickname, isAdmin, accent,
    account: {
      available: INITIAL_BANKROLL,
      locked: 0,
      rawPnl: 0,
      qualifiedPnl: 0,
      totalWagered: 0,
      peakBankroll: INITIAL_BANKROLL,
      progressionValue: INITIAL_BANKROLL,
      unlockedFloors: ['downtown','strip']
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
  return user;
}

export function defaultState() {
  const now = new Date().toISOString();
  const users = {
    hanseo: defaultUser('hanseo','HANSEO',true,'♠'),
    min: defaultUser('min','MIN',false,'◆'),
    june: defaultUser('june','JUNE',false,'●'),
    zero: defaultUser('zero','ZERO',false,'▲')
  };
  // Demo variety is fully accounted for in the seed ledger below.
  users.min.account.available = 382_000_000;
  users.min.account.peakBankroll = 382_000_000;
  users.june.account.available = 74_000_000;
  users.june.account.rawPnl = -26_000_000;
  users.june.account.qualifiedPnl = -26_000_000;
  users.june.account.progressionValue = 74_000_000;
  users.zero.account.available = 1_240_000_000;
  users.zero.account.peakBankroll = 1_240_000_000;
  users.zero.account.progressionValue = 1_040_000_000;
  users.zero.account.qualifiedPnl = 940_000_000;
  users.zero.account.rawPnl = 940_000_000;
  users.zero.account.totalWagered = 940_000_000;
  users.zero.account.unlockedFloors = ['downtown','strip','high-limit'];
  const ledger=[];
  for (const u of Object.values(users)) {
    ledger.push({
      id:id('tx'), userId:u.id, type:'INITIAL_GRANT', amount:INITIAL_BANKROLL,
      availableBefore:0, availableAfter:INITIAL_BANKROLL, lockedBefore:0, lockedAfter:0,
      rawPnlDelta:0, qualifiedPnlDelta:0, referenceType:'SYSTEM', referenceId:null,
      createdAt:now, metadata:{seeded:true}
    });
  }
  ledger.push({id:id('tx'),userId:'min',type:'ADMIN_GRANT',amount:282_000_000,availableBefore:100_000_000,availableAfter:382_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:0,qualifiedPnlDelta:0,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true}});
  ledger.push({id:id('tx'),userId:'june',type:'GAME_LOSS',amount:-26_000_000,availableBefore:100_000_000,availableAfter:74_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:-26_000_000,qualifiedPnlDelta:-26_000_000,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true,game:'Blackjack',stake:26_000_000}});
  ledger.push({id:id('tx'),userId:'zero',type:'GAME_WIN',amount:940_000_000,availableBefore:100_000_000,availableAfter:1_040_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:940_000_000,qualifiedPnlDelta:940_000_000,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true,game:'Baccarat',stake:940_000_000}});
  ledger.push({id:id('tx'),userId:'zero',type:'ADMIN_GRANT',amount:200_000_000,availableBefore:1_040_000_000,availableAfter:1_240_000_000,lockedBefore:0,lockedAfter:0,rawPnlDelta:0,qualifiedPnlDelta:0,referenceType:'DEMO_SEED',referenceId:null,createdAt:now,metadata:{seeded:true}});
  return {
    meta: { version: 1, createdAt: now, updatedAt: now },
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
