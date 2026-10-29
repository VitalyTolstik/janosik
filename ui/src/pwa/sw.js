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
 *  - the shell's other static files (manifest, icons): cache-first.
 *
 * The API shares the origin, so it is never intercepted: caching it
 * cache-first would freeze boards on stale data, replay one account's
 * responses into another session in the same profile and buffer the
 * infinite SSE stream. Requests under `/api/`, carrying `Authorization` or
 * asking for `text/event-stream` go straight to the network, uncached.
 *
 * Only successful responses are cached: a 500 from a half-deployed server
 * or a 404 behind a captive portal would otherwise be pinned as the app
 * shell forever, and the "offline" fallback would replay the error page.
 */
const CACHE_VERSION = "__CACHE_VERSION__";
const CACHE_PREFIX = "janosik-";
/*
 * The app's deploy base (`/app/` in the self-host image, `/` standalone),
 * stamped by the build (vite/sw-plugin.ts). The worker is registered under
 * this base, so its scope is exactly the app — never the marketing site.
 */
const BASE = "__BASE__";
const APP_SHELL_URL = BASE;

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

/** Shell files (beyond the entry) that are safe to cache at runtime. */
const STATIC_SHELL_PATHS = new Set([
  BASE + "manifest.webmanifest",
  BASE + "icon.svg",
  BASE + "favicon.ico",
]);
const STATIC_SHELL_PREFIXES = [BASE + "assets/", BASE + "icons/"];

/*
 * The API is same-origin, so it must never be intercepted: cache-first would
 * pin stale board data, replay one session's responses into another and
 * buffer the SSE stream. Authenticated and streaming requests are equally
 * off-limits.
 */
function isApiOrStream(request, url) {
  if (url.pathname.startsWith("/api/")) return true;
  const headers = request.headers;
  if (headers && headers.get("Authorization")) return true;
  if (headers && (headers.get("Accept") || "").includes("text/event-stream")) {
    return true;
  }
  return false;
}

/** True for the shell's static files: hashed build output, manifest, icons. */
function isStaticShellAsset(url) {
  return (
    STATIC_SHELL_PATHS.has(url.pathname) ||
    STATIC_SHELL_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll([APP_SHELL_URL, ...PRECACHE_ASSETS]))
      .catch(() => {
        /* first run offline — runtime caching still applies */
      }),
    // No unconditional `skipWaiting` (TASK-151, C5): a deploy used to take
    // over open tabs at once, and an old tab asking for its lazy chunk got
    // the new deploy's `index.html` (200) instead of the chunk → SyntaxError
    // → the whole app crashed. The page decides when to apply the update
    // (`{ type: "SKIP_WAITING" }`); the previous cache stays readable below,
    // so even an old tab that was claimed keeps its chunks.
  );
});

/** Apply a waiting update on the page's request. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

const META_CACHE = "janosik-meta";
const ACTIVE_KEY = self.location.origin + BASE + "__active__";

/** The cache name the currently active deploy recorded (TASK-156). */
function readActiveVersion() {
  return caches
    .open(META_CACHE)
    .then((cache) => cache.match(ACTIVE_KEY))
    .then((response) => (response ? response.text() : null))
    .catch(() => null);
}

function markActiveVersion() {
  return caches
    .open(META_CACHE)
    .then((cache) => cache.put(ACTIVE_KEY, new Response(CACHE_VERSION)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([readActiveVersion(), caches.keys()])
      .then(([active, keys]) => {
        const stale = keys.filter(
          (key) =>
            key !== META_CACHE &&
            key.startsWith(CACHE_PREFIX) &&
            key !== CACHE_VERSION,
        );
        // Keep the cache that belonged to the previously *active* deploy
        // (TASK-156): the alphabetical/cache-key order used to let an
        // unactivated worker's cache evict the chunks an open old tab needs.
        const keep = new Set(
          active !== null && stale.includes(active)
            ? [active]
            : stale.slice(-1),
        );
        return Promise.all(
          stale
            .filter((key) => !keep.has(key))
            .map((key) => caches.delete(key)),
        );
      })
      .then(() => markActiveVersion())
      .then(() => self.clients.claim()),
  );
});

/**
 * May this response be served (and cached) for the request? For
 * `/assets/*` the answer must be a real build artifact: a half-deployed
 * server (or a proxy) answers a missing lazy chunk with the SPA's
 * `index.html` and status 200, and a worker from before TASK-156 may
 * already have pinned such an answer in a kept cache. Serving — or
 * caching — HTML as JavaScript crashes the tab with a SyntaxError, so
 * both the fresh answer and every cached hit must carry a plausible,
 * non-HTML Content-Type (a missing header is refused too, TASK-156
 * review). Manifest/icons keep the plain cache-first behaviour.
 */
function isUsableAsset(request, response) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE + "assets/")) return true;
  const type = (response.headers?.get?.("Content-Type") ?? "").toLowerCase();
  return type !== "" && !type.includes("text/html");
}

/** Static shell asset from this deploy or the kept previous one. */
function matchShellAsset(request) {
  return caches.open(CACHE_VERSION).then((cache) =>
    cache.match(request).then((cached) => {
      // A poisoned entry (HTML cached as an asset by a pre-TASK-156
      // worker) is not a hit: fall through instead of serving it.
      if (cached && isUsableAsset(request, cached)) return cached;
      // Previous deploy's cache is only a fallback for content-hashed build
      // output (TASK-156): serving an old manifest/icons while online would
      // pin the old icon set forever.
      const url = new URL(request.url);
      if (!url.pathname.startsWith(BASE + "assets/")) return null;
      return caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key !== META_CACHE &&
                  key.startsWith(CACHE_PREFIX) &&
                  key !== CACHE_VERSION,
              )
              .map((key) =>
                caches.open(key).then((older) => older.match(request)),
              ),
          ),
        )
        .then(
          (hits) =>
            hits.find(
              (hit) => hit !== undefined && isUsableAsset(request, hit),
            ) ?? null,
        );
    }),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiOrStream(request, url)) return;

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

  if (!isStaticShellAsset(url)) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      matchShellAsset(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (!response.ok) return response;
            // A 200 answer that is (or may be) the SPA's HTML must not be
            // served or cached as JavaScript — refuse it instead of
            // pinning it (TASK-156): a missing Content-Type is just as
            // untrustworthy as an explicit text/html one.
            if (!isUsableAsset(request, response)) {
              return offlineResponse();
            }
            event.waitUntil(cache.put(request, response.clone()));
            return response;
          })
          .catch(() => offlineResponse());
      }),
    ),
  );
});
