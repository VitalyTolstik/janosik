import { afterEach, describe, expect, it } from "vitest";

import { findOpenOverlay, isOverlayOpen } from "./overlay";

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
      { role: "alertdialog" },
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

  it("ignores surfaces that are animating closed (M41/L31)", () => {
    for (const marker of [
      { role: "dialog" },
      { role: "alertdialog" },
      { role: "menu" },
      { role: "listbox" },
      { "data-slot": "context-menu-content" },
    ]) {
      document.body.replaceChildren();
      const overlay = document.createElement("div");
      for (const [name, value] of Object.entries(marker)) {
        overlay.setAttribute(name, value);
      }
      overlay.setAttribute("data-state", "closed");
      document.body.append(overlay);

      expect(isOverlayOpen()).toBe(false);
    }
  });

  it("ignores nested role-bearing content inside a closed surface", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "closed");
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    dialog.append(listbox);
    document.body.append(dialog);

    // The app palette keeps its listbox mounted during the exit animation;
    // it has no data-state of its own.
    expect(isOverlayOpen()).toBe(false);

    dialog.setAttribute("data-state", "open");
    expect(isOverlayOpen()).toBe(true);
  });

  it("finds the top portalled surface and skips hidden and closing overlays", () => {
    document.body.innerHTML = `
      <div id="card" role="dialog" data-state="open">
        <div role="listbox" data-state="open"></div>
      </div>
      <div id="menu" role="menu" data-state="open"></div>
      <div role="dialog" data-state="closed"></div>
      <div aria-hidden="true"><div role="dialog" data-state="open"></div></div>
      <div hidden><div role="listbox"></div></div>
    `;

    const menu = document.getElementById("menu");
    expect(findOpenOverlay()).toBe(menu);
    menu?.remove();
    expect(findOpenOverlay()).toBe(document.getElementById("card"));
  });
});
