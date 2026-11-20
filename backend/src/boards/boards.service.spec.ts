import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { isGuaranteedRollback } from "@/common/rollback-certainty";
import { BoardsService } from "./boards.service";

/** TASK-101: the board list must not run a per-board card count. */
describe("BoardsService.listBoards", () => {
  it("counts cards in a constant number of queries", async () => {
    const memberships = [
      {
        boardId: "b1",
        role: "ADMIN",
        board: {
          id: "b1",
          title: "A",
          archivedAt: null,
          _count: { columns: 2 },
        },
      },
      {
        boardId: "b2",
        role: "MEMBER",
        board: {
          id: "b2",
          title: "B",
          archivedAt: null,
          _count: { columns: 1 },
        },
      },
    ];
    const count = jest.fn();
    const groupBy = jest.fn().mockResolvedValue([
      { columnId: "c1", _count: { _all: 3 } },
      { columnId: "c2", _count: { _all: 2 } },
    ]);
    const prisma = {
      boardMember: { findMany: jest.fn().mockResolvedValue(memberships) },
      card: { groupBy, count },
      column: {
        findMany: jest.fn().mockResolvedValue([
          { id: "c1", boardId: "b1" },
          { id: "c2", boardId: "b2" },
        ]),
      },
    } as unknown as PrismaService;

    const service = new BoardsService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const summaries = await service.listBoards("u1");

    expect(count).not.toHaveBeenCalled();
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(summaries.map((summary) => summary.counters.cards)).toEqual([3, 2]);
  });
});

/**
 * TASK-156 (item 37): a pending invite must not swallow a material change.
 * An expired one (invisible in the feed) and a re-invite with a different
 * role/TTL both revive the row in the same transaction; only a truly
 * identical pending invite stays an idempotent no-op.
 */
describe("BoardsService.inviteMember — reviving a pending invite", () => {
  const invitee = { id: "u-invitee", email: "invitee@example.com" };
  const actorId = "u-owner";

  function makeService(existing: Record<string, unknown> | null) {
    const update = jest.fn();
    const tx = {
      boardMember: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update,
        create: jest.fn(),
      },
      activity: { create: jest.fn() },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(invitee) },
    } as unknown as PrismaService;
    const boardWrite = {
      run: jest.fn((_boardId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const service = new BoardsService(
      prisma,
      boardWrite as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, update };
  }

  const dto = (
    role: "ADMIN" | "MEMBER" | "VIEWER",
    expiresAt?: string | null,
  ) => ({
    email: "Invitee@Example.com",
    role,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });

  it("updates role/inviter/TTL when the role changed", async () => {
    const { service, update } = makeService({
      id: "m-1",
      acceptedAt: null,
      role: "MEMBER",
      expiresAt: null,
    });

    await service.inviteMember(
      "board-1",
      actorId,
      dto("VIEWER", "2030-01-01T00:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: {
        role: "VIEWER",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        invitedById: actorId,
      },
    });
  });

  it("revives an expired pending invite with the fresh role and TTL", async () => {
    const { service, update } = makeService({
      id: "m-1",
      acceptedAt: null,
      role: "VIEWER",
      expiresAt: new Date(Date.now() - 60_000),
    });

    await service.inviteMember(
      "board-1",
      actorId,
      dto("VIEWER", "2030-01-01T00:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: {
        role: "VIEWER",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        invitedById: actorId,
      },
    });
  });

  it("updates the TTL of a still-pending, unexpired VIEWER invite", async () => {
    const { service, update } = makeService({
      id: "m-1",
      acceptedAt: null,
      role: "VIEWER",
      expiresAt: new Date("2029-01-01T00:00:00.000Z"),
    });

    await service.inviteMember(
      "board-1",
      actorId,
      dto("VIEWER", "2031-01-01T00:00:00.000Z"),
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: {
        role: "VIEWER",
        expiresAt: new Date("2031-01-01T00:00:00.000Z"),
        invitedById: actorId,
      },
    });
  });

  it("keeps a truly identical pending invite an idempotent no-op", async () => {
    const { service, update } = makeService({
      id: "m-1",
      acceptedAt: null,
      role: "MEMBER",
      expiresAt: null,
    });

    await service.inviteMember("board-1", actorId, dto("MEMBER"));

    expect(update).not.toHaveBeenCalled();
  });

  it("still 409s an already-accepted member", async () => {
    const { service } = makeService({
      id: "m-1",
      acceptedAt: new Date(),
      role: "MEMBER",
      expiresAt: null,
    });

    await expect(
      service.inviteMember("board-1", actorId, dto("MEMBER")),
    ).rejects.toThrow(ConflictException);
  });
});

