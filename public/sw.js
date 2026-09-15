const CACHE_NAME = 'social-vegas-shell-v17';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/game-stability.js',
  '/instant-idempotency.js',
  '/baccarat-trace.js',
  '/baccarat-trace.css',
  '/baccarat-chip-motion.js',
  '/baccarat-chip-motion.css',
  '/roulette-trace.js',
  '/roulette-trace.css',
  '/roulette-chip-motion.js',
  '/roulette-chip-motion.css',
  '/sicbo-trace.js',
  '/sicbo-trace.css',
  '/sicbo-chip-motion.js',
  '/sicbo-chip-motion.css',
  '/runtime-provenance.js',
  '/runtime-provenance.css',
  '/vault-record-room.js',
  '/vault-record-room.css',
  '/casino-chip-motion.js',
  '/casino-chip-motion.css',
  '/blackjack-v2.css',
  '/blackjack-stability.css',
  '/blackjack-chip-motion.css',
  '/blackjack-v2.js',
  '/blackjack-session.js',
  '/casino-audio.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/icon.svg',
  '/icons/maskable.svg',
  '/robots.txt'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/offline.html'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone());
      return fresh;
    } catch {
      return caches.match('/offline.html');
    }
  })());
});
