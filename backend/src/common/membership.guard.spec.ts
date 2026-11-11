import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, type BoardMember } from "@prisma/client";
import {
  isReadOnlyControlOperation,
  MembershipGuard,
} from "./membership.guard";

interface PrismaMock {
  board: { findFirst: jest.Mock };
  boardMember: { findUnique: jest.Mock; deleteMany: jest.Mock };
  agentSession: { findFirst: jest.Mock };
}

function membership(overrides: Partial<BoardMember> = {}): BoardMember {
  return {
    id: "member-1",
    boardId: "board-1",
    userId: "user-1",
    role: Role.MEMBER,
    expiresAt: null,
    acceptedAt: new Date(0),
    invitedById: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function context(
  params: Record<string, string>,
  overrides: Record<string, unknown> = {},
): ExecutionContext {
  const request: Record<string, unknown> = {
    params,
    user: { id: "user-1", email: "u@example.com" },
    ...overrides,
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
    return new MembershipGuard(reflector, prisma as never, {} as never);
  }

  function prismaWith(board: unknown, member: unknown): PrismaMock {
    return {
      board: { findFirst: jest.fn().mockResolvedValue(board) },
      boardMember: {
        findUnique: jest.fn().mockResolvedValue(member),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      agentSession: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  it("answers 404 when the board is missing or soft-deleted", async () => {
    const prisma = prismaWith(null, null);
    await expect(
      build(undefined, prisma).canActivate(context({ id: "board-1" })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("only allows the explicit read-only control POST routes", () => {
    for (const path of [
      "/api/v1/boards/b/runs/r/revert/preview",
      "/api/v1/boards/b/agent-sessions",
      "/api/v1/boards/b/agent-sessions/s/heartbeat",
      "/api/v1/boards/b/agent-sessions/s/end",
    ])
      expect(isReadOnlyControlOperation("POST", path)).toBe(true);
    for (const path of [
      "/api/v1/boards/b/runs/r/revert",
      "/api/v1/boards/b/commands",
      "/api/v1/boards/b/agent-sessions/s/pause",
      "/api/v1/boards/b/agent-sessions/s/end/extra",
    ])
      expect(isReadOnlyControlOperation("POST", path)).toBe(false);
    expect(
      isReadOnlyControlOperation("DELETE", "/api/v1/boards/b/agent-sessions"),
    ).toBe(false);
  });

  it("only records an owned lifecycle session for rate limiting", async () => {
    const prisma = prismaWith(
      { id: "board-1", agentPolicy: null, agentsPausedAt: null },
      membership(),
    );
    const request = {
      method: "POST",
      originalUrl: "/api/v1/boards/board-1/agent-sessions/session-1/heartbeat",
      auth: { via: "pat", apiTokenId: "token-1" },
    };
    const ctx = context({ id: "board-1", sessionId: "session-1" }, request);
    await build(undefined, prisma).canActivate(ctx);
    expect(prisma.agentSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        boardId: "board-1",
        userId: "user-1",
        apiTokenId: "token-1",
      },
      select: { id: true },
    });
    expect(ctx.switchToHttp().getRequest()).not.toHaveProperty(
      "rateLimitSessionId",
    );
    prisma.agentSession.findFirst.mockResolvedValue({ id: "session-1" });
    await build(undefined, prisma).canActivate(ctx);
    expect(ctx.switchToHttp().getRequest()).toHaveProperty(
      "rateLimitSessionId",
      "session-1",
    );
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

  it("refuses a paused PAT write at the guard boundary", async () => {
    const prisma = prismaWith(
      { id: "board-1", agentPolicy: null, agentsPausedAt: null },
      membership(),
    );
    const paused = {
      via: "pat" as const,
      apiTokenId: "token-1",
      tokenIdentity: {
        id: "token-1",
        name: "agent",
        scopePreset: "worker" as const,
        trustedCi: false,
        effectiveTokenScope: "worker" as const,
        boardId: null,
        readOnly: false,
        rateLimitPerMinute: null,
        individualPausedAt: 123,
        stopAllPausedAt: null,
        paused: true,
      },
    };
    await expect(
      build(undefined, prisma).canActivate(
        context(
          { id: "board-1" },
          {
            method: "POST",
            originalUrl: "/api/v1/boards/board-1/commands",
            auth: paused,
          },
        ),
      ),
    ).rejects.toMatchObject({
      response: { code: "agent_paused", pauseScope: "token" },
    });
  });

  it("refuses a board-paused PAT write but keeps heartbeat open", async () => {
    const boardPausedAt = new Date("2026-11-10T10:00:00Z");
    const prisma = prismaWith(
      { id: "board-1", agentPolicy: null, agentsPausedAt: boardPausedAt },
      membership(),
    );
    const pat = {
      via: "pat" as const,
      apiTokenId: "token-1",
      tokenIdentity: {
        id: "token-1",
        name: "agent",
        scopePreset: "worker" as const,
        trustedCi: false,
        effectiveTokenScope: "worker" as const,
        boardId: null,
        readOnly: false,
        rateLimitPerMinute: null,
        individualPausedAt: null,
        stopAllPausedAt: null,
        paused: false,
      },
    };
    await expect(
      build(undefined, prisma).canActivate(
        context(
          { id: "board-1" },
          {
            method: "POST",
            originalUrl: "/api/v1/boards/board-1/commands",
            auth: pat,
          },
        ),
      ),
    ).rejects.toMatchObject({
      response: { code: "agent_paused", pauseScope: "board" },
    });

    await expect(
      build(undefined, prisma).canActivate(
        context(
          { id: "board-1", sessionId: "session-1" },
          {
            method: "POST",
            originalUrl:
              "/api/v1/boards/board-1/agent-sessions/session-1/heartbeat",
            auth: pat,
          },
        ),
      ),
    ).resolves.toBe(true);
  });
});
