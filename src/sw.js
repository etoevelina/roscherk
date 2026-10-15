// Service Worker (§4.6): прекэш оболочки, cache-first, имя кэша 'roscherk-' + contentHash
// (подставляет tools/build.mjs), старые кэши удаляются на activate, skipWaiting + clients.claim.
const CONTENT_HASH = '__CONTENT_HASH__';
const CACHE = 'roscherk-' + CONTENT_HASH;
// В конец списка tools/build.mjs подставляет ./art/*.webp (3D-графика дизайн-системы).
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-512.png', /*__ART_FILES__*/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('roscherk-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
