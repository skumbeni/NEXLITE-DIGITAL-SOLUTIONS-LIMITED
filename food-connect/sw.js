/* Food Connect service worker
 *
 * What it does
 *  - Precaches the app shell (landing page, shop, offline page, manifest, icons).
 *  - Caches the three pinned Firebase SDK scripts. Without them, shop.html sees
 *    `typeof firebase === "undefined"` and falls back to its SAMPLE catalogue,
 *    i.e. fake restaurants. Serving the real SDK from cache avoids that.
 *  - Pages: network-first (so GitHub Pages deploys show up straight away), cached copy
 *    if the network is slow or down, offline.html as the last resort.
 *  - Never touches Firebase data/auth traffic (firebaseio.com, googleapis.com, etc.),
 *    so prices, towns, restaurants and orders always come live.
 *  - mfc-admin.html is never cached: always straight from the network.
 *
 * To ship an update to cached files, bump VERSION below.
 */
const VERSION = "v2";
const CACHE = "fc-" + VERSION;

const FIREBASE_SDK = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"
];

const CORE = [
  "./",
  "./index.html",
  "./shop.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico"
];

const NAV_TIMEOUT_MS = 5000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file should not block the whole install, so each add is tolerated.
    await Promise.all(CORE.map((u) =>
      cache.add(new Request(u, { cache: "reload" })).catch(() => {})
    ));
    await Promise.all(FIREBASE_SDK.map(async (u) => {
      try {
        const res = await fetch(u, { mode: "cors" });
        if (res.ok) await cache.put(u, res);
      } catch (_) { /* cached on first real use instead */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith("fc-") && n !== CACHE).map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Pinned Firebase SDK: the URL contains the version, so cache-first is safe.
  if (FIREBASE_SDK.includes(req.url)) {
    event.respondWith(sdkCacheFirst(req));
    return;
  }

  // Google Fonts (index.html): stale-while-revalidate.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(event, req));
    return;
  }

  // Everything else on another origin (Firebase RTDB/Auth, WhatsApp, ...): hands off.
  if (url.origin !== self.location.origin) return;

  // Admin console: always live, never cached.
  if (url.pathname.endsWith("/mfc-admin.html")) return;

  if (req.mode === "navigate") {
    event.respondWith(pageNetworkFirst(req, url));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, req));
});

/* ---------- strategies ---------- */

async function sdkCacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.status === 200 || res.type === "opaque")) {
    cache.put(req.url, res.clone());
  }
  return res;
}

async function pageNetworkFirst(req, url) {
  const cache = await caches.open(CACHE);
  // Same page with a different ?query (e.g. ?source=pwa) shares one cache entry.
  const key = url.origin + url.pathname;
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    if (res && res.status === 200 && !res.redirected) {
      cache.put(key, res.clone());
    }
    return res;
  } catch (_) {
    const cached = await cache.match(key);
    if (cached) return cached;
    const offline = await cache.match("./offline.html");
    return offline || new Response("You are offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && (res.status === 200 || res.type === "opaque")) {
        cache.put(req, res.clone());
      }
      return res;
    })
    .catch(() => null);
  event.waitUntil(refresh);
  return hit || (await refresh) || Response.error();
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}
