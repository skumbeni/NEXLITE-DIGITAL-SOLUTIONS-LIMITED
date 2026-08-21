/* AgriBuy Connect — service worker
 * ---------------------------------------------------------------------
 * This app is a single HTML file, so the "app shell" to cache is just
 * that file plus the Google Fonts it loads. All actual data (companies,
 * purchases, farmers, messages...) goes through Firebase, which this
 * worker deliberately never touches — DB.js's own offline queue in
 * localStorage already owns that job. This worker's only job is making
 * sure the app itself opens with no network at all, not caching data.
 *
 * Bump CACHE_NAME on every deploy so returning users pick up the new
 * shell instead of a stale cached copy.
 */
const CACHE_NAME = 'agribuy-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Lets a page (e.g. an "Update available" banner) force this worker to
// activate immediately instead of waiting for every tab to close.
self.addEventListener('message', (event) => {
  if(event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isDataRequest(url){
  // Firebase (Realtime Database, Auth, Firestore) and any other live API
  // traffic — never cache, never intercept, always go straight to network.
  return /firebaseio\.com|firebaseapp\.com|googleapis\.com|identitytoolkit/.test(url.hostname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return; // never intercept writes
  const url = new URL(req.url);
  if(isDataRequest(url)) return; // let Firebase traffic pass straight through

  const isAppShellDoc = url.origin === self.location.origin &&
    (url.pathname === '/' || url.pathname.endsWith('/index.html'));

  if(isAppShellDoc){
    // Network-first for the app itself: always try to get the latest
    // version of the app when online, but fall back to the cached shell
    // the moment the network is unavailable or slow to respond.
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Everything else same-origin or from the known font CDNs (icons,
  // manifest, Google Fonts CSS/woff2): cache-first, since these rarely
  // change and don't need to be re-fetched every load.
  const isFontAsset = /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname);
  if(url.origin === self.location.origin || isFontAsset){
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
  }
});
