// Offline app shell. Game and chip API responses are never cached: the server stays authoritative.
const CACHE = 'vegas-shell-v6';
const SHELL = [
  './', 'index.html', 'styles.css', 'table.css', 'app.js', 'icon.svg', 'manifest.webmanifest',
  'js/config.js', 'js/music.js', 'js/api.js', 'js/fx.js', 'js/cards.js', 'js/chips.js', 'js/table.js',
  'js/games/blackjack.js', 'js/games/baccarat.js', 'js/games/roulette.js', 'js/games/dice.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so new builds show up immediately; fall back to the cached shell offline.
  event.respondWith(
    fetch(event.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return res; })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('index.html')))
  );
});
