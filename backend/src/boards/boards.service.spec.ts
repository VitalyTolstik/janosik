import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "@/common/prisma/prisma.service";
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

    const service = new BoardsService(prisma, {} as never, {} as never);
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
    const service = new BoardsService(prisma, boardWrite as never, {} as never);
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
