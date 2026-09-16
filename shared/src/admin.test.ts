import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_PAGE_LIMITS,
  ADMIN_PASSWORD_MAX,
  ADMIN_PASSWORD_MIN,
} from "./admin";

describe("admin contract", () => {
  it("keeps audit actions unique and namespaced", () => {
    expect(new Set(ADMIN_AUDIT_ACTIONS).size).toBe(ADMIN_AUDIT_ACTIONS.length);
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it("ships sane page limits", () => {
    expect(ADMIN_PAGE_LIMITS.min).toBeLessThan(ADMIN_PAGE_LIMITS.default);
    expect(ADMIN_PAGE_LIMITS.default).toBeLessThan(ADMIN_PAGE_LIMITS.max);
    expect(ADMIN_PAGE_LIMITS.max).toBeLessThanOrEqual(100);
  });

  it("bounds master-created passwords like the register DTO", () => {
    expect(ADMIN_PASSWORD_MIN).toBeGreaterThanOrEqual(8);
    expect(ADMIN_PASSWORD_MAX).toBeGreaterThanOrEqual(ADMIN_PASSWORD_MIN);
  });
});
