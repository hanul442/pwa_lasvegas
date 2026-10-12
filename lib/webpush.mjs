// Web Push without dependencies: VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291),
// built on Web Crypto so the same code runs in the Cloudflare Worker and in Node.
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// The server's signing identity. The public half goes to browsers as applicationServerKey.
export async function generateVapidKeys() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64url(await subtle.exportKey('raw', pair.publicKey));
  const { kty, crv, x, y, d } = await subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateJwk: { kty, crv, x, y, d } };
}

export async function vapidAuthorization(endpoint, vapid, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${vapid.publicKey}`;
}

// Encrypts one message for one browser subscription as a single aes128gcm record.
export async function encryptPayload(subscription, text) {
  const uaPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  const local = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', local.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(text), new Uint8Array([2])); // 0x02 marks the last (only) record
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Sends one notification. Returns {ok, gone}: gone means the browser dropped the subscription.
export async function sendPush(subscription, message, { vapid, subject, fetchFn = fetch, ttl = 24 * 3600 } = {}) {
  let res;
  try {
    // A key the push service accepted but we can't use only fails this one device.
    const body = await encryptPayload(subscription, JSON.stringify(message));
    res = await fetchFn(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(subscription.endpoint, vapid, subject),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttl),
        urgency: 'normal',
        ...(message.tag ? { topic: String(message.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {})
      },
      body
    });
  } catch {
    return { ok: false, gone: false, status: 0 };
  }
  return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
}
