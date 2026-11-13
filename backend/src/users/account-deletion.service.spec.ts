import type { PrismaService } from "@/common/prisma/prisma.service";
import { AccountDeletionService } from "./account-deletion.service";
import { ConflictException } from "@nestjs/common";

function makePrisma() {
  return {
    securityAuditLog: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: "marker-1", userId: "user-1", targetId: "board-1" },
        ]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    board: {
      findUnique: jest.fn().mockResolvedValue({ deletedAt: null }),
    },
    boardMember: { count: jest.fn().mockResolvedValue(0) },
  } as unknown as PrismaService & {
    securityAuditLog: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
    board: { findUnique: jest.Mock };
    boardMember: { count: jest.Mock };
  };
}

describe("AccountDeletionService orphan-board reaper (TASK-166.6)", () => {
  it("does not erase an account re-enabled after the sweep selected it", async () => {
    const deleteUser = jest.fn();
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({ disabledAt: null }),
        delete: deleteUser,
      },
      securityAuditLog: {
        findFirst: jest.fn().mockResolvedValue({ createdAt: new Date(0) }),
      },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "user-1" }) },
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
      dataExport: { findMany: jest.fn().mockResolvedValue([]) },
      apiToken: { findMany: jest.fn().mockResolvedValue([]) },
      boardMember: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
    };
    const service = new AccountDeletionService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
    );
    await expect(
      service.deleteAccount("user-1", {}, new Date()),
    ).resolves.toBeNull();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete a board that gains a member under the lock", async () => {
    const prisma = makePrisma();
    const boards = {
      deleteBoard: jest
        .fn()
        .mockRejectedValue(new ConflictException("Board is no longer empty")),
    };
    const service = new AccountDeletionService(
      prisma,
      {} as never,
      boards as never,
    );
    await expect(
      service.cleanupOrphanBoards("user-1", ["board-1"]),
    ).resolves.toBe(0);
    expect(prisma.securityAuditLog.create).not.toHaveBeenCalled();
  });
  it("writes board.cleanup_failed after two failed inline attempts", async () => {
    const prisma = makePrisma();
    const boards = {
      deleteBoard: jest.fn().mockRejectedValue(new Error("still busy")),
    };
    const service = new AccountDeletionService(
      prisma,
      {} as never,
      boards as never,
    );

    await expect(
      service.cleanupOrphanBoards("user-1", ["board-1"]),
    ).resolves.toBe(0);
    expect(boards.deleteBoard).toHaveBeenCalledTimes(2);
    expect(prisma.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "board.cleanup_failed",
          targetId: "board-1",
        }),
      }),
    );
  });

  it("keeps the marker when deletion still fails", async () => {
    const prisma = makePrisma();
    const boards = {
      deleteBoard: jest.fn().mockRejectedValue(new Error("still busy")),
    };
    const service = new AccountDeletionService(
      prisma,
      {} as never,
      boards as never,
    );

    await expect(
      service.reapOrphanBoards(new Date(Date.now() + 60_000)),
    ).resolves.toBe(0);
    expect(prisma.securityAuditLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.securityAuditLog.create).not.toHaveBeenCalled();
  });

  it("deletes the board, removes the failure marker and records recovery", async () => {
    const prisma = makePrisma();
    const boards = { deleteBoard: jest.fn().mockResolvedValue(undefined) };
    const service = new AccountDeletionService(
      prisma,
      {} as never,
      boards as never,
    );

    await expect(
      service.reapOrphanBoards(new Date(Date.now() + 60_000)),
    ).resolves.toBe(1);
    expect(boards.deleteBoard).toHaveBeenCalledWith(
      "board-1",
      "user-1",
      expect.objectContaining({ actorType: "human" }),
      undefined,
      false,
      true,
    );
    expect(prisma.securityAuditLog.deleteMany).toHaveBeenCalled();
    expect(prisma.securityAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "board.cleanup_recovered" }),
      }),
    );
  });
});
