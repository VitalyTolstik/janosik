import { describe, expect, it } from "vitest";
import { adminMessage } from "./admin-i18n";

describe("admin i18n", () => {
  it("interpolates placeholders", () => {
    expect(adminMessage("admin.common.page", "en", { page: 2, pages: 5 })).toBe(
      "Page 2 of 5",
    );
    expect(
      adminMessage("admin.users.toast.sessionsRevoked", "ru", { count: 3 }),
    ).toBe("Отозвано сессий: 3");
  });

  it("keeps unknown placeholders untouched", () => {
    expect(adminMessage("admin.common.total", "en")).toBe("{count} total");
  });

  it("renders the workflow summary without literal braces", () => {
    const params = { state: "enabled", active: 8, count: 8 };
    for (const lang of ["en", "ru"] as const) {
      const text = adminMessage("admin.workflow.summary", lang, params);
      expect(text).not.toContain("{");
      expect(text).not.toContain("}");
      expect(text).toContain("8");
    }
  });

  it("has a Russian translation for every English key", () => {
    const keys = [
      "admin.title",
      "admin.login.title",
      "admin.users.title",
      "admin.boards.title",
      "admin.log.title",
      "admin.audit.title",
      "admin.bulk.partial",
    ] as const;
    for (const key of keys) {
      expect(adminMessage(key, "ru")).not.toBe(adminMessage(key, "en"));
    }
  });
});
