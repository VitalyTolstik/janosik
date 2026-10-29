import { queueDashboardOwner } from "./queues.module";

/**
 * TASK-147 (B6): the Bull Board SPA is mounted on Express, outside the Nest
 * guard pipeline, so it must apply the admin IP allowlist itself.
 */
describe("queueDashboardOwner", () => {
  const owner = {
    role: "OWNER",
    disabledAt: null,
    ipAllowlist: null,
  };

  it("allows an owner with no allowlist from anywhere", () => {
    expect(queueDashboardOwner(owner, "203.0.113.7")).toBe(true);
  });

  it("refuses a caller outside the owner's allowlist", () => {
    expect(
      queueDashboardOwner(
        { ...owner, ipAllowlist: "10.0.0.0/8" },
        "203.0.113.7",
      ),
    ).toBe(false);
    expect(
      queueDashboardOwner({ ...owner, ipAllowlist: "10.0.0.0/8" }, "10.1.2.3"),
    ).toBe(true);
  });

  it("refuses non-owners and disabled admins", () => {
    expect(queueDashboardOwner({ ...owner, role: "OPERATOR" }, null)).toBe(
      false,
    );
    expect(
      queueDashboardOwner({ ...owner, disabledAt: new Date() }, null),
    ).toBe(false);
  });
});
