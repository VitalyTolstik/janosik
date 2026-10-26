import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadAppVersion,
  resetAppVersionCache,
  type AppVersion,
} from "./app-version";

/**
 * The build manifest the master panel reads (`version.json`, emitted by the
 * service-worker plugin). Fetching is memoised; a missing or unreachable
 * manifest degrades to `null` so the panel shows a dash instead of failing.
 */

const MANIFEST: AppVersion = {
  version: "1.2.3",
  commit: "abc1234",
  build: "janosik-deadbeef",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetAppVersionCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppVersionCache();
});

describe("loadAppVersion", () => {
  it("reads and parses the build manifest", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(MANIFEST));
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadAppVersion()).toEqual(MANIFEST);
    expect(fetchMock).toHaveBeenCalledWith(
      "/version.json",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("resolves to null when the manifest is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "nope" }, 404)),
    );
    expect(await loadAppVersion()).toBeNull();
  });

  it("resolves to null when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await loadAppVersion()).toBeNull();
  });

  it("fetches at most once", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(MANIFEST));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([loadAppVersion(), loadAppVersion()]);
    await loadAppVersion();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the cache is reset", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(MANIFEST));
    vi.stubGlobal("fetch", fetchMock);

    await loadAppVersion();
    resetAppVersionCache();
    await loadAppVersion();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
