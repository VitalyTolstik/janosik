import { AdminService } from "./admin.service";

/**
 * TASK-200.5: the master panel's revoke actions clear the cached PAT
 * resolutions on every replica, even when the row was already revoked.
 */
describe("AdminService PAT cache invalidation (TASK-200.5)", () => {
  function service() {
    const prisma = {
      apiToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: "token-1",
          userId: "user-1",
          name: "CI",
          user: { email: "u@example.com" },
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "token-1" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: "user-1" }),
      },
    };
    const realtime = { publishInvalidation: jest.fn() };
    return {
      prisma,
      realtime,
      audit: jest.fn(),
      securityAudit: { record: jest.fn() },
    };
  }

  it("invalidates one token even when it was already revoked", async () => {
    const target = service();
    const call = AdminService.prototype.revokeToken as (
      this: typeof target,
      tokenId: string,
      admin: { id: string },
    ) => Promise<{ revoked: number }>;

    await call.call(target, "token-1", { id: "admin-1" });

    expect(target.realtime.publishInvalidation).toHaveBeenCalledWith({
      kind: "pat",
      tokenId: "token-1",
    });
  });

  it("invalidates a user's whole PAT map even when no rows changed", async () => {
    const target = service();
    const call = AdminService.prototype.revokeUserTokens as (
      this: typeof target,
      userId: string,
      admin: { id: string },
    ) => Promise<{ revoked: number }>;

    await call.call(target, "user-1", { id: "admin-1" });

    expect(target.realtime.publishInvalidation).toHaveBeenCalledWith({
      kind: "pat",
    });
  });

  it("invalidates cached PATs when the panel disables the account", async () => {
    const user = {
      id: "user-1",
      email: "u@example.com",
      displayName: null,
      disabledAt: null,
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      passwordResetToken: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: jest.fn(),
          passwordResetToken: { deleteMany: jest.fn() },
          user: {
            update: jest
              .fn()
              .mockResolvedValue({ ...user, disabledAt: new Date() }),
          },
        }),
      ),
    };
    const target = {
      prisma,
      realtime: { publishInvalidation: jest.fn() },
      revokeUserSessions: jest.fn().mockResolvedValue({ revoked: 1 }),
      audit: jest.fn(),
      securityAudit: { record: jest.fn() },
      userRow: jest.fn().mockResolvedValue({}),
    };
    const call = AdminService.prototype.updateUser as (
      this: typeof target,
      userId: string,
      dto: { disabled?: boolean },
      admin: { id: string },
    ) => Promise<unknown>;

    await call.call(target, "user-1", { disabled: true }, { id: "admin-1" });

    expect(target.realtime.publishInvalidation).toHaveBeenCalledWith({
      kind: "pat",
    });
  });
});
