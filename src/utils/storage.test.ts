import { afterEach, describe, expect, it, vi } from "vitest";

import { loadJSON, migrateStorageKey, saveJSON } from "@/utils/storage";

/**
 * Tests for the localStorage helpers: round-trip, graceful failure on corrupt
 * or missing data, reporting when the storage API throws (private mode,
 * quota exceeded, storage disabled), and the one-time key migration used by
 * the app rebrand.
 */

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadJSON", () => {
  it("round-trips a value saved via saveJSON", () => {
    expect(saveJSON("janosik-test", { boards: 1, ok: true })).toBe(true);
    expect(loadJSON<{ boards: number; ok: boolean }>("janosik-test")).toEqual({
      boards: 1,
      ok: true,
    });
  });

  it("returns null for a missing key", () => {
    expect(loadJSON("janosik-nope")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem("janosik-bad", "{not json");
    expect(loadJSON("janosik-bad")).toBeNull();
  });

  it("returns null when localStorage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(loadJSON("janosik-any")).toBeNull();
  });
});

describe("saveJSON", () => {
  it("stores JSON-serializable values", () => {
    expect(saveJSON("janosik-obj", { a: [1, 2, 3] })).toBe(true);
    expect(localStorage.getItem("janosik-obj")).toBe('{"a":[1,2,3]}');
  });

  it("returns false when localStorage throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(saveJSON("janosik-any", { a: 1 })).toBe(false);
  });
});

describe("migrateStorageKey", () => {
  it("migrates data from the old key to the new key and removes the old", () => {
    localStorage.setItem("vortex-old", "data");
    migrateStorageKey("vortex-old", "janosik-new");
    expect(localStorage.getItem("janosik-new")).toBe("data");
    expect(localStorage.getItem("vortex-old")).toBeNull();
  });

  it("does not overwrite an existing new key", () => {
    localStorage.setItem("vortex-old", "old");
    localStorage.setItem("janosik-new", "new");
    migrateStorageKey("vortex-old", "janosik-new");
    expect(localStorage.getItem("janosik-new")).toBe("new");
    expect(localStorage.getItem("vortex-old")).toBe("old");
  });

  it("is a no-op when the old key is missing", () => {
    migrateStorageKey("vortex-missing", "janosik-new");
    expect(localStorage.getItem("janosik-new")).toBeNull();
  });
});
