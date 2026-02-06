// No-op service worker — unregisters itself to clear old cached app
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister();
  caches.keys().then(names => names.forEach(n => caches.delete(n)));
});
