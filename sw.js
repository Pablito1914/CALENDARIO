const CACHE_NAME = 'calendario-cache-v1793900700000';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // If request is to the API, network only (since app.js handles offline queueing)
  if (event.request.url.includes('/api/') || event.request.url.includes('script.google.com') || event.request.url.includes('script.googleusercontent.com')) {
    return; // Don't intercept API calls
  }

  // Network first, falling back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('activate', event => {
  self.clients.claim();
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
