import { afterEach, describe, expect, it } from "vitest";

import { isOverlayOpen } from "./overlay";

/** The overlay guard shared by the board, filter and help shortcuts. */
describe("isOverlayOpen", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("ignores tooltips and a plain page", () => {
    const tooltip = document.createElement("div");
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);

    expect(isOverlayOpen()).toBe(false);
  });

  it("detects dialogs, menus and the card context menu", () => {
    for (const marker of [
      { role: "dialog" },
      { role: "menu" },
      { role: "listbox" },
      { "data-slot": "context-menu-content" },
    ]) {
      document.body.replaceChildren();
      const overlay = document.createElement("div");
      for (const [name, value] of Object.entries(marker)) {
        overlay.setAttribute(name, value);
      }
      document.body.append(overlay);

      expect(isOverlayOpen()).toBe(true);
    }
  });
});
