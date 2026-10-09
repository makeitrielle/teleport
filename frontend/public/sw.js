const CACHE_NAME = "tele-port-shell-v4";
const APP_ROOT = "/";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch(APP_ROOT, { cache: "reload" });
    if (!response.ok) throw new Error("Could not cache the app shell");
    const html = await response.clone().text();
    await cache.put(APP_ROOT, response);
    const assetPaths = [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)]
      .map((match) => match[1])
      .filter((path) => path.startsWith("/"));
    await Promise.all(assetPaths.map(async (path) => {
      try {
        const asset = await fetch(path, { cache: "reload" });
        if (asset.ok) await cache.put(path, asset);
      } catch { /* a failed optional asset should not prevent app installation */ }
    }));
    await cache.addAll([
      "/manifest.webmanifest",
      "/jasper-jean-bus.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-180.png",
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("tele-port-shell-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT, response.clone()));
      return response;
    }).catch(async () => (await caches.match(APP_ROOT)) || Response.error()));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow(event.notification.data?.url || "/");
  })());
});
