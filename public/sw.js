// Offline app shell. Game and chip API responses are never cached: the server stays authoritative.
const CACHE = 'vegas-shell-v15';
const SHELL = [
  './', 'index.html', 'styles.css', 'table.css', 'hwatu.css', 'app.js', 'icon.svg', 'logo.svg', 'manifest.webmanifest',
  'js/config.js', 'js/music.js', 'js/api.js', 'js/fx.js', 'js/cards.js', 'js/chips.js', 'js/table.js',
  'js/games/blackjack.js', 'js/games/baccarat.js', 'js/games/roulette.js', 'js/games/dice.js', 'js/games/holdem.js',
  'js/hwatu.js', 'js/guide.js', 'js/guides.js', 'js/games/matgo.js', 'js/games/seotda.js',
  'js/settings.js', 'js/settings-panel.js',
  'lounge.css', 'js/lounge.js', 'js/bigwin.js', 'js/social.js', 'js/games/slots.js', 'js/voice.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL).then(() => cacheVoice(cache))).then(() => self.skipWaiting()));
});

// The dealer's call-outs (under 1 MB) so he still speaks offline. Best effort: a miss here only
// means that line is fetched the first time it is needed.
function cacheVoice(cache) {
  return fetch('voice/lines.json')
    .then(res => res.json())
    .then(ids => cache.addAll(ids.map(id => `voice/${id}.mp3`)))
    .catch(() => {});
}

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
