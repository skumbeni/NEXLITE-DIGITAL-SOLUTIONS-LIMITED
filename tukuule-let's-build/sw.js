/* Tukule — Let's Build: service worker
   -------------------------------------
   Goal: let the app open (installed or in-browser) even with no signal —
   the shell (this HTML file, its icons, and the CDN libraries it depends
   on) loads from cache instantly, while Firebase's own live-data traffic
   is left completely alone so buyers/owners always see real, current
   data whenever they do have a connection.

   Bump CACHE_VERSION whenever the shell's own files change so old caches
   get cleared out on the next visit. */
const CACHE_VERSION = 'tukule-shell-v1';

const SHELL_URLS = [
  './tukule-lets-build-with-map-drawing.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Third-party libraries the app can't function without — worth precaching
// so the very first offline load already has them, rather than waiting
// for a first successful online visit to populate the cache.
const LIBRARY_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
  'https://unpkg.com/@turf/turf@6.5.0/turf.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Precache the shell strictly; precache libraries best-effort (a
      // flaky CDN fetch shouldn't block install — they'll get cached on
      // first successful runtime fetch instead, via the fetch handler below).
      return Promise.all([
        cache.addAll(SHELL_URLS),
        Promise.all(LIBRARY_URLS.map((url) =>
          cache.add(url).catch(() => {})
        )),
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Requests that must always go straight to the network — Firebase's
// realtime traffic (data + auth) should never be served from cache or
// even cached, or buyers/owners could act on stale balances/status.
function isLiveDataRequest(url) {
  return /firebaseio\.com|firebaseinstallations\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/.test(url);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch writes
  const url = req.url;

  if (isLiveDataRequest(url)) {
    return; // let it hit the network untouched
  }

  // Stale-while-revalidate for everything else (the shell, icons, fonts,
  // and the CDN libraries): answer instantly from cache if we have it,
  // and refresh the cache in the background for next time. If there's no
  // cached copy yet, fall back to the network.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        networkFetch; // refresh cache in the background, don't wait on it
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;

      // Total offline miss on a navigation request — hand back the app
      // shell itself rather than a browser error page, so the user still
      // lands somewhere usable.
      if (req.mode === 'navigate') {
        const shell = await cache.match('./tukule-lets-build-with-map-drawing.html');
        if (shell) return shell;
      }
      return Response.error();
    })
  );
});
