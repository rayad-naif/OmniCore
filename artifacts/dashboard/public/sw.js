// Minimal service worker — enables "Add to Home Screen" / installability.
// Network pass-through (no offline caching) to avoid serving stale app shells.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
