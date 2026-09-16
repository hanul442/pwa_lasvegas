import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { INITIAL_BANKROLL, FLOORS } from './constants.mjs';

const DATA_FILE = path.resolve('data/state.json');
const PERSISTENCE_BACKEND = (process.env.VEGAS_PERSISTENCE_BACKEND || 'json').toLowerCase();
const SUPABASE_URL = (process.env.VEGAS_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.VEGAS_SUPABASE_ANON_KEY || '';
const DB_SERVER_SECRET = process.env.VEGAS_DB_SERVER_SECRET || '';
let queue = Promise.resolve();

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

function usingSupabase() {
  return PERSISTENCE_BACKEND === 'supabase';
}

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DB_SERVER_SECRET) {
    throw new Error('SUPABASE_PERSISTENCE_NOT_CONFIGURED');
  }
}

async function supabaseRpc(functionName, body) {
  assertSupabaseConfig();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
      'cache-control': 'no-store'
    },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  if (!response.ok) {
    const detail = raw.slice(0, 500);
    throw new Error(`SUPABASE_RPC_${functionName}_${response.status}:${detail}`);
  }
  return raw ? JSON.parse(raw) : null;
}

async function loadFileState() {
  try {
    const raw = await fs.readFile(DATA_FILE,'utf8');
    return JSON.parse(raw);
  } catch {
    const state = defaultState();
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(state,null,2));
    return state;
  }
}

async function saveFileState(state) {
  state.meta.updatedAt = new Date().toISOString();
  const temp = `${DATA_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state,null,2));
  await fs.rename(temp, DATA_FILE);
}

async function readRemoteEnvelope() {
  const payload = await supabaseRpc('vegas_runtime_load', { p_secret: DB_SERVER_SECRET });
  return {
    state: payload?.state ?? null,
    version: Number(payload?.version ?? 0)
  };
}

async function saveRemoteState(state, expectedVersion) {
  state.meta.updatedAt = new Date().toISOString();
  const nextVersion = await supabaseRpc('vegas_runtime_save', {
    p_secret: DB_SERVER_SECRET,
    p_expected_version: expectedVersion,
    p_state: state
  });
  return Number(nextVersion);
}

async function loadRemoteState() {
  const envelope = await readRemoteEnvelope();
  if (envelope.state) return envelope;

  const initial = defaultState();
  try {
    const version = await saveRemoteState(initial, 0);
    return { state: initial, version };
  } catch (error) {
    // Another request may have initialized the singleton between load and save.
    const retry = await readRemoteEnvelope();
    if (retry.state) return retry;
    throw error;
  }
}

export async function loadState() {
  if (usingSupabase()) {
    const { state } = await loadRemoteState();
    return state;
  }
  return loadFileState();
}

export function mutate(fn) {
  const task = queue.then(async () => {
    if (usingSupabase()) {
      const { state, version } = await loadRemoteState();
      const result = await fn(state);
      await saveRemoteState(state, version);
      return result;
    }

    const state = await loadFileState();
    const result = await fn(state);
    await saveFileState(state);
    return result;
  });
  queue = task.catch(()=>{});
  return task;
}

export function persistenceInfo() {
  return {
    backend: usingSupabase() ? 'supabase' : 'json',
    remoteConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && DB_SERVER_SECRET)
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
