import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultState } from './state.mjs';

export { id, defaultState, publicUser, recalcUnlocks } from './state.mjs';

const DATA_FILE = path.resolve('data/state.json');
const PERSISTENCE_BACKEND = (process.env.VEGAS_PERSISTENCE_BACKEND || 'json').toLowerCase();
const SUPABASE_URL = (process.env.VEGAS_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.VEGAS_SUPABASE_ANON_KEY || '';
const DB_SERVER_SECRET = process.env.VEGAS_DB_SERVER_SECRET || '';
let queue = Promise.resolve();

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
