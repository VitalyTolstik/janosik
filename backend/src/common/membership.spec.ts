import { activeMembershipWhere, isActiveMembership } from "./membership";

/**
 * TASK-147 (B4/B5): the one predicate every membership read shares. Its shape
 * matters — a missing `expiresAt` branch is exactly the leak the audit found.
 */
describe("activeMembershipWhere", () => {
  it("requires an accepted invitation", () => {
    expect(activeMembershipWhere()).toMatchObject({
      acceptedAt: { not: null },
    });
  });

  it("excludes an elapsed time budget against one instant", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const where = activeMembershipWhere(now);
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }]);
  });
});

describe("isActiveMembership", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("accepts an accepted member with no budget", () => {
    expect(isActiveMembership({ acceptedAt: now, expiresAt: null }, now)).toBe(
      true,
    );
  });

  it("rejects a pending invitation and an elapsed VIEWER", () => {
    expect(isActiveMembership({ acceptedAt: null, expiresAt: null }, now)).toBe(
      false,
    );
    expect(
      isActiveMembership(
        { acceptedAt: now, expiresAt: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe(false);
    expect(
      isActiveMembership(
        { acceptedAt: now, expiresAt: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe(true);
  });
});
