const CACHE_NAME = 'ib-merch-v37';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './icon.png',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data && (e.data.type === 'SKIP_WAITING' || e.data.action === 'skipWaiting')) {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim().catch(err => {
      console.warn('[SW] clients.claim() failed (safe to ignore):', err);
    }))
  );
});

self.addEventListener('fetch', (e) => {
  // Pass API requests, maps, and CDNs directly through without local cache intercept
  if (e.request.url.includes('/api/') || e.request.url.includes('tile.openstreetmap') || e.request.url.includes('unpkg.com')) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache (stale-while-revalidate)
        fetch(e.request).then((networkResponse) => {
          if (networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
