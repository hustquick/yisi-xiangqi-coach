const CACHE_PREFIX = "yisi-xiangqi-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v7`;
const APP_SHELL = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/apple-touch-icon.png", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
      return response;
    }).catch(() => caches.match("/")));
    return;
  }
  const cacheable = url.pathname.startsWith("/_next/") || url.pathname.startsWith("/pikafish/") || /\.(?:css|js|wasm|png|svg|ico|webmanifest)$/.test(url.pathname);
  if (!cacheable) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) void caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
