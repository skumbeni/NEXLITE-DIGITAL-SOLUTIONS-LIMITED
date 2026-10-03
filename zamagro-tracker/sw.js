// ZamAgro Track — service worker
// Purpose: let the app OPEN when there's zero connectivity (cold launch offline).
// It does NOT cache or intercept Firebase/API calls — the app's own localStorage
// + sync-queue logic already handles that layer of offline support.

// Bump this on every deploy so returning users pick up the new index.html
// instead of being stuck on a stale cached copy.
const CACHE_VERSION = 'zamagro-shell-v19';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-192x192.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png'
];

// A new version installs quietly and WAITS. index.html shows "A new version is ready"
// and, when the user taps "Update now", sends SKIP_WAITING — so an update never
// reloads the app in the middle of a sale. (A first-ever install has nothing to wait
// for and activates on its own.)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests for our own origin — let everything else
  // (Firebase REST calls, identitytoolkit, securetoken, etc.) go straight
  // to the network untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // Page navigations: try the network first so users always get the latest
  // build when they're online; fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only keep good responses, so a 404/500 can never replace the offline copy.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static shell assets (icons, manifest): cache first, network fallback.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
