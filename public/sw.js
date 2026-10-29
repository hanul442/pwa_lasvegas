// Offline app shell. Game and chip API responses are never cached: the server stays authoritative.
const CACHE = 'vegas-shell-v119';
const SHELL = [
  './', 'index.html', 'styles.css', 'table.css', 'hwatu.css', 'app.js', 'icon.svg', 'logo.svg', 'manifest.webmanifest',
  'js/config.js', 'js/music.js', 'js/api.js', 'js/fx.js', 'js/money.js', 'js/cards.js', 'js/chips.js', 'js/table.js',
  'js/games/blackjack.js', 'js/games/baccarat.js', 'js/games/roulette.js', 'js/games/dice.js', 'js/games/holdem.js', 'js/games/holdem-view.js', 'js/games/holdem-room.js',
  'js/hwatu.js', 'js/guide.js', 'js/guides.js', 'js/games/matgo.js', 'js/games/gostop.js', 'js/games/seotda.js', 'js/games/room-client.js', 'js/games/seat-elsewhere.js',
  'js/settings.js', 'js/settings-panel.js', 'js/auth.js', 'js/account.js', 'js/admin.js', 'js/bj-strategy.js',
  'lounge.css', 'js/lounge.js', 'js/hot.js', 'js/bigwin.js', 'js/social.js', 'js/games/slots.js', 'js/games/horses.js', 'horses.css', 'js/voice.js', 'crowd.css', 'js/npc.js', 'js/notify.js', 'js/news.js', 'js/bust.js', 'js/day-chart.js', 'js/day-sheet.js', 'icon-192.png', 'js/install.js', 'js/bank.js', 'js/double-down.js', 'js/double-or-nothing.js', 'js/event-table.js', 'js/event-result.js', 'js/poker-hand.js', 'apple-touch-icon.png', 'icon-512.png', 'js/shop.js', 'shop.css', 'js/table-nav.js', 'js/names.js', 'js/notice.js', 'js/ledger.js', 'js/terms.js', 'js/playtime.js', 'js/games/sevenpoker.js', 'art/sevenpoker.webp', 'js/rank.js', 'js/error-report.js', 'js/invite.js', 'js/room-chat.js', 'js/shine.js', 'js/guest.js', 'js/first-day.js', 'js/hand-book.js', 'js/replay.js', 'jokbo.css', 'fold.css', 'js/wrapped.js', 'dealer.css', 'js/dealer.js', 'js/toke.js', 'js/haptics.js', 'js/gestures.js', 'js/share.js', 'js/brags.js', 'js/banter.js', 'js/daily.js', 'js/nightly.js', 'js/rank-tab.js', 'js/friends.js', 'js/cashier.js', 'js/rp-pop.js', 'js/seen.js',
  // The app's own fonts (public/fonts). The '-ext' Hangul files are fetched only when a rare syllable shows up.
  'fonts.css', 'fonts/archivo.woff2', 'fonts/noto-kr-400.woff2', 'fonts/noto-kr-500.woff2', 'fonts/noto-kr-700.woff2',
  // Recorded card, chip and dice sounds (public/sfx, about 180 KB), kept in step with SFX_FILES in js/fx.js.
  ...'card-deal-1 card-deal-2 card-deal-3 card-deal-4 card-flip-1 card-flip-2 card-place-1 card-place-2 card-place-3 card-gather-1 card-gather-2 card-shuffle card-fan chip-lay-1 chip-lay-2 chip-lay-3 chips-stack-1 chips-stack-2 chips-stack-3 chips-stack-4 chips-stack-5 chips-stack-6 chips-collide-1 chips-collide-2 chips-collide-3 chips-collide-4 chips-handle-1 chips-handle-5 chips-handle-6 dice-shake-1 dice-shake-2 die-throw-1 die-throw-2 die-throw-3 die-throw-4'.split(' ').map(id => `sfx/${id}.m4a`),
  ...'blackjack roulette baccarat dice poker slots horses matgo gostop seotda royale tazza oceans rounders montecarlo casablanca godofgamblers whale'.split(' ').map(id => `art/${id}.webp`)
];

// A new build installs next to the running one and waits: the open app keeps getting one consistent set of files
// (a game opened later still matches the code already running). The app offers "새로고침", which posts
// 'skip-waiting'; a closed and reopened app picks the new build up by itself. The first install takes over at once.
self.addEventListener('install', event => {
  const code = SHELL.filter(url => !MEDIA.test(url)), media = SHELL.filter(url => MEDIA.test(url));
  const fresh = code.map(url => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE)
    .then(cache => Promise.all([cache.addAll(fresh), ...media.map(url => carry(cache, url))]).then(() => cacheVoice(cache)))
    .then(() => { if (!self.registration.active) self.skipWaiting(); }));
});
self.addEventListener('message', event => { if (event.data === 'skip-waiting') self.skipWaiting(); });

// On a laptop dev server the files change under you, so there it stays network first.
const DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

// The dealer's call-outs (under 1 MB) so he still speaks offline. Best effort: a miss here only
// means that line is fetched the first time it is needed.
function cacheVoice(cache) {
  return fetch('voice/lines.json')
    .then(res => res.json())
    .then(ids => Promise.all(ids.map(id => carry(cache, `voice/${id}.mp3`))))
    .catch(() => {});
}

// Recordings and pictures never change under the same name, so a new build copies them from the
// build it replaces instead of downloading them all again on every update.
const MEDIA = /^(voice|sfx|art)\//;
async function carry(cache, url) {
  const hit = await caches.match(url);
  if (hit) return cache.put(url, hit);
  return cache.add(url);
}

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // The dealer's recorded lines and the table sounds never change once cut: answer from the cache at once, so the first
  // call-out at a table isn't waiting on a phone network.
  if ((url.pathname.includes('/voice/') && url.pathname.endsWith('.mp3')) || (url.pathname.includes('/sfx/') && url.pathname.endsWith('.m4a'))) {
    event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); }
      return res;
    })));
    return;
  }
  const navigate = event.request.mode === 'navigate';
  if (DEV) {
    event.respondWith(
      fetch(event.request)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return res; })
        .catch(() => caches.match(event.request).then(hit => hit || caches.match('index.html')))
    );
    return;
  }
  // This build's own files straight from its cache: the home screen opens without waiting on the network, and a
  // new build arrives through the waiting worker above. Anything not cached yet comes from the network.
  event.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(event.request, { ignoreSearch: navigate });
    if (hit) return hit;
    try {
      const res = await fetch(event.request);
      if (res.ok && res.type === 'basic' && !navigate) cache.put(event.request, res.clone());
      return res;
    } catch (err) {
      const shell = navigate && await cache.match('./');
      if (shell) return shell;
      throw err;
    }
  }));
});

// Reminders from the hourly cron (lib/notifications.mjs): daily bonus, free chips, come back.
self.addEventListener('push', event => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'VEGAS', {
    body: msg.body || '',
    icon: 'icon-192.png',
    tag: msg.tag || undefined,
    renotify: Boolean(msg.tag),
    lang: 'ko',
    data: { url: msg.url || './' }
  }));
});

// Tapping a reminder brings the open app forward, or opens it.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
