import type { NextFunction, Request, Response } from "express";
import { Role, type Prisma } from "@prisma/client";
import { BoardWriteService } from "./board-write.service";
import { requestContext, setBoardWriteContext } from "./request-context";
import type { PrismaService } from "./prisma/prisma.service";
import { BoardsService } from "@/boards/boards.service";
import { InvitationsService } from "@/invitations/invitations.service";
import type { RealtimeService } from "@/realtime/realtime.service";
import type { AttentionService } from "@/notifications/attention.service";
import type { SecurityAuditService } from "@/common/security-audit/security-audit.service";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestContext(
      { headers: {} } as Request,
      { setHeader: jest.fn() } as unknown as Response,
      (() => {
        void fn().then(resolve, reject);
      }) as NextFunction,
    );
  });
}

describe("board write membership revalidation", () => {
  it.each(["removed", "reinvited", "demoted"] as const)(
    "refuses a queued write after membership was %s",
    async (change) => {
      let member: {
        id: string;
        role: Role;
        acceptedAt: Date;
        expiresAt: Date | null;
      } | null = {
        id: "original",
        role: Role.MEMBER,
        acceptedAt: new Date(),
        expiresAt: null,
      };
      const lockAcquired = deferred();
      const release = deferred();
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        boardMember: { findUnique: jest.fn(async () => member) },
      };
      const prisma = {
        $transaction: async <T>(
          fn: (client: Prisma.TransactionClient) => Promise<T>,
        ) => fn(tx as unknown as Prisma.TransactionClient),
      };
      const writer = new BoardWriteService(prisma as unknown as PrismaService);
      const blocker = writer.run("board", async () => {
        lockAcquired.resolve();
        await release.promise;
      });
      await lockAcquired.promise;
      const body = jest.fn(async () => "written");
      const pending = inRequest(() => {
        setBoardWriteContext("board", "user", "original", Role.MEMBER);
        return writer.run("board", body);
      });
      const rejected = expect(pending).rejects.toThrow(
        "Board membership or role changed",
      );
      if (change === "removed") member = null;
      if (change === "reinvited")
        member = {
          id: "new-membership",
          role: Role.MEMBER,
          acceptedAt: new Date(),
          expiresAt: null,
        };
      if (change === "demoted")
        member = {
          id: "original",
          role: Role.VIEWER,
          acceptedAt: new Date(),
          expiresAt: null,
        };
      release.resolve();
      await blocker;
      await rejected;
      expect(body).not.toHaveBeenCalled();
    },
  );
});

describe("last administrator revalidation", () => {
  it.each(["demote", "remove"] as const)(
    "checks the member's current ADMIN role under the lock before %s",
    async (operation) => {
      const stale = {
        id: "member",
        userId: "target",
        role: Role.MEMBER,
        acceptedAt: new Date(),
        expiresAt: null,
        user: { email: "member@example.com" },
      };
      const current = { ...stale, role: Role.ADMIN };
      const update = jest.fn();
      const remove = jest.fn();
      const tx = {
        boardMember: {
          findUnique: jest.fn().mockResolvedValue(current),
          count: jest.fn().mockResolvedValue(0),
          update,
          delete: remove,
        },
      };
      const prisma = {
        boardMember: { findUnique: jest.fn().mockResolvedValue(stale) },
      };
      const writer = {
        run: async <T>(
          _board: string,
          fn: (client: Prisma.TransactionClient) => Promise<T>,
        ) => fn(tx as unknown as Prisma.TransactionClient),
      };
      const boards = new BoardsService(
        prisma as unknown as PrismaService,
        writer as unknown as BoardWriteService,
        { publish: jest.fn() } as unknown as RealtimeService,
        {} as AttentionService,
        {} as SecurityAuditService,
      );
      const call =
        operation === "demote"
          ? boards.updateMember("board", "actor", "target", {
              role: Role.VIEWER,
            })
          : boards.removeMember("board", "actor", "target");
      await expect(call).rejects.toThrow("last ADMIN");
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );
});

describe("concurrent invitation decisions", () => {
  it("does not let a queued decline delete a membership already accepted", async () => {
    const invitation = {
      id: "invite",
      boardId: "board",
      userId: "user",
      role: Role.MEMBER,
      expiresAt: null,
      acceptedAt: null as Date | null,
    };
    let current: typeof invitation | null = { ...invitation };
    const release = deferred();
    const acquired = deferred();
    const acceptQueued = deferred();
    const declineQueued = deferred();
    let queued = 0;
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      boardMember: {
        findFirst: jest.fn(async () =>
          current?.acceptedAt === null ? current : null,
        ),
        update: jest.fn(async () => {
          current = { ...invitation, acceptedAt: new Date() };
        }),
        delete: jest.fn(async () => {
          current = null;
        }),
      },
      activity: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ emailVerifiedAt: new Date() }),
      },
      boardMember: { findFirst: jest.fn(async () => ({ ...invitation })) },
      $transaction: async <T>(
        fn: (client: Prisma.TransactionClient) => Promise<T>,
      ) => fn(tx as unknown as Prisma.TransactionClient),
    };
    const writer = new BoardWriteService(prisma as unknown as PrismaService);
    const blocker = writer.run("board", async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    const observedWriter = {
      run: <T>(
        board: string,
        fn: (client: Prisma.TransactionClient) => Promise<T>,
      ) => {
        const result = writer.run(board, fn);
        queued += 1;
        if (queued === 1) acceptQueued.resolve();
        if (queued === 2) declineQueued.resolve();
        return result;
      },
    };
    const service = new InvitationsService(
      prisma as unknown as PrismaService,
      observedWriter as unknown as BoardWriteService,
      { publish: jest.fn() } as unknown as RealtimeService,
    );
    const accept = service.accept("user", "invite");
    await acceptQueued.promise;
    const decline = service.decline("user", "invite");
    const results = Promise.allSettled([accept, decline]);
    await declineQueued.promise;
    release.resolve();
    await blocker;
    const [accepted, declined] = await results;
    expect(accepted.status).toBe("fulfilled");
    expect(declined.status).toBe("rejected");
    expect(tx.boardMember.delete).not.toHaveBeenCalled();
    expect(current).toMatchObject({
      id: "invite",
      acceptedAt: expect.any(Date),
    });
  });
});
