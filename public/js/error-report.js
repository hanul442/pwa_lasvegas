// Sends script errors from this phone to the operator's 오류 기록 (lib/error-log.mjs).
// At most a few per page load, each message once, so a loop can't flood the server.
import { API_BASE } from './config.js';
import { sessionToken } from './api.js';

const MAX_PER_LOAD = 5;
const sent = new Set();
const SHELL = 'vegas-shell'; // which build: the service worker cache name carries its version

async function build() {
  try { return (await caches.keys()).find(k => k.startsWith(SHELL)) || ''; } catch { return ''; }
}

export async function reportError(message, stack = '', where = '') {
  const key = `${message}|${where}`;
  if (!message || sent.has(key) || sent.size >= MAX_PER_LOAD) return;
  sent.add(key);
  const headers = { 'content-type': 'application/json' };
  const token = sessionToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const body = { message: String(message).slice(0, 300), stack: String(stack || '').slice(0, 1200), where: where || `${location.pathname}${location.hash}`, ua: navigator.userAgent.slice(0, 120), build: await build() };
  try { await fetch(`${API_BASE}/api/client-error`, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true }); } catch {}
}

export function watchErrors() {
  addEventListener('error', e => {
    if (!e.error && !e.message) return; // a broken image or script tag, not a script error
    const src = e.filename ? `${e.filename.replace(location.origin, '')}:${e.lineno}:${e.colno}` : '';
    reportError(e.message || String(e.error), e.error?.stack, src);
  });
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    if (r?.name === 'ApiError' || r?.code) return; // the game's own refusals already show as toasts
    reportError(r?.message || String(r), r?.stack, `${location.pathname}${location.hash} (promise)`);
  });
}
