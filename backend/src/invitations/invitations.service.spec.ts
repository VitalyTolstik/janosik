import type { PrismaService } from "@/common/prisma/prisma.service";
import { InvitationsService } from "./invitations.service";

describe("InvitationsService.accept membership lock", () => {
  it("passes the invitee's user id to the board writer", async () => {
    const invitation = {
      id: "invite-1",
      boardId: "board-1",
      role: "MEMBER",
      expiresAt: null,
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ emailVerifiedAt: new Date() }),
      },
      boardMember: { findFirst: jest.fn().mockResolvedValue(invitation) },
    } as unknown as PrismaService;
    const tx = {
      boardMember: {
        findFirst: jest.fn().mockResolvedValue(invitation),
        update: jest.fn().mockResolvedValue(invitation),
        delete: jest.fn(),
      },
      activity: { create: jest.fn().mockResolvedValue({}) },
    };
    const run = jest.fn(
      async (
        _boardId: string,
        fn: (client: unknown) => Promise<unknown>,
        _pause?: unknown,
        _options?: unknown,
      ) => fn(tx),
    );
    const service = new InvitationsService(
      prisma,
      { run } as never,
      { publish: jest.fn() } as never,
    );

    await service.accept("invitee-1", "invite-1");

    expect(run).toHaveBeenCalledWith(
      "board-1",
      expect.any(Function),
      undefined,
      { lockUserId: "invitee-1" },
    );
    expect(tx.boardMember.update).toHaveBeenCalledWith({
      where: { id: "invite-1" },
      data: { acceptedAt: expect.any(Date) },
    });
  });
});
