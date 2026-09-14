/* Janosik service worker.
 *
 * Strategy:
 *  - app shell ("/", the SPA entry): network-first, cache fallback — a
 *    fresh index.html points at the current hashed assets, a cached one
 *    keeps the app bootable offline;
 *  - hashed build output (/assets/*): cache-first — filenames are
 *    content-hashed, so a cached response is immutable and lazy chunks
 *    (editor, calendar) land in the cache the first time they load;
 *  - everything else same-origin (manifest, icons): cache-first.
 *
 * Bump CACHE_VERSION to invalidate everything on the next deploy.
 */
const CACHE_VERSION = "janosik-v1";
const APP_SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.add(APP_SHELL_URL))
      .catch(() => {
        /* first run offline — runtime caching still applies */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(APP_SHELL_URL, copy));
          return response;
        })
        .catch(() =>
          caches.match(APP_SHELL_URL).then(
            (cached) =>
              cached ||
              new Response("Offline", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              }),
          ),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
