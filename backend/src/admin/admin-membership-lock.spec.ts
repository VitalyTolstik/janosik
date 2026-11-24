import { AdminService } from "./admin.service";

describe("AdminService.addBoardMember membership lock", () => {
  it("adds the accepted membership through the user-locked board writer", async () => {
    const prisma = {
      board: { findFirst: jest.fn().mockResolvedValue({ id: "board-1" }) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "user-1", email: "m@example.com" }),
      },
      boardMember: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const create = jest.fn().mockResolvedValue({});
    const tx = {
      boardMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const run = jest.fn(
      async (
        _boardId: string,
        fn: (client: unknown) => Promise<unknown>,
        _pause?: unknown,
        _options?: unknown,
      ) => fn(tx),
    );
    const service: {
      addBoardMember: AdminService["addBoardMember"];
      prisma: unknown;
      boardWrite: unknown;
      realtime: unknown;
      audit: jest.Mock;
    } = Object.create(AdminService.prototype);
    service.prisma = prisma;
    service.boardWrite = { run };
    service.realtime = { publishInvalidation: jest.fn() };
    service.audit = jest.fn().mockResolvedValue(undefined);

    await service.addBoardMember(
      "board-1",
      { email: "m@example.com", role: "MEMBER" },
      { id: "admin-1" } as never,
    );

    expect(run).toHaveBeenCalledWith(
      "board-1",
      expect.any(Function),
      undefined,
      { lockUserId: "user-1" },
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        boardId: "board-1",
        userId: "user-1",
        acceptedAt: expect.any(Date),
      }),
    });
  });

  it("accepts a pending member through the user-locked board writer", async () => {
    const prisma = {
      boardMember: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "member-1", userId: "user-1" }),
      },
    };
    const update = jest.fn().mockResolvedValue({});
    const tx = { boardMember: { update } };
    const run = jest.fn(
      async (
        _boardId: string,
        fn: (client: unknown) => Promise<unknown>,
        _pause?: unknown,
        _options?: unknown,
      ) => fn(tx),
    );
    const service: {
      updateBoardMember: AdminService["updateBoardMember"];
      prisma: unknown;
      boardWrite: unknown;
      realtime: unknown;
      audit: jest.Mock;
    } = Object.create(AdminService.prototype);
    service.prisma = prisma;
    service.boardWrite = { run };
    service.realtime = { publishInvalidation: jest.fn() };
    service.audit = jest.fn().mockResolvedValue(undefined);

    await service.updateBoardMember("board-1", "member-1", { accepted: true }, {
      id: "admin-1",
    } as never);

    expect(run).toHaveBeenCalledWith(
      "board-1",
      expect.any(Function),
      undefined,
      { lockUserId: "user-1" },
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: expect.objectContaining({ acceptedAt: expect.any(Date) }),
    });
  });
});
