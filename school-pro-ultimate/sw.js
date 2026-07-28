// ─────────────────────────────────────────────────────────────────────────
// School Pro Ultimate — Service Worker
// Bump CACHE_VERSION on every deploy so users get the new app shell instead
// of a stale cached copy forever.
// ─────────────────────────────────────────────────────────────────────────
const CACHE_VERSION   = 'v1';
const APP_SHELL_CACHE = `school-pro-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE   = `school-pro-runtime-${CACHE_VERSION}`;

// Same-origin files needed to boot the app with zero network.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-48.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-adaptive-1024.png'
];

// Cross-origin hosts we're allowed to cache a runtime copy of (fonts, jsPDF,
// Firebase SDK modules). We do NOT cache Firebase *data/auth* endpoints —
// those must always hit the network so the app's own offline-write-queue
// logic (see _fbSyncPending in index.html) stays authoritative.
const RUNTIME_CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'www.gstatic.com' // firebase-app.js / firebase-auth.js / firebase-database.js modules
];

const NEVER_CACHE_HOSTS = [
  'googleapis.com',          // covers *.googleapis.com incl. identitytoolkit/securetoken
  'firebaseio.com',
  'firebaseapp.com',
  'firebase.google.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) =>
        // cache.addAll() is all-or-nothing: a single 404 (e.g. an icon size
        // that doesn't actually exist in the repo) would silently fail the
        // ENTIRE install, meaning even index.html never gets cached and the
        // app can't open offline at all. Caching each file individually
        // means one missing/broken asset can't take down the whole shell —
        // it's just logged and skipped.
        Promise.all(
          APP_SHELL.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[sw] Failed to cache app-shell file, skipping:', url, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function hostMatches(url, list) {
  return list.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept writes

  const url = new URL(request.url);

  // 1) Never touch Firebase data/auth traffic — always network, always live.
  if (hostMatches(url, NEVER_CACHE_HOSTS)) {
    return; // let the browser handle it untouched
  }

  // 1b) Never cache large downloadable binaries (e.g. the Android APK) —
  //     no offline benefit, and it would bloat the cache for no reason.
  if (url.pathname.endsWith('.apk')) {
    return; // let the browser handle the download untouched
  }

  // 2) Navigations (loading/refreshing the app itself): network-first,
  //    falling back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 3) Same-origin static assets (icons, manifest, index.html direct hit):
  //    cache-first, refresh in background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 4) Allowed cross-origin static resources (fonts, jsPDF, Firebase SDK
  //    module files): stale-while-revalidate.
  if (hostMatches(url, RUNTIME_CACHEABLE_HOSTS)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 5) Anything else: just let it go to the network as normal.
});

// Allows the page to force-activate a waiting SW right after a fresh deploy
// (call navigator.serviceWorker.controller.postMessage({type:'SKIP_WAITING'}))
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
