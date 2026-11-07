/* BusFleet service worker: offline-first. Keep this file in the same folder as index.html.
   Paths are relative so the app works from any sub-folder (for example a GitHub Pages monorepo).
   Bump VERSION when you add or rename files in PRECACHE; changes to index.html alone are picked up automatically. */
const VERSION = 'busfleet-v2', STATIC = VERSION + '-static', RUNTIME = VERSION + '-runtime', PREFIX = 'busfleet-';
const PRECACHE = ['./index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
const CDN = 'https://cdnjs.cloudflare.com/';
const FB = 'https://www.gstatic.com/firebasejs/'; // cloud sync library, fetched only when someone signs in
const CDN_PRECACHE = [CDN + 'ajax/libs/font-awesome/6.4.0/css/all.min.css', CDN + 'ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2', CDN + 'ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2', CDN + 'ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2'];

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const c = await caches.open(STATIC);
        await c.addAll(PRECACHE);
        // icons and fonts come from the CDN: a failure here must not stop the app installing
        await Promise.allSettled(CDN_PRECACHE.map(u => fetch(u).then(r => { if (r.ok) return c.put(u, r); })));
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        // only touch this app's caches: other apps on the same origin keep theirs
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== STATIC && k !== RUNTIME).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

const tellPages = async msg => { for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(msg); };

// pages: serve the saved copy at once, refresh it in the background, and tell the page if it changed
async function page(e) {
    const cache = await caches.open(STATIC), cached = await cache.match('./index.html');
    const net = fetch(e.request).then(async res => {
        if (res.ok && res.type !== 'opaqueredirect') {
            const old = cached ? await cached.clone().text() : null;
            await cache.put('./index.html', res.clone());
            if (old !== null && old !== await res.clone().text()) tellPages({ type: 'update-ready' });
        }
        return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(net); return cached; }
    return (await net) || new Response('You are offline and the app has not been saved on this device yet. Open it once with internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// same-origin files (icons, manifest): saved copy first, refreshed in the background
async function asset(req) {
    const cache = await caches.open(STATIC), hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || Response.error();
}

// Font Awesome from the CDN: saved copy first, then the network (and save it)
async function cdn(req) {
    const hit = await caches.match(req);
    if (hit) return hit;
    try { const r = await fetch(req); if (r.ok) (await caches.open(RUNTIME)).put(req, r.clone()); return r; } catch (err) { return Response.error(); }
}

// Firebase sync library: saved copy first; saved after the first online load so a signed-in phone can start offline.
// The page loads it as a plain <script>, so the response can be opaque; opaque copies are fine to keep.
async function fb(req) {
    const hit = await caches.match(req);
    if (hit) return hit;
    try { const r = await fetch(req); if (r.ok || r.type === 'opaque') (await caches.open(RUNTIME)).put(req, r.clone()); return r; } catch (err) { return Response.error(); }
}

self.addEventListener('fetch', e => {
    const req = e.request; if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (req.mode === 'navigate' && url.origin === location.origin) e.respondWith(page(e));
    else if (url.origin === location.origin && !url.pathname.endsWith('/sw.js')) e.respondWith(asset(req));
    else if (req.url.startsWith(CDN)) e.respondWith(cdn(req));
    else if (req.url.startsWith(FB)) e.respondWith(fb(req));
});
