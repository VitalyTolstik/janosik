import { describe, expect, it } from "vitest";

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
});
