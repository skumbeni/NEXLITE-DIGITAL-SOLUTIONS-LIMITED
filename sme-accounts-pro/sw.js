// ============= SME Accounting Pro — Service Worker =============
// Purpose: cache the app shell (this app's own HTML pages + the fonts/
// chart.js it loads from CDNs) so the app opens instantly and keeps
// working with no network at all — on top of, not instead of, the
// existing Firebase/localStorage offline-first sync already in the app.
//
// Bump CACHE_VERSION any time index.html / sme-admin.html change, so
// returning users get the new shell instead of a stale cached one.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `smeap-shell-${CACHE_VERSION}`;

// Core files this service worker controls. Paths are relative to
// wherever sw.js is deployed (its scope) — adjust if you host these
// pages somewhere other than the site root.
const APP_SHELL = [
  './',
  './index.html',
  './sme-admin.html',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// ---- Install: pre-cache the app shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ---- Activate: drop any old-version caches, take control immediately ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('smeap-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ---- Fetch strategy ----
// Firebase (Realtime Database / Auth) requests are left completely alone:
// the app already has its own pending-write queue and sync logic for
// those, and a service worker cache would only get in the way of that
// (e.g. serving a stale read). Everything else — this app's own pages
// and the CDN assets above — gets cached.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isFirebase = /firebaseio\.com|googleapis\.com\/.*identitytoolkit|firebaseapp\.com/.test(url.hostname + url.pathname);
  if (isFirebase) return;

  // Navigations (opening/reloading a page): try the network first so
  // online users always get the latest shell; fall back to cache when
  // offline. Everything else (fonts, chart.js, etc.): cache-first, since
  // those files are versioned/immutable and shouldn't need a network
  // round trip every time.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => cached);
    })
  );
});
