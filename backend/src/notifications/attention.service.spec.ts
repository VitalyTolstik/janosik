import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { EmailTemplateService } from "@/ops/email-template.service";
import type { NotificationDeliveryService } from "@/mailer/notification-delivery.service";
import type { PrismaService } from "@/common/prisma/prisma.service";
import { AttentionService } from "./attention.service";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

interface RecipientFixture {
  id: string;
  email: string;
  displayName: string | null;
  locale: string | null;
  notifyAttention: boolean;
  disabledAt: Date | null;
}

function recipient(
  id: string,
  overrides: Partial<RecipientFixture> = {},
): RecipientFixture {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    locale: "en",
    notifyAttention: true,
    disabledAt: null,
    ...overrides,
  };
}

function makePrisma(admins: RecipientFixture[]) {
  const rows: Array<Record<string, unknown>> = [];
  const keys = new Set<string>();
  const attentionNotification = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const key = String(data.dedupKey);
      if (keys.has(key)) throw p2002();
      keys.add(key);
      const row = {
        id: `notification-${rows.length + 1}`,
        readAt: null,
        createdAt: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const notificationMail = {
    create: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = {
    notificationMail,
    $transaction: async (work: (tx: PrismaService) => Promise<unknown>) =>
      work(prisma),
    board: { findFirst: jest.fn().mockResolvedValue({ title: "Board" }) },
    boardMember: {
      findMany: jest.fn(
        async (args?: { where?: { userId?: { in?: string[] } } }) => {
          const ids = args?.where?.userId?.in;
          return admins
            .filter((user) => ids === undefined || ids.includes(user.id))
            .map((user) => ({ user }));
        },
      ),
    },
    user: { findFirst: jest.fn().mockResolvedValue(admins[0] ?? null) },
    card: {
      findFirst: jest.fn().mockResolvedValue({ title: "Card" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    comment: { findFirst: jest.fn().mockResolvedValue({ id: "comment-1" }) },
    agentSession: { findUnique: jest.fn().mockResolvedValue(null) },
    attentionNotification,
  } as unknown as PrismaService & {
    attentionNotification: typeof attentionNotification;
  };
  return { prisma, rows, attentionNotification };
}

function makeService(prisma: PrismaService) {
  const delivery = {
    kick: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationDeliveryService;
  const templates = {
    attentionEmail: jest.fn().mockResolvedValue({
      subject: "Attention",
      text: "Approval needed\n\nBody",
      html: "<p>Approval needed</p>",
    }),
  } as unknown as EmailTemplateService & { attentionEmail: jest.Mock };
  return {
    service: new AttentionService(prisma, delivery, templates),
    mail: prisma.notificationMail,
    templates,
  };
}

const approval = {
  id: "approval-1",
  boardId: "board-1",
  actionType: "DELETE_CARD",
  summary: "Apply DELETE_CARD (1 command)",
  risk: "medium",
  expiresAt: new Date(Date.now() + 3_600_000),
};

describe("AttentionService", () => {
  it("creates one in-app row and one letter per admin", async () => {
    const { prisma, rows } = makePrisma([
      recipient("admin-1"),
      recipient("admin-2"),
    ]);
    const { service, mail } = makeService(prisma);

    await service.notifyApprovalRequested(approval);
    await flush();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.type)).toEqual([
      "approval.requested",
      "approval.requested",
    ]);
    expect(mail.create).toHaveBeenCalledTimes(2);
    expect(mail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.objectContaining({ to: "admin-1@example.com" }),
        }),
      }),
    );
  });

  it("deduplicates a repeated event: one row and one letter, no P2002 leak", async () => {
    const { prisma, rows } = makePrisma([recipient("admin-1")]);
    const { service, mail } = makeService(prisma);

    await service.notifyApprovalRequested(approval);
    await service.notifyApprovalRequested(approval);
    await flush();

    expect(rows).toHaveLength(1);
    expect(mail.create).toHaveBeenCalledTimes(1);
  });

  it("notifies the requester and the cancelling user once", async () => {
    const { prisma, rows } = makePrisma([
      recipient("requester"),
      recipient("canceller"),
    ]);
    const { service, mail } = makeService(prisma);

    await service.notifyApprovalCancelled(
      {
        ...approval,
        requestedBy: "requester",
      },
      "canceller",
    );
    await service.notifyApprovalCancelled(
      {
        ...approval,
        requestedBy: "requester",
      },
      "canceller",
    );
    await flush();

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.userId))).toEqual(
      new Set(["requester", "canceller"]),
    );
    expect(rows[0]!.type).toBe("approval.cancelled");
    expect(mail.create).toHaveBeenCalledTimes(2);
  });

  it("notifies the requester and decision actor once when consumed", async () => {
    const { prisma, rows } = makePrisma([
      recipient("requester"),
      recipient("decider"),
    ]);
    const { service, mail } = makeService(prisma);

    await service.notifyApprovalConsumed({
      ...approval,
      requestedBy: "requester",
      decidedBy: "decider",
      runId: "run-1",
    });
    await service.notifyApprovalConsumed({
      ...approval,
      requestedBy: "requester",
      decidedBy: "decider",
      runId: "run-1",
    });
    await flush();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.type).toBe("approval.consumed");
    expect((rows[0]!.data as { runId: string }).runId).toBe("run-1");
    expect(mail.create).toHaveBeenCalledTimes(2);
  });

  it("notifies only the token owner when a key is revoked, once", async () => {
    const { prisma, rows } = makePrisma([recipient("owner")]);
    const { service, mail } = makeService(prisma);

    await service.notifyTokenRevoked({
      userId: "owner",
      tokenId: "token-1",
      tokenName: "CI",
      reason: "revoked",
    });
    await service.notifyTokenRevoked({
      userId: "owner",
      tokenId: "token-1",
      tokenName: "CI",
      reason: "revoked",
    });
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        type: "token.revoked",
        userId: "owner",
        boardId: null,
      }),
    );
    expect(mail.create).toHaveBeenCalledTimes(1);
    expect(mail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: expect.objectContaining({ to: "owner@example.com" }),
        }),
      }),
    );
  });

  it("keeps the in-app row but sends no letter when the admin opted out", async () => {
    const { prisma, rows } = makePrisma([
      recipient("admin-1", { notifyAttention: false }),
    ]);
    const { service, mail } = makeService(prisma);

    await service.notifyApprovalRequested(approval);
    await flush();

    expect(rows).toHaveLength(1);
    expect(mail.create).not.toHaveBeenCalled();
  });

  it("drops disabled accounts before writing an attention row", async () => {
    const { prisma, rows } = makePrisma([
      recipient("admin-1", { disabledAt: new Date() }),
    ]);
    const { service, mail } = makeService(prisma);

    await service.notifyApprovalRequested(approval);
    await flush();

    expect(rows).toHaveLength(0);
    expect(mail.create).not.toHaveBeenCalled();
  });

  it("deduplicates quota warnings for one account and day", async () => {
    const { prisma, rows } = makePrisma([recipient("owner")]);
    const { service, mail } = makeService(prisma);

    await service.notifyQuotaExceeded({
      userId: "owner",
      limit: 2,
      current: 3,
      resource: "board",
    });
    await service.notifyQuotaExceeded({
      userId: "owner",
      limit: 2,
      current: 3,
      resource: "board",
    });
    await flush();

    expect(rows).toHaveLength(1);
    expect(mail.create).toHaveBeenCalledTimes(1);
  });

  it("converts a 409 limit_exceeded envelope into a quota event", async () => {
    const { prisma, rows } = makePrisma([recipient("owner")]);
    const { service } = makeService(prisma);
    const error = new ConflictException({
      message: "Board limit exceeded",
      code: "limit_exceeded",
      limit: 2,
      current: 2,
    });

    await service.notifyLimitExceeded("owner", error, { resource: "board" });
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        type: "quota.exceeded",
        userId: "owner",
        boardId: null,
      }),
    );
  });

  it("notifies each mentioned member once and never the author (TASK-177.12)", async () => {
    const { prisma, rows } = makePrisma([
      recipient("author"),
      recipient("mentioned-1"),
      recipient("mentioned-2"),
    ]);
    const { service, mail } = makeService(prisma);
    const input = {
      boardId: "board-1",
      cardId: "card-1",
      commentId: "comment-1",
      authorId: "author",
      actorName: "Alice",
      mentionedUserIds: ["mentioned-1", "mentioned-2", "author", "mentioned-1"],
      excerpt: "Ping @Bob",
    };

    await service.notifyCommentMention(input);
    await service.notifyCommentMention(input);
    await flush();

    expect(rows.map((row) => row.userId).sort()).toEqual([
      "mentioned-1",
      "mentioned-2",
    ]);
    expect(rows.every((row) => row.type === "comment.mention")).toBe(true);
    expect(rows.every((row) => row.commentId === "comment-1")).toBe(true);
    expect(rows[0]!.body).toContain("Ping @Bob");
    expect((rows[0]!.data as { authorName: string }).authorName).toBe("Alice");
    expect(mail.create).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect a mention row after the comment is deleted", async () => {
    const { prisma, rows } = makePrisma([recipient("mentioned-1")]);
    const { service } = makeService(prisma);
    (prisma.comment.findFirst as jest.Mock).mockResolvedValue(null);

    await service.notifyCommentMention({
      boardId: "board-1",
      cardId: "card-1",
      commentId: "comment-deleted",
      authorId: "author",
      actorName: "Alice",
      mentionedUserIds: ["mentioned-1"],
      excerpt: "gone",
    });
    await flush();

    expect(rows).toHaveLength(0);
  });

  it("ignores other 409 codes and never throws from a failed fan-out", async () => {
    const { prisma } = makePrisma([recipient("owner")]);
    (prisma.attentionNotification.create as jest.Mock).mockRejectedValue(
      new Error("db down"),
    );
    const { service } = makeService(prisma);

    await expect(
      service.notifyLimitExceeded(
        "owner",
        new ConflictException({ code: "wip" }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.notifyApprovalRequested(approval),
    ).resolves.toBeUndefined();
  });
});
