// ============= SME Accounting Pro — Service Worker (v2) =============
// Purpose: cache the app shell (this app's own HTML pages + the fonts,
// chart.js and Firebase SDK modules it loads from CDNs) so the app opens
// instantly and keeps working with no network — on top of, not instead of,
// the existing Firebase/localStorage offline-first sync already in the app.
//
// Bump CACHE_VERSION any time index.html / sme-admin.html / icons change,
// so returning users get the new shell instead of a stale cached one.
//
// v3: app.apk downloads bypass the worker (see shouldBypass).
//
// Changes from v1:
//  - Precache no longer fails as a whole if one optional file is missing
//    (v1 used cache.addAll on everything, so a single 404 — e.g. a
//    sme-admin.html that isn't deployed — made the install fail and the
//    service worker never activated).
//  - Navigations are network-first with a timeout, so slow/flaky mobile
//    data falls back to the cached shell instead of hanging.
//  - Only successful responses are cached (v1 could cache a 404 page).
//  - Fixed the cache-first fallback returning `undefined` on a miss while
//    offline (that throws inside respondWith).
//  - Firebase SDK modules precached; analytics/auth/RTDB traffic and
//    /.well-known/ (Play's Digital Asset Links check) bypass the worker.
const CACHE_VERSION = 'v3';
const CACHE_NAME = `smeap-shell-${CACHE_VERSION}`;

// How long a page navigation waits for the network before we serve the
// cached shell instead (it still refreshes the cache in the background).
const NAV_TIMEOUT_MS = 4000;

// Must exist, or install fails and the worker retries on the next visit.
const REQUIRED = [
  './',
  './index.html',
  './manifest.json'
];

// Nice to have. Each is fetched individually; a failure here is ignored
// (it will simply be cached at runtime the first time it's used).
const OPTIONAL = [
  './sme-admin.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/favicon-32.png',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  // Firebase SDK modules imported by index.html. Keep the version in step
  // with the import URLs in index.html (currently 12.18.0).
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js'
];

// ---- Install: pre-cache the app shell ----
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(REQUIRED);                       // all-or-nothing, but only 3 same-origin files
    await Promise.allSettled(OPTIONAL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
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

// ---- Requests this worker must never touch ----
// Firebase Auth / Realtime Database / Installations have their own
// pending-write queue and sync logic in the app; caching them would only
// serve stale reads. Analytics scripts are left fresh. /.well-known/ is
// where Google verifies the Android app's Digital Asset Links.
const BYPASS_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'firebaseapp.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com'
];
function shouldBypass(url) {
  if (!url.protocol.startsWith('http')) return true;
  if (url.pathname.startsWith('/.well-known/')) return true;
  // The downloadable Android app (app.apk) must always come straight from the
  // network. Otherwise a slow connection could make the worker answer the
  // download with the cached index.html, saving a broken .apk file.
  if (url.pathname.toLowerCase().endsWith('.apk')) return true;
  return BYPASS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
}

// Only keep responses worth serving again: successful ones (opaque
// responses from no-cors CDN <script>/<link> tags have status 0 and are
// allowed so those assets still work offline).
function cacheable(response) {
  return response && (response.ok || response.type === 'opaque');
}
function putInCache(request, response) {
  if (!cacheable(response)) return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
}

async function cachedShell(request) {
  return (await caches.match(request, { ignoreSearch: true })) ||
         (await caches.match('./index.html'));
}

function offlineResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline</title><body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">' +
    '<h2>You\'re offline</h2><p>Connect to the internet once to finish setting up, then the app will work offline.</p></body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// Navigation: network first; if the network is slow (> NAV_TIMEOUT_MS) or
// fails, serve the cached shell. A late network response still refreshes
// the cache for next time.
function navigationResponse(request) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (response) => { if (!settled) { settled = true; resolve(response); } };

    const timer = setTimeout(async () => {
      const cached = await cachedShell(request);
      if (cached) settle(cached);            // otherwise keep waiting for the network
    }, NAV_TIMEOUT_MS);

    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        putInCache(request, response);
        settle(response);
      })
      .catch(async () => {
        clearTimeout(timer);
        settle((await cachedShell(request)) || offlineResponse());
      });
  });
}

// Everything else (fonts, chart.js, Firebase modules, icons): cache first —
// these are versioned/immutable, so no network round trip when we have them.
async function assetResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    putInCache(request, response);
    return response;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (shouldBypass(url)) return;

  event.respondWith(request.mode === 'navigate' ? navigationResponse(request) : assetResponse(request));
});
