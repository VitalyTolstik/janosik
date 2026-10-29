import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheVersionFrom,
  entryAssetNames,
  stampServiceWorkerSource,
} from "../../vite/sw-plugin";

/**
 * The service worker is plain script-scope JS, so it is loaded here the way
 * the browser would: the source is evaluated against a fake worker global
 * (`self`, `caches`, `fetch`), and the registered listeners are driven with
 * fake events. That covers exactly what TASK-21.3 fixed — an error response
 * must never be cached as the app shell, and `activate` must not accumulate
 * caches — plus TASK-151: updates wait for the page and an open old tab can
 * still fetch its lazy chunks from the kept previous cache. Also the
 * off-nominal branches of K-4/K-5/T-7, and TASK-75: the API, authenticated
 * and streaming requests stay out of the cache while the shell's static files
 * keep their cache-first behaviour.
 */

const SW_SOURCE = path.resolve(import.meta.dirname, "./sw.js");
const ORIGIN = "https://boards.test";
const VERSION = "janosik-test";
const ENTRY_ASSET = "/assets/index-abc123.js";

interface FakeResponse {
  ok: boolean;
  status: number;
  body: string;
  headers?: FakeHeaders;
  clone: () => FakeResponse;
}

function response(
  body: string,
  status = 200,
  responseHeaders?: FakeHeaders,
): FakeResponse {
  const res: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    body,
    headers: responseHeaders,
    clone: () => res,
  };
  return res;
}

/** Minimal CacheStorage: a map of cache name → (url → response). */
function createCaches(seed: Record<string, Record<string, FakeResponse>> = {}) {
  const store = new Map<string, Map<string, FakeResponse>>(
    Object.entries(seed).map(([name, entries]) => [
      name,
      new Map(Object.entries(entries)),
    ]),
  );
  const cacheFor = (name: string) => {
    let cache = store.get(name);
    if (!cache) {
      cache = new Map();
      store.set(name, cache);
    }
    return {
      put: (request: string | { url: string }, value: FakeResponse) => {
        cache.set(typeof request === "string" ? request : request.url, value);
        return Promise.resolve();
      },
      add: (url: string) => {
        cache.set(url, response("shell"));
        return Promise.resolve();
      },
      addAll: (urls: string[]) => {
        for (const url of urls) cache.set(url, response("shell"));
        return Promise.resolve();
      },
      match: (request: string | { url: string }) =>
        Promise.resolve(
          cache.get(typeof request === "string" ? request : request.url),
        ),
    };
  };
  return {
    store,
    api: {
      open: (name: string) => Promise.resolve(cacheFor(name)),
      keys: () => Promise.resolve([...store.keys()]),
      delete: (name: string) => Promise.resolve(store.delete(name)),
      match: (request: string | { url: string }) => {
        const url = typeof request === "string" ? request : request.url;
        for (const cache of store.values()) {
          const hit = cache.get(url);
          if (hit) return Promise.resolve(hit);
        }
        return Promise.resolve(undefined);
      },
    },
  };
}

type Listener = (event: FakeEvent) => void;

interface FakeHeaders {
  get: (name: string) => string | null;
}

interface FakeEvent {
  request?: {
    url: string;
    method: string;
    mode?: string;
    headers?: FakeHeaders;
  };
  data?: unknown;
  respondWith: (value: Promise<FakeResponse>) => void;
  waitUntil: (value: Promise<unknown>) => void;
}

