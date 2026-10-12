// MotoConnect Zambia — Service Worker
// Works from any folder it is served from (e.g. /motoconnect/ on the custom domain, /Motoconnect/ on GitHub Pages):
// the folder is read from the scope the page registered it with, never hard-coded.
const SCOPE = new URL(self.registration.scope).pathname;   // always ends with "/"
const CACHE = 'mc-v20';

// Every URL the app needs to open offline — both slash forms required
const URLS = [
  SCOPE,
  `${SCOPE}index.html`,
  `${SCOPE}sw.js`,
  `${SCOPE}manifest.json`,
  `${SCOPE}privacy.html`,
  `${SCOPE}tos.html`,
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
    url.includes('google.com/recaptcha') ||   // App Check's reCAPTCHA script: always live, never cached
    url.includes('gstatic.com/recaptcha') ||
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
            // caches.match() returns a Promise (always truthy), so `a || b` never reached b.
            // Wait for the first lookup and only then fall back to the second.
            return caches.match(SCOPE).then(r => r || caches.match(`${SCOPE}index.html`));
          }
        });
    })
  );
});
