import { describe, expect, it } from "vitest";

import { APP_BASE, appPath, appShareUrl } from "./app-path";

describe("app-path", () => {
  it("exposes the Vite base (root in tests)", () => {
    expect(APP_BASE).toBe("/");
  });

  it("prefixes in-app paths with the base", () => {
    expect(appPath("/board/1")).toBe("/board/1");
    expect(appPath("board/1")).toBe("/board/1");
  });

  it("builds absolute share urls against the current origin", () => {
    expect(appShareUrl("/s/tok")).toBe(`${window.location.origin}/s/tok`);
  });
});
