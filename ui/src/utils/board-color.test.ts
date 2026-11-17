import { describe, expect, it } from "vitest";

import { boardColor } from "@/utils/board-color";

describe("boardColor", () => {
  it("keeps the authored Website Relaunch identity teal in every locale", () => {
    expect(boardColor("px-board-website")).toBe("bg-teal");
  });

  it("still derives a stable color from an unknown board id", () => {
    expect(boardColor("board-1")).toBe(boardColor("board-1"));
    expect(boardColor("board-1")).toMatch(/^bg-/);
  });
});
