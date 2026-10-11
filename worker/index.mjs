// Cloudflare Worker for the game API. One Durable Object holds the whole floor's state,
// so every bet is applied in order, just like the Node server's file store.
import { DurableObject } from 'cloudflare:workers';
import { handleApi } from '../lib/api.mjs';
import { defaultState } from '../lib/state.mjs';
import { runPushRound } from '../lib/notifications.mjs';

const CHUNK = 256 * 1024; // stay well under the per-value storage limit as the ledger grows

export class VegasFloor extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
  }

  async load() {
    const count = await this.ctx.storage.get('state:n');
    if (!count) {
      const state = defaultState();
      await this.save(state);
      return state;
    }
    const keys = Array.from({ length: count }, (_, i) => `state:${i}`);
    const parts = await this.ctx.storage.get(keys);
    return JSON.parse(keys.map(k => parts.get(k)).join(''));
  }

  async save(state) {
    state.meta.updatedAt = new Date().toISOString();
    const raw = JSON.stringify(state);
    const before = (await this.ctx.storage.get('state:n')) || 0;
    const entries = {};
    let n = 0;
    for (let i = 0; i < raw.length; i += CHUNK) entries[`state:${n++}`] = raw.slice(i, i + CHUNK);
    entries['state:n'] = n;
    await this.ctx.storage.put(entries);
    if (before > n) await this.ctx.storage.delete(Array.from({ length: before - n }, (_, i) => `state:${n + i}`));
  }

  mutate(fn) {
    const task = this.queue.then(async () => {
      const state = await this.load();
      const result = await fn(state);
      await this.save(state);
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  // Hourly cron: send whatever reminders are due. Only the scheduled() handler below can reach this.
  async pushRound() {
    const store = { load: () => this.load(), mutate: fn => this.mutate(fn) };
    return runPushRound(store, { subject: this.env.VAPID_SUBJECT });
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
