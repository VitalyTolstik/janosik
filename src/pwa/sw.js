/* Janosik service worker.
 *
 * Not part of the app bundle: this file is never imported. The build reads
 * it from here, stamps `CACHE_VERSION` with a hash of the emitted assets and
 * `PRECACHE_ASSETS` with the hashed entry assets, then writes it to
 * `dist/sw.js` (vite/sw-plugin.ts) — so every deploy gets a fresh cache name
 * and `activate` drops the previous deploy's caches.
 *
 * Strategy:
 *  - app shell ("/", the SPA entry): network-first, cache fallback — a
 *    fresh index.html points at the current hashed assets, a cached one
 *    keeps the app bootable offline;
 *  - entry assets (/assets/index-*.js, react-*.js, the entry CSS, …):
 *    precached during `install`, so the very first visit is enough to boot
 *    the app offline (the worker does not control that first page load, so
 *    runtime caching alone would miss them);
 *  - other hashed build output (/assets/*): cache-first — filenames are
 *    content-hashed, so a cached response is immutable and lazy chunks
 *    (editor, calendar) land in the cache the first time they load;
 *  - everything else same-origin (manifest, icons): cache-first.
 *
 * Only successful responses are cached: a 500 from a half-deployed server
 * or a 404 behind a captive portal would otherwise be pinned as the app
 * shell forever, and the "offline" fallback would replay the error page.
 */
const CACHE_VERSION = "__CACHE_VERSION__";
const CACHE_PREFIX = "janosik-";
const APP_SHELL_URL = "/";

/*
 * The build stamps the hashed entry assets here (vite/sw-plugin.ts); it stays
 * empty when the source is read directly, e.g. by the unit tests.
 */
const PRECACHE_ASSETS = [];

/** Fallback for requests the cache cannot satisfy while offline. */
function offlineResponse() {
  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([APP_SHELL_URL, ...PRECACHE_ASSETS]))
      .catch(() => {
        /* first run offline — runtime caching still applies */
      })
      /*
       * Unconditional on purpose: an update applies as soon as the new
       * worker installs, without an "update available" prompt (out of
       * scope). Tradeoff: a tab left open across a deploy may briefly mix
       * the old shell with new assets.
       */
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
            .filter(
              (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION,
            )
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
          // An error page must not become the cached app shell.
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE_VERSION)
                .then((cache) => cache.put(APP_SHELL_URL, copy)),
            );
          }
          return response;
        })
        .catch(() =>
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.match(APP_SHELL_URL))
            .then((cached) => cached || offlineResponse()),
        ),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response.ok) {
              event.waitUntil(cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => offlineResponse());
      }),
    ),
  );
});
