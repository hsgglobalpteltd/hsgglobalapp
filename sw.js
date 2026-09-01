const CACHE_NAME = 'ib-apps-v10';
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './icon.png',
  './logo.png',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(err => console.warn('[SW] Cache init item error:', err));
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
  // Always bypass worker API data queries and live endpoints
  if (e.request.url.includes('/api/') || e.request.url.includes('workers.dev')) {
    return;
  }

  // Cache-First strategy for static CDN libraries and fonts
  if (
    e.request.url.includes('fonts.googleapis.com') ||
    e.request.url.includes('fonts.gstatic.com') ||
    e.request.url.includes('cdnjs.cloudflare.com') ||
    e.request.url.includes('cdn.jsdelivr.net')
  ) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
          }
          return networkResponse;
        }).catch(() => cachedResponse);
      })
    );
    return;
  }
  
  // Stale-While-Revalidate for app assets
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
