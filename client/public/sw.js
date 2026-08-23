const CACHE_NAME = "cvc-league-shell-v2";
const ASSETS = [
  "/",
  "/standings",
  "/manifest.webmanifest",
  "/brand/pwa-192.png",
  "/brand/pwa-512.png",
  "/brand/pwa-maskable-512.png",
  "/brand/apple-touch-icon.png",
  "/brand/favicon-64.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(cached => cached ?? caches.match("/"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached ?? fetch(event.request)));
});