/** Case-insensitive stand-in for a `Headers` instance. */
function headers(entries: Record<string, string>): FakeHeaders {
  const lower = new Map(
    Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function loadWorker(
  cachesApi: unknown,
  fetchImpl: (request: unknown) => Promise<FakeResponse>,
  precacheAssets: string[] = [],
) {
  const listeners = new Map<string, Listener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  // The worker reads `caches`/`fetch` off the global scope; parameters of
  // the wrapper shadow them, which keeps the test free of global patching.
  const source = stampServiceWorkerSource(
    readFileSync(SW_SOURCE, "utf8"),
    VERSION,
    precacheAssets,
  );
  const evaluate = new Function("self", "caches", "fetch", "Response", source);
  evaluate(self, cachesApi, fetchImpl, FakeResponseCtor);

  const dispatch = async (
    type: string,
    request?: FakeEvent["request"],
    data?: unknown,
  ) => {
    const listener = listeners.get(type);
    if (!listener) throw new Error(`no ${type} listener registered`);
    const pending: Promise<unknown>[] = [];
    let responded: Promise<FakeResponse> | undefined;
    listener({
      request,
      data,
      respondWith: (value) => {
        responded = value;
        pending.push(value);
      },
      waitUntil: (value) => pending.push(value),
    });
    await Promise.all(pending);
    return responded ? await responded : undefined;
  };

  return { self, dispatch };
}

/** Stands in for the worker's `new Response(...)` offline fallback. */
function FakeResponseCtor(
  this: Record<string, unknown>,
  body: string,
  init?: { status?: number },
) {
  this.body = body;
  this.status = init?.status ?? 200;
  this.ok = this.status === 200;
}

const navigation = {
  url: `${ORIGIN}/board/abc`,
  method: "GET",
  mode: "navigate",
};

const asset = {
  url: `${ORIGIN}${ENTRY_ASSET}`,
  method: "GET",
};

describe("service worker", () => {
  let caches: ReturnType<typeof createCaches>;

  beforeEach(() => {
    caches = createCaches();
  });

  it("precaches the app shell and the entry assets on install", async () => {
    const { dispatch, self } = loadWorker(caches.api, vi.fn(), [ENTRY_ASSET]);

    await dispatch("install");

    const installed = caches.store.get(VERSION);
    expect(installed?.has("/")).toBe(true);
    expect(installed?.has(ENTRY_ASSET)).toBe(true);
    // TASK-151 (C5): an update waits for the page, it does not seize open
    // tabs on install.
    expect(self.skipWaiting).not.toHaveBeenCalled();

    await dispatch("message", undefined, { type: "SKIP_WAITING" });
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("serves a lazy chunk from the kept previous deploy (TASK-151, C5)", async () => {
    caches = createCaches({
      [VERSION]: {},
      "janosik-previous": {
        [`${ORIGIN}${ENTRY_ASSET}`]: response(
          "old-chunk",
          200,
          headers({ "Content-Type": "application/javascript" }),
        ),
      },
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", asset);

    expect(result).toMatchObject({ body: "old-chunk" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caches a successful navigation as the app shell", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response("<html>fresh"));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", navigation);

    expect(result).toMatchObject({ body: "<html>fresh" });
    expect(caches.store.get(VERSION)?.get("/")?.body).toBe("<html>fresh");
  });

  it("does not cache an error response as the app shell", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response("oops", 500));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", navigation);

    // The error still reaches the page — it is only kept out of the cache
    // (the cache is not even opened, so there is no entry to find).
    expect(result).toMatchObject({ status: 500 });
    expect(caches.store.get(VERSION)?.has("/") ?? false).toBe(false);
  });

  it("keeps serving the cached shell after a failed navigation", async () => {
    caches = createCaches({ [VERSION]: { "/": response("<html>cached") } });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", navigation);

    expect(result).toMatchObject({ body: "<html>cached" });
  });

  it("answers a failed navigation with 503 when nothing is cached", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", navigation);

    expect(result).toMatchObject({ status: 503, body: "Offline" });
  });

  it("ignores non-GET requests", async () => {
    const fetchImpl = vi.fn();
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", {
      ...navigation,
      method: "POST",
    });

    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores requests from other origins", async () => {
    const fetchImpl = vi.fn();
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", {
      url: "https://other.test/assets/index-abc123.js",
      method: "GET",
    });

    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never intercepts API requests", async () => {
    const fetchImpl = vi.fn();
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", {
      url: `${ORIGIN}/api/v1/boards/abc`,
      method: "GET",
    });

    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      caches.store.get(VERSION)?.has(`${ORIGIN}/api/v1/boards/abc`) ?? false,
    ).toBe(false);
  });

  it("never intercepts requests carrying Authorization", async () => {
    const fetchImpl = vi.fn();
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    // An asset URL would normally be cached; the header keeps it out.
    const result = await dispatch("fetch", {
      url: `${ORIGIN}/assets/index-abc123.js`,
      method: "GET",
      headers: headers({ Authorization: "Bearer token" }),
    });

    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      caches.store.get(VERSION)?.has(`${ORIGIN}/assets/index-abc123.js`) ??
        false,
    ).toBe(false);
  });

  it("never buffers the event stream", async () => {
    const fetchImpl = vi.fn();
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", {
      url: `${ORIGIN}/events`,
      method: "GET",
      headers: headers({ Accept: "text/event-stream" }),
    });

    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not cache same-origin requests outside the shell", async () => {
    const fetchImpl = vi.fn();
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", {
      url: `${ORIGIN}/share/xyz`,
      method: "GET",
    });

    expect(result).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still caches the shell's static files", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response("manifest"));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", {
      url: `${ORIGIN}/manifest.webmanifest`,
      method: "GET",
    });

    expect(result).toMatchObject({ body: "manifest" });
    expect(
      caches.store.get(VERSION)?.has(`${ORIGIN}/manifest.webmanifest`),
    ).toBe(true);
  });

  it("serves assets cache-first and only caches successful ones", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response("chunk", 200, headers({ "Content-Type": "text/javascript" })),
      );
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    await dispatch("fetch", {
      url: `${ORIGIN}/assets/index-abc123.js`,
      method: "GET",
    });
    expect(caches.store.get(VERSION)?.has("/assets/index-abc123.js")).toBe(
      false,
    );
    // Requests are keyed by the Request object; the fake cache keys by url.
    expect(
      caches.store.get(VERSION)?.has(`${ORIGIN}/assets/index-abc123.js`),
    ).toBe(true);

    fetchImpl.mockResolvedValue(response("missing", 404));
    await dispatch("fetch", {
      url: `${ORIGIN}/assets/gone-000000.js`,
      method: "GET",
    });
    expect(
      caches.store.get(VERSION)?.has(`${ORIGIN}/assets/gone-000000.js`),
    ).toBe(false);
  });

  it("refuses a 200 HTML answer for a missing lazy chunk (TASK-156)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response("<html>", 200, headers({ "Content-Type": "text/html" })),
      );
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", asset);

    expect(result).toMatchObject({ status: 503, body: "Offline" });
    expect(caches.store.get(VERSION)?.has(`${ORIGIN}${ENTRY_ASSET}`)).toBe(
      false,
    );
  });

  it("refuses a 200 asset answer with no Content-Type (TASK-156 review)", async () => {
    // A proxy may strip the header on the HTML fallback: a missing type is
    // just as untrustworthy as an explicit text/html one — neither may be
    // served or cached as JavaScript.
    const fetchImpl = vi.fn().mockResolvedValue(response("<html>", 200));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", asset);

    expect(result).toMatchObject({ status: 503, body: "Offline" });
    expect(caches.store.get(VERSION)?.has(`${ORIGIN}${ENTRY_ASSET}`)).toBe(
      false,
    );
  });

  it("does not serve an HTML entry a pre-TASK-156 cache poisoned (TASK-156 review)", async () => {
    caches = createCaches({
      [VERSION]: {},
      "janosik-previous": {
        [`${ORIGIN}${ENTRY_ASSET}`]: response(
          "<html>",
          200,
          headers({ "Content-Type": "text/html" }),
        ),
      },
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", asset);

    // The poisoned hit is skipped, and with the network gone the honest
    // answer is offline — never HTML as JavaScript.
    expect(result).toMatchObject({ status: 503, body: "Offline" });
  });

  it("falls back to the network when the kept cache holds a poisoned asset", async () => {
    caches = createCaches({
      [VERSION]: {},
      "janosik-previous": {
        [`${ORIGIN}${ENTRY_ASSET}`]: response(
          "<html>",
          200,
          headers({ "Content-Type": "text/html" }),
        ),
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        response(
          "fresh-chunk",
          200,
          headers({ "Content-Type": "text/javascript" }),
        ),
      );
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", asset);

    expect(result).toMatchObject({ body: "fresh-chunk" });
    expect(fetchImpl).toHaveBeenCalledWith(asset);
    // The good answer replaces the poison in the current deploy's cache.
    expect(
      caches.store.get(VERSION)?.get(`${ORIGIN}${ENTRY_ASSET}`)?.body,
    ).toBe("fresh-chunk");
  });

  it("falls back to the offline response when an asset fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const { dispatch } = loadWorker(caches.api, fetchImpl);

    const result = await dispatch("fetch", asset);

    expect(result).toMatchObject({ status: 503, body: "Offline" });
    expect(caches.store.get(VERSION)?.has(`${ORIGIN}${ENTRY_ASSET}`)).toBe(
      false,
    );
  });

  it("drops only the older janosik caches on activate", async () => {
    caches = createCaches({
      [VERSION]: {},
      "janosik-older": { "/assets/old-0.js": response("stale") },
      "janosik-oldbuild": { "/assets/old-1.js": response("stale") },
      "unrelated-app-cache": { "/keep": response("keep") },
    });
    const { dispatch, self } = loadWorker(caches.api, vi.fn());

    await dispatch("activate");

    // The newest previous deploy is the lazy-chunk fallback (TASK-151, C5);
    // anything older goes, so storage stays bounded. The meta cache records
    // which deploy is active (TASK-156).
    expect([...caches.store.keys()].sort()).toEqual(
      [
        VERSION,
        "janosik-meta",
        "janosik-oldbuild",
        "unrelated-app-cache",
      ].sort(),
    );
    expect(self.clients.claim).toHaveBeenCalled();
  });
});

describe("entryAssetNames", () => {
  type Bundle = Parameters<typeof entryAssetNames>[0];

  const chunk = (
    isEntry: boolean,
    imports: string[] = [],
    css: string[] = [],
  ) =>
    ({
      type: "chunk" as const,
      isEntry,
      imports,
      viteMetadata: { importedCss: new Set(css) },
    }) as unknown;

  it("collects the entry chunk, its static imports and their css", () => {
    const bundle = {
      "assets/index-abc.js": chunk(
        true,
        ["assets/react-def.js"],
        ["assets/index-abc.css"],
      ),
      "assets/react-def.js": chunk(false),
      "assets/lazy-xyz.js": chunk(false),
      "assets/icon.svg": { type: "asset" },
    } as unknown as Bundle;

    expect(entryAssetNames(bundle)).toEqual([
      "/assets/index-abc.css",
      "/assets/index-abc.js",
      "/assets/react-def.js",
    ]);
  });
});

describe("cacheVersionFrom", () => {
  it("changes when the build output changes", () => {
    const before = cacheVersionFrom(["assets/index-aaa.js", "index.html"]);
    const after = cacheVersionFrom(["assets/index-bbb.js", "index.html"]);

    expect(before).not.toBe(after);
    expect(before).toMatch(/^janosik-[0-9a-f]{8}$/);
  });

  it("ignores the order of the file names", () => {
    expect(cacheVersionFrom(["b.js", "a.js"])).toBe(
      cacheVersionFrom(["a.js", "b.js"]),
    );
  });
});
