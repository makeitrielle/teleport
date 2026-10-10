const CACHE_NAME = "tele-port-shell-v18";
const APP_ROOT = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const entry of [APP_ROOT, "/kiosk/"]) {
        const response = await fetch(entry, { cache: "reload" });
        if (!response.ok) throw new Error("Could not cache the app shell");
        const html = await response.clone().text();
        await cache.put(entry, response);
        const assetPaths = [
          ...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g),
        ]
          .map((match) => match[1])
          .filter((path) => path.startsWith("/"));
        await Promise.all(
          assetPaths.map(async (path) => {
            try {
              const asset = await fetch(path, { cache: "reload" });
              if (asset.ok) await cache.put(path, asset);
            } catch {
              /* retry optional assets when requested */
            }
          }),
        );
      }
      await cache.addAll([
        "/manifest.webmanifest",
        "/kiosk.webmanifest",
        "/jasper-jean-bus.png",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/icon-180.png",
      ]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith("tele-port-shell-") && key !== CACHE_NAME,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const cacheCopy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(url.pathname, cacheCopy))
                .catch(() => { /* A cache failure must not interrupt navigation. */ }),
            );
          }
          return response;
        })
        .catch(async () => {
          const entry = /^\/kiosk(?:\/|$)/.test(url.pathname)
            ? "/kiosk/"
            : APP_ROOT;
          return (
            (await caches.match(url.pathname)) ||
            (await caches.match(entry)) ||
            Response.error()
          );
        }),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const cacheCopy = response.clone();
              event.waitUntil(
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, cacheCopy))
                  .catch(() => { /* The network response remains usable without caching. */ }),
              );
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(event.notification.data?.url || "/");
    })(),
  );
});
