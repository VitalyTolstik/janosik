import { describe, expect, it } from "vitest";

import { buildPayload, shouldTrack } from "./analytics";

describe("buildPayload", () => {
  it("uses an object-action event name with its properties", () => {
    expect(buildPayload("cta_clicked", { cta: "hero-signup" })).toEqual({
      event: "cta_clicked",
      cta: "hero-signup",
    });
  });

  it("works without properties", () => {
    expect(buildPayload("cta_clicked")).toEqual({ event: "cta_clicked" });
  });
});

describe("shouldTrack", () => {
  it("skips when Do Not Track is on", () => {
    expect(shouldTrack("1")).toBe(false);
  });

  it("tracks when Do Not Track is off or absent", () => {
    expect(shouldTrack("0")).toBe(true);
    expect(shouldTrack(null)).toBe(true);
    expect(shouldTrack(undefined)).toBe(true);
  });
});
