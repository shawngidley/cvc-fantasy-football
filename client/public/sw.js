const CACHE_NAME = "cvc-league-shell-v2";
const ASSETS = [
  "/",
  "/standings",
  "/manifest.webmanifest",
  "/manus-storage/cvc-pwa-192-clean_c8e39f50.png",
  "/manus-storage/cvc-pwa-512-clean_9ae190a5.png",
  "/manus-storage/cvc-pwa-maskable-512-clean_6056ae8c.png",
  "/manus-storage/cvc-apple-touch-icon-clean_8e601a69.png",
  "/manus-storage/cvc-favicon-64-clean_5da454a9.png"
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
