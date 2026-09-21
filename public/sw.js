/* AI Engineer Master Lab — offline service worker.
 * Strategy: precache nothing at install (content is static files under scope);
 * cache-first for same-origin GETs with runtime caching. All app assets are local. */
const CACHE = 'aiml-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never handle cross-origin

  // Navigation requests: network-first with cache fallback (SPA)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r ?? caches.match(new Request('./index.html')))),
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // Never cache HTML under asset paths — a dev-server fallback would poison the cache
          const ct = res.headers.get('content-type') ?? '';
          const cacheable = res.ok && !ct.includes('text/html') && (url.pathname.startsWith('/assets') || url.pathname.includes('/pyodide') || url.pathname.includes('/curriculum') || url.pathname.includes('/pdf') || url.pathname.includes('/sqljs'));
          if (cacheable) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
