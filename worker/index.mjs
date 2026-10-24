// Cloudflare Worker for the game API. One Durable Object holds the whole floor's state,
// so every bet is applied in order, just like the Node server's file store.
import { DurableObject } from 'cloudflare:workers';
import { handleApi, prepareState } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { runPushRound } from '../lib/notifications.mjs';
import { compactHistory } from '../lib/history.mjs';

const CHUNK = 256 * 1024; // stay well under the per-value storage limit as the ledger grows

// put() takes at most 128 keys at a time; a write bigger than that goes in batches.
async function putAll(storage, entries) {
  const list = Object.entries(entries);
  for (let i = 0; i < list.length; i += 120) await storage.put(Object.fromEntries(list.slice(i, i + 120)));
}

export class VegasFloor extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
    // The parsed floor, kept between requests: this object is the only writer of its storage, so
    // the copy in memory stays true until a change fails (then it is dropped and read again).
    this.state = null;
  }

  // Requests arriving together before the floor is in memory share one read of storage, so they
  // all hold the same object and no change is made to a copy that is then replaced.
  read() {
    if (this.state) return Promise.resolve(this.state);
    this.reading ??= this.readStorage().finally(() => { this.reading = null; });
    return this.reading;
  }

  async readStorage() {
    const count = await this.ctx.storage.get('state:n');
    if (!count) {
      const state = defaultState();
      await this.save(state);
      this.state = state;
      return state;
    }
    const keys = Array.from({ length: count }, (_, i) => `state:${i}`);
    const parts = await this.ctx.storage.get(keys);
    this.state = JSON.parse(keys.map(k => parts.get(k)).join(''));
    return this.state;
  }

  // Reads wait for changes already queued, so they never see one half applied.
  load() {
    return this.queue.then(() => this.read());
  }

  async save(state, cold = null) {
    state.meta.updatedAt = new Date().toISOString();
    // History moved out of the live state (lib/history.mjs) is written first: if the state write
    // then failed, a row would only be archived twice, never lost.
    if (cold) {
      const rawCold = JSON.stringify(cold);
      const stamp = state.meta.compactedAt || state.meta.updatedAt;
      const archive = {};
      for (let i = 0, k = 0; i < rawCold.length; i += CHUNK, k++) archive[`archive:${stamp}:${k}`] = rawCold.slice(i, i + CHUNK);
      await putAll(this.ctx.storage, archive);
    }
    const raw = JSON.stringify(state);
    const before = (await this.ctx.storage.get('state:n')) || 0;
    const entries = {};
    let n = 0;
    for (let i = 0; i < raw.length; i += CHUNK) entries[`state:${n++}`] = raw.slice(i, i + CHUNK);
    entries['state:n'] = n;
    await putAll(this.ctx.storage, entries);
    if (before > n) await this.ctx.storage.delete(Array.from({ length: before - n }, (_, i) => `state:${n + i}`));
  }

  mutate(fn) {
    const task = this.queue.then(async () => {
      const state = await this.read();
      try {
        const result = await fn(state);
        await this.save(state, compactHistory(state));
        return result;
      } catch (e) {
        this.state = null;
        throw e;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  // Hourly cron: send whatever reminders are due. Only the scheduled() handler below can reach this.
  async pushRound() {
    const store = { load: () => this.load(), mutate: fn => this.mutate(fn) };
    return runPushRound(store, { subject: this.env.VAPID_SUBJECT, prepare: prepareState });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const req = {
      method: request.method,
      header: name => request.headers.get(name),
      body: async () => {
        const raw = await request.text();
        if (raw.length > 100_000) throw new Error('PAYLOAD_TOO_LARGE');
        return raw ? JSON.parse(raw) : {};
      }
    };
    const store = { load: () => this.load(), mutate: fn => this.mutate(fn) };
    const { status, data } = await handleApi(req, url, store, { NODE_ENV: 'production', AUTH_REQUIRED: true, SOURCE_COMMIT: this.env.SOURCE_COMMIT, SOURCE_BRANCH: 'main' });
    return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }
}

function cors(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-idempotency-key',
    'access-control-max-age': '86400',
    vary: 'origin'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!url.pathname.startsWith('/api/')) return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers });
    const floor = env.FLOOR.get(env.FLOOR.idFromName('main'));
    const res = await floor.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    return out;
  },

  async scheduled(event, env, ctx) {
    const floor = env.FLOOR.get(env.FLOOR.idFromName('main'));
    ctx.waitUntil(floor.pushRound().then(r => console.log('push round', JSON.stringify(r))));
  }
};
