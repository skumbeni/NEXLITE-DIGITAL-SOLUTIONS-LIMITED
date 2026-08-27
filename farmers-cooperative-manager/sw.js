/* Pool — offline-first service worker.
   Caches the app shell (this is a single-file HTML PWA) so the UI still loads with
   no connection; Firebase Auth/RTDB traffic is left untouched since it's mostly
   websocket + POST and this worker only intercepts cacheable GETs. */

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'pool-shell-' + CACHE_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_SHELL.map(url =>
        cache.add(new Request(url, { mode: url.startsWith('http') ? 'no-cors' : 'same-origin' }))
          .catch(() => null) // one bad/unreachable asset (e.g. first install offline) shouldn't fail the whole install
      ))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GETs — Firebase Auth/RTDB REST calls are POST/websocket and pass straight through.
  if (req.method !== 'GET') return;

  // Never cache Firebase Realtime Database REST/long-polling traffic — always wants fresh data.
  if (req.url.includes('firebaseio.com') || req.url.includes('firebasedatabase.app')) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached); // offline: fall back to whatever's cached

      // Stale-while-revalidate: serve cached instantly if we have it, refresh in background;
      // otherwise wait on the network.
      return cached || network;
    })
  );
});
