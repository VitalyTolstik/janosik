import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listQuarantineKeys,
  loadJSON,
  migrateStorageKey,
  quarantineValue,
  readJSON,
  readRaw,
  saveJSON,
} from "@/utils/storage";

/**
 * Tests for the localStorage helpers: round-trip, graceful failure on corrupt
 * or missing data, reporting when the storage API throws (private mode,
 * quota exceeded, storage disabled), the one-time key migration used by the
 * app rebrand, and the quarantine that keeps unparsable data recoverable
 * instead of letting the app overwrite it (TASK-21.2).
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

describe("readJSON", () => {
  it("reports a missing key as missing, not as corrupt", () => {
    expect(readJSON("janosik-nope")).toEqual({ status: "missing" });
  });

  it("returns the parsed value for valid JSON", () => {
    localStorage.setItem("janosik-ok", '{"a":1}');
    expect(readJSON<{ a: number }>("janosik-ok")).toEqual({
      status: "ok",
      value: { a: 1 },
    });
  });

  it("quarantines unparsable text under <key>.corrupt.<ts>", () => {
    localStorage.setItem("janosik-boards", "{not json");
    const result = readJSON("janosik-boards");

    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") throw new Error("expected corrupt");
    expect(result.quarantineKey).toMatch(/^janosik-boards\.corrupt\.\d+$/);
    expect(localStorage.getItem(result.quarantineKey ?? "")).toBe("{not json");
  });

  it("reports unavailable storage without quarantining anything", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(readJSON("janosik-any")).toEqual({ status: "unavailable" });
  });

  it("reports a failed quarantine copy instead of pretending it worked", () => {
    localStorage.setItem("janosik-boards", "{not json");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(readJSON("janosik-boards")).toEqual({
      status: "corrupt",
      quarantineKey: null,
    });
  });
});

describe("quarantineValue", () => {
  it("keeps only the newest three copies of one key", () => {
    for (let i = 0; i < 5; i++) {
      // Distinct timestamps: the key carries Date.now() as its suffix.
      vi.spyOn(Date, "now").mockReturnValue(1000 + i);
      quarantineValue("janosik-boards", `copy-${i}`);
    }
    const keys = listQuarantineKeys("janosik-boards");
    expect(keys).toHaveLength(3);
    // Newest first, oldest rotated out.
    expect(keys.map((key) => localStorage.getItem(key))).toEqual([
      "copy-4",
      "copy-3",
      "copy-2",
    ]);
  });

  it("does not touch quarantined copies of a different key", () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    quarantineValue("janosik-other", "other");
    for (let i = 0; i < 4; i++) {
      vi.spyOn(Date, "now").mockReturnValue(100 + i);
      quarantineValue("janosik-boards", `copy-${i}`);
    }
    expect(listQuarantineKeys("janosik-other")).toEqual([
      "janosik-other.corrupt.1",
    ]);
  });
});

describe("readRaw", () => {
  it("returns the stored text unparsed", () => {
    localStorage.setItem("janosik-raw", "{not json");
    expect(readRaw("janosik-raw")).toBe("{not json");
  });

  it("returns null when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(readRaw("janosik-raw")).toBeNull();
  });
});
