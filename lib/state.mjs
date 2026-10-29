// Pure state helpers shared by the Node server and the Cloudflare Worker (no file or network access).
import crypto from 'node:crypto';
import { INITIAL_BANKROLL, FLOORS, roundMoney, REWARD_BASE_CAP, LOAN_BASE_CAP, NEW_ACCOUNT_DAYS, NEW_ACCOUNT_ROOM_FLOOR_MAX } from './constants.mjs';
import { PASS_ITEMS } from './cosmetics.mjs';
import { todayView, monthView } from './loss-tally.mjs';

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
      unlockedFloors: [FLOORS[0].slug]
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

// The demo regulars seeded with every new floor: AI profiles nobody plays, kept out of the rankings.
export const DEMO_PLAYERS = ['min', 'june', 'zero'];

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
    // The seeded profiles date from before floor passes, so they keep what they reached.
    u.account.floorPasses = u.account.unlockedFloors.filter(slug => PASS_ITEMS[slug]);
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
    meta: { version: 1, economy: 4, floorPasses: true, seasonPasses: true, luxuryRefund: true, createdAt: now, updatedAt: now },
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
    id:user.id, nickname:user.nickname, isAdmin:user.isAdmin, accent:user.accent, guest:Boolean(user.guest),
    account:{...user.account}, recharge:{...user.recharge}, stats:{...user.stats},
    bankruptcies:[...user.bankruptcies],
    // 오늘의 손익 (lib/loss-tally.mjs): the day's won/lost/peak, shown at the tables.
    today:todayView(user),
    month:monthView(user),
    // 족보 도감: how many hands this player has collected (lib/hand-book.mjs), for the player card.
    jokbo:Object.keys(user.handBook&&typeof user.handBook==='object'?user.handBook:{}).length,
    // 꾸미기 (lib/shop.mjs): the skins this player wears.
    cosmetics:{
      owned:[...(Array.isArray(user.cosmetics?.owned)?user.cosmetics.owned:[])],
      equipped:{cardBack:null,felt:null,chips:null,frame:null,...(user.cosmetics?.equipped||{})}
    }
  };
}

// What a player owes the bank right now (interest is added to each loan as days pass).
export function debtOf(user) {
  return (Array.isArray(user?.loans) ? user.loans : []).reduce((sum, loan) => sum + (loan.balance || 0), 0);
}
// Chips that sat on a table when the monthly season closed belong to the house: they are taken
// back as they come off the table (lib/economy.mjs addLedger), and count like debt until then.
export const seasonOwedOf = user => Math.max(0, user?.account?.seasonOwed || 0);
// Chips held, on the table included, minus debt. Floors open and close on this.
export function netWorth(user) {
  return user.account.available + user.account.locked - debtOf(user) - seasonOwedOf(user);
}

// Every floor above the Gold Room also wants this season's pass: buying one of its skins
// (lib/cosmetics.mjs), or buying it again once a new month has started (lib/shop.mjs). Passes
// live in account.floorPasses, which the monthly reset empties; the skins themselves stay.
export function hasFloorPass(user, floor) {
  if (!floor || !PASS_ITEMS[floor.slug]) return true;
  return Array.isArray(user.account.floorPasses) && user.account.floorPasses.includes(floor.slug);
}
// Reached by net worth and holding its pass.
export function floorEntered(user, floor) {
  return Boolean(floor) && user.account.unlockedFloors.includes(floor.slug) && hasFloorPass(user, floor);
}
// A floor a player may sit at now: entered, and not yet outgrown. A floor is outgrown only once
// the one above is entered, so a player who has not bought the next pass keeps playing here.
export function floorOpen(user, floor) {
  if (!floorEntered(user, floor)) return false;
  if (floor.ceiling == null || netWorth(user) <= floor.ceiling) return true;
  const at = FLOORS.findIndex(f => f.slug === floor.slug);
  return at >= 0 && !floorEntered(user, FLOORS[at + 1]);
}
// Why a player may not sit at a floor, as the API error, or null when they may.
export function floorRefusal(user, floor) {
  if (!user.account.unlockedFloors.includes(floor.slug)) return 'FLOOR_LOCKED';
  if (!hasFloorPass(user, floor)) return 'FLOOR_PASS_REQUIRED';
  if (!floorOpen(user, floor)) return 'FLOOR_OUTGROWN';
  return null;
}

// The smallest bet at the cheapest table a player may sit at now. Pay, handouts and loan limits
// are counted in these, so they mean the same in the Gold Room as in The Vault.
export function tableBase(user) {
  return FLOORS.find(f => floorOpen(user, f))?.minBet ?? FLOORS[0].minBet;
}

// What pay, missions, achievements and prizes are counted in: the table base, up to the Vault.
export const rewardBase = user => Math.min(tableBase(user), REWARD_BASE_CAP);
// What loan limits are counted in: the table base, up to the Sky Lounge.
export const loanBase = user => Math.min(tableBase(user), LOAN_BASE_CAP);

// A friends' room on `floor` is off limits to an account younger than a week above the High Limit.
export function newAccountRoomRefusal(user, floor, now = Date.now()) {
  if (!floor || floor.minBet <= NEW_ACCOUNT_ROOM_FLOOR_MAX || user?.isAdmin) return null;
  const born = Date.parse(user?.createdAt || '');
  if (!Number.isFinite(born) || now - born >= NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000) return null;
  return 'NEW_ACCOUNT_ROOM_LIMIT';
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
