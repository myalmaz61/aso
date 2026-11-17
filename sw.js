/* Aroma v1.12.0: offline cache matches the exact versioned asset URLs in index.html.
   Financial records and saved price offers are NEVER in the Service Worker cache. */
const CACHE = 'aroma-weekly-v1.12.0';
const ASSETS = [
  './', './index.html',
  './styles.css?v=1.12.0', './logic.js?v=1.12.0', './app.js?v=1.12.0',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'
];
const CACHEABLE = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  // Installation is only successful if *all* the app files are cached.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('aroma-weekly-') && k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const isPage = event.request.mode === 'navigate';
  const shouldCache = isPage || CACHEABLE.has(url.href);
  if (!shouldCache) return; // Never cache arbitrary URLs or private data.
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (isPage) return (await caches.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
