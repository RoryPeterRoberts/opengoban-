/**
 * OpenGoban Service Worker
 *
 * Provides offline capability and caching.
 */

const CACHE_NAME = 'opengoban-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/cell-protocol.js',
  '/lib/pouchdb.min.js',
  '/lib/tweetnacl.min.js',
  '/lib/tweetnacl-util.min.js',
  '/lib/qrcode.min.js',
  '/lib/jsqr.min.js',
  '/lib/peerjs.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
];

// Install - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching assets...');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip external requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached version or fetch from network
      return cached || fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback for navigation
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
