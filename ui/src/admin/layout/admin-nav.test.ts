import { describe, expect, it } from "vitest";

import {
  ADMIN_HUBS,
  ADMIN_NAV_GROUPS,
  HUB_DEFAULT_TAB,
  HUB_TABS,
  hubForPath,
  hubTabHref,
} from "./admin-nav";

/**
 * The IA is data, so the invariants that used to be a human checklist are
 * unit-testable: every hub has one path, every legacy destination has one
 * tab, and detail routes keep their parent hub selected.
 */
describe("admin navigation model", () => {
  it("keeps eight unique hubs and lists every hub exactly once in a group", () => {
    expect(ADMIN_HUBS).toHaveLength(8);
    expect(new Set(ADMIN_HUBS.map((hub) => hub.to)).size).toBe(8);
    const grouped = ADMIN_NAV_GROUPS.flatMap((group) => group.keys);
    expect(grouped).toHaveLength(8);
    expect(new Set(grouped).size).toBe(8);
    expect(grouped.sort()).toEqual(ADMIN_HUBS.map((hub) => hub.key).sort());
  });

  it("has a default tab for every hub that owns tabs", () => {
    for (const [hub, tabs] of Object.entries(HUB_TABS)) {
      if (tabs.length === 0) continue;
      expect(
        HUB_DEFAULT_TAB[hub as keyof typeof HUB_DEFAULT_TAB],
      ).toBeDefined();
      for (const tab of tabs) {
        expect(tab.legacyPath).toMatch(/^\/admin\//);
      }
    }
  });

  it("maps detail routes back to their parent hub", () => {
    expect(hubForPath("/admin")).toBe("overview");
    expect(hubForPath("/admin/users/42")).toBe("users");
    expect(hubForPath("/admin/boards/42/content")).toBe("boards");
    expect(hubForPath("/admin/cards/42")).toBe("boards");
    expect(hubForPath("/admin/settings")).toBe("settings");
    expect(hubForPath("/outside")).toBeNull();
  });

  it("encodes tab links without losing the hub", () => {
    expect(hubTabHref("boards", "cards")).toBe("/admin/boards?tab=cards");
    expect(hubTabHref("settings", "security")).toBe(
      "/admin/settings?tab=security",
    );
  });
});
