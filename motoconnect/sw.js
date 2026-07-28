// MotoConnect Zambia — Service Worker
// Repo: skumbeni/Motoconnect → served at /Motoconnect/
// Based on proven GitHub Pages PWA pattern

const GHPATH = '/Motoconnect';
const CACHE  = 'mc-v8';

// Every URL the app needs to open offline — both slash forms required
const URLS = [
  `${GHPATH}/`,
  `${GHPATH}/index.html`,
  `${GHPATH}/sw.js`,
  `${GHPATH}/manifest.json`,
  `${GHPATH}/privacy.html`,
  `${GHPATH}/tos.html`,
];

// ── INSTALL: pre-cache shell URLs individually so one missing file
// doesn't abort the whole install and leave the app uncacheable.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(
        URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Failed to cache on install (will retry on fetch):', url, err);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: wipe old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first for shell, network-only for Firebase/APIs ──
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // Firebase REST, auth, geocoding — always network, never cache
  if (
    url.includes('firebaseio.com')    ||
    url.includes('googleapis.com')    ||
    url.includes('identitytoolkit')   ||
    url.includes('nominatim.openstreetmap.org')
  ) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Serve from cache immediately; refresh cache in background
        fetch(e.request)
          .then(res => { if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res)); })
          .catch(() => {});
        return cached;
      }

      // Not in cache — try network, cache on success
      return fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => {
          // Network failed and nothing cached — for navigation requests
          // fall back to the cached shell so app still opens
          if (e.request.mode === 'navigate') {
            return caches.match(`${GHPATH}/`) || caches.match(`${GHPATH}/index.html`);
          }
        });
    })
  );
});
