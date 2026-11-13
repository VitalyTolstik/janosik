import { describe, expect, it, vi } from "vitest";

import { createId } from "./id";

/** TASK-98: client ids become server PKs — they must be unique and id-safe. */
describe("createId", () => {
  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId()));
    expect(ids.size).toBe(1000);
  });

  it("only emits characters valid in an id (no spaces/slashes)", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(createId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
        return bytes;
      },
    });
    try {
      expect(createId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