describe("BoardsService.leaveBoard (TASK-177.2)", () => {
  function makeService(role: "ADMIN" | "MEMBER" | "VIEWER", otherAdmins = 0) {
    const member = {
      id: "m-1",
      boardId: "board-1",
      userId: "u-1",
      role,
      acceptedAt: new Date(),
      user: { email: "user@example.com" },
    };
    const remove = jest.fn().mockResolvedValue({});
    const activity = jest.fn().mockResolvedValue({});
    const tx = {
      boardMember: {
        findUnique: jest.fn().mockResolvedValue(member),
        count: jest.fn().mockResolvedValue(otherAdmins),
        delete: remove,
      },
      activity: { create: activity },
    };
    const boardWrite = {
      run: jest.fn((_boardId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const realtime = { publish: jest.fn() };
    const service = new BoardsService(
      {} as unknown as PrismaService,
      boardWrite as never,
      realtime as never,
      {} as never,
      {} as never,
    );
    return { service, remove, activity, realtime };
  }

  it("removes the membership, records member_left and publishes SSE", async () => {
    const { service, remove, activity, realtime } = makeService("MEMBER");

    await service.leaveBoard("board-1", "u-1");

    expect(remove).toHaveBeenCalledWith({ where: { id: "m-1" } });
    expect(activity).toHaveBeenCalledWith({
      data: expect.objectContaining({
        boardId: "board-1",
        type: "member_left",
        actorId: "u-1",
        details: {
          userId: "u-1",
          email: "user@example.com",
          role: "MEMBER",
        },
      }),
    });
    expect(realtime.publish).toHaveBeenCalledWith("board-1", {
      type: "membership",
      boardId: "board-1",
      userId: "u-1",
      change: "removed",
    });
  });

  it("refuses the last ADMIN with a clear last_admin code", async () => {
    const { service, remove, activity, realtime } = makeService("ADMIN", 0);

    await expect(service.leaveBoard("board-1", "u-1")).rejects.toMatchObject({
      response: { code: "last_admin", action: "leave" },
    });
    expect(remove).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it("lets an ADMIN leave once another accepted admin exists", async () => {
    const { service, remove } = makeService("ADMIN", 1);

    await service.leaveBoard("board-1", "u-1");

    expect(remove).toHaveBeenCalled();
  });
});

describe("BoardsService.createBoard — L24 rollback proof", () => {
  it("marks a write-transaction P2028 as a guaranteed rollback", async () => {
    const timeout = Object.assign(
      new Error("Transaction already closed after timeout"),
      { code: "P2028" },
    );
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(timeout),
    } as unknown as PrismaService;
    const attention = { notifyLimitExceeded: jest.fn().mockResolvedValue(0) };
    const service = new BoardsService(
      prisma,
      {} as never,
      {} as never,
      attention as never,
      {} as never,
    );

    await expect(service.createBoard("u1", { title: "Board" })).rejects.toBe(
      timeout,
    );
    expect(isGuaranteedRollback(timeout)).toBe(true);
    expect(attention.notifyLimitExceeded).toHaveBeenCalled();
  });
});
