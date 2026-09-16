import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, type BoardMember } from "@prisma/client";
import { MembershipGuard } from "./membership.guard";

interface PrismaMock {
  board: { findFirst: jest.Mock };
  boardMember: { findUnique: jest.Mock; deleteMany: jest.Mock };
}

function membership(overrides: Partial<BoardMember> = {}): BoardMember {
  return {
    id: "member-1",
    boardId: "board-1",
    userId: "user-1",
    role: Role.MEMBER,
    expiresAt: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function context(params: Record<string, string>): ExecutionContext {
  const request: Record<string, unknown> = {
    params,
    user: { id: "user-1", email: "u@example.com" },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

/**
 * Role matrix of `MembershipGuard` (TASK-25): the guard sits in front of
 * every board-scoped route, so "MEMBER may mutate, VIEWER may not" is
 * verified here against the required-role metadata.
 */
describe("MembershipGuard", () => {
  // `MembershipGuard` extends a passport mixin; the JWT half is stubbed so
  // the membership/role half can be exercised in isolation.
  const authProto = Object.getPrototypeOf(MembershipGuard.prototype);
  let canActivateSpy: jest.SpyInstance;

  beforeEach(() => {
    canActivateSpy = jest
      .spyOn(authProto, "canActivate")
      .mockResolvedValue(true);
  });

  afterEach(() => {
    canActivateSpy.mockRestore();
  });

  function build(required: Role[] | undefined, prisma: PrismaMock) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(required),
    } as unknown as Reflector;
    return new MembershipGuard(reflector, prisma as never);
  }

  function prismaWith(board: unknown, member: unknown): PrismaMock {
    return {
      board: { findFirst: jest.fn().mockResolvedValue(board) },
      boardMember: {
        findUnique: jest.fn().mockResolvedValue(member),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  it("answers 404 when the board is missing or soft-deleted", async () => {
    const prisma = prismaWith(null, null);
    await expect(
      build(undefined, prisma).canActivate(context({ id: "board-1" })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("answers 403 for a non-member", async () => {
    const prisma = prismaWith({ id: "board-1" }, null);
    await expect(
      build(undefined, prisma).canActivate(context({ id: "board-1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows a MEMBER where the route requires MEMBER", async () => {
    const prisma = prismaWith({ id: "board-1" }, membership());
    const ctx = context({ id: "board-1" });
    await expect(
      build([Role.ADMIN, Role.MEMBER], prisma).canActivate(ctx),
    ).resolves.toBe(true);
    expect(
      (ctx.switchToHttp().getRequest() as { boardMembership?: BoardMember })
        .boardMembership,
    ).toMatchObject({ role: Role.MEMBER });
  });

  it("denies a VIEWER on an ADMIN-only route", async () => {
    const prisma = prismaWith(
      { id: "board-1" },
      membership({ role: Role.VIEWER }),
    );
    await expect(
      build([Role.ADMIN], prisma).canActivate(context({ id: "board-1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies an expired VIEWER and cleans the stale row", async () => {
    const prisma = prismaWith(
      { id: "board-1" },
      membership({
        role: Role.VIEWER,
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    await expect(
      build(undefined, prisma).canActivate(context({ id: "board-1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.boardMember.deleteMany).toHaveBeenCalledWith({
      where: { id: "member-1" },
    });
  });
});
