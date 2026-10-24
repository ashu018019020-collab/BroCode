/* BroCode — offline service worker.
 * Strategy: precache nothing at install (content is static files under scope);
 * cache-first for immutable app assets, network-first for the JSON content packs
 * (curriculum / question banks / tracks) so a content update is never shadowed
 * by a stale cache. All app assets are local — nothing leaves the device. */
const CACHE = 'aiml-v6';

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

  // JSON content packs: network-first, cache fallback (offline). Bumping CACHE
  // above purges the older cache on activate, so a content fix always lands.
  const isContent = /\.json$/i.test(url.pathname)
    && (url.pathname.includes('/generated/') || url.pathname.includes('/notebooks'));
  if (isContent) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r ?? new Response('[]', { status: 504, headers: { 'content-type': 'application/json' } }))),
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
          // Images are the brand tile + install icons; nothing else in `public/` is a bitmap. Without
          // this, an offline load falls back to cached HTML but the sidebar logo stays broken.
          const cacheable = res.ok && !ct.includes('text/html') && (url.pathname.startsWith('/assets') || url.pathname.includes('/pyodide') || url.pathname.includes('/generated') || url.pathname.includes('/pdf') || url.pathname.includes('/sqljs') || /\.(png|svg|ico)$/i.test(url.pathname));
          if (cacheable) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
