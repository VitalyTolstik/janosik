import type { PrismaService } from "@/common/prisma/prisma.service";
import type { NotificationDeliveryService } from "@/mailer/notification-delivery.service";
import type { EmailTemplateService } from "./email-template.service";
import type { OpsSettingsService } from "./ops-settings.service";
import { CommsSchedulerService } from "./comms-scheduler.service";

function prismaMock(): PrismaService {
  const prisma = {
    $transaction: async (work: (tx: PrismaService) => Promise<unknown>) =>
      work(prisma),
    notificationMail: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    board: { findMany: jest.fn().mockResolvedValue([]) },
    boardMember: { findMany: jest.fn().mockResolvedValue([]) },
    card: { findMany: jest.fn().mockResolvedValue([]) },
    reminderSent: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({
        count: data.length,
      })),
    },
    attentionNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => ({
          count: where.id.in.length,
        }),
      ),
    },
  } as unknown as PrismaService;
  return prisma;
}

const delivery = {
  kick: jest.fn().mockResolvedValue(undefined),
} as unknown as NotificationDeliveryService;

const templatesMock = {
  digestEmail: jest.fn().mockResolvedValue({
    subject: "Digest",
    text: "Digest",
    html: "<p>Digest</p>",
  }),
  dueReminderEmail: jest.fn().mockResolvedValue({
    subject: "Reminder",
    text: "Reminder",
    html: "<p>Reminder</p>",
  }),
} as unknown as EmailTemplateService;

describe("CommsSchedulerService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("emails a digest to each opted-in member", async () => {
    const prisma = prismaMock();
    (prisma.board.findMany as jest.Mock).mockResolvedValue([
      {
        id: "b1",
        title: "Board",
        members: [
          {
            user: {
              id: "u1",
              email: "a@example.com",
              notifyDigest: true,
              disabledAt: null,
            },
          },
          {
            user: {
              id: "u2",
              email: "b@example.com",
              notifyDigest: false,
              disabledAt: null,
            },
          },
        ],
        _count: { activity: 3 },
      },
    ]);
    const ops = {
      digestIntervalHours: jest.fn().mockResolvedValue(24),
      reminderLeadHours: jest.fn().mockResolvedValue(0),
    } as unknown as OpsSettingsService;
    const service = new CommsSchedulerService(
      prisma,
      ops,
      delivery,
      templatesMock,
    );

    const result = await service.run("digest");
    expect(result.sent).toBe(1);
    expect(prisma.notificationMail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          message: expect.objectContaining({ to: "a@example.com" }),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("includes undigested attention categories and reserves them for delivery", async () => {
    const prisma = prismaMock();
    (prisma.attentionNotification.findMany as jest.Mock).mockResolvedValue([
      { id: "n1", userId: "u1", boardId: "b1", type: "approval.requested" },
      { id: "n2", userId: "u1", boardId: "b1", type: "approval.requested" },
      { id: "n3", userId: "u1", boardId: "b1", type: "claim.expired" },
      { id: "n4", userId: "u2", boardId: "b1", type: "agent.blocked" },
      {
        id: "n5",
        userId: "u1",
        boardId: "b1",
        type: "approval.consumed",
      },
      {
        id: "n6",
        userId: "u1",
        boardId: "b1",
        type: "approval.cancelled",
      },
    ]);
    (prisma.board.findMany as jest.Mock).mockResolvedValue([
      {
        id: "b1",
        title: "Board",
        members: [
          {
            user: {
              id: "u1",
              email: "a@example.com",
              notifyDigest: true,
              locale: "ru",
              disabledAt: null,
            },
          },
          {
            user: {
              id: "u2",
              email: "b@example.com",
              notifyDigest: true,
              locale: "en",
              disabledAt: null,
            },
          },
        ],
        // No content changes: the digest is driven by attention alone.
        _count: { activity: 0 },
      },
    ]);
    const ops = {
      digestIntervalHours: jest.fn().mockResolvedValue(24),
      reminderLeadHours: jest.fn().mockResolvedValue(0),
    } as unknown as OpsSettingsService;
    const service = new CommsSchedulerService(
      prisma,
      ops,
      delivery,
      templatesMock,
    );

    const result = await service.run("digest");

    expect(result.sent).toBe(2);
    expect(templatesMock.digestEmail).toHaveBeenCalledWith(
      "Board",
      0,
      24,
      "ru",
      [
        { type: "approval.requested", count: 2 },
        { type: "claim.expired", count: 1 },
        { type: "approval.consumed", count: 1 },
        { type: "approval.cancelled", count: 1 },
      ],
    );
    expect(templatesMock.digestEmail).toHaveBeenCalledWith(
      "Board",
      0,
      24,
      "en",
      [{ type: "agent.blocked", count: 1 }],
    );
    expect(prisma.attentionNotification.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.attentionNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          digestedAt: null,
          digestMailId: null,
        }),
        data: { digestMailId: expect.any(String) },
      }),
    );
  });

  it("does not leak another board's attention into a digest", async () => {
    const prisma = prismaMock();
    (prisma.attentionNotification.findMany as jest.Mock).mockResolvedValue([
      { id: "n1", userId: "u1", boardId: "b2", type: "agent.blocked" },
    ]);
    (prisma.board.findMany as jest.Mock).mockResolvedValue([
      {
        id: "b1",
        title: "Board one",
        members: [
          {
            user: {
              id: "u1",
              email: "a@example.com",
              notifyDigest: true,
              locale: "en",
              disabledAt: null,
            },
          },
        ],
        _count: { activity: 1 },
      },
    ]);
    const ops = {
      digestIntervalHours: jest.fn().mockResolvedValue(24),
      reminderLeadHours: jest.fn().mockResolvedValue(0),
    } as unknown as OpsSettingsService;
    const service = new CommsSchedulerService(
      prisma,
      ops,
      delivery,
      templatesMock,
    );

    await service.run("digest");

    expect(templatesMock.digestEmail).toHaveBeenCalledWith(
      "Board one",
      1,
      24,
      "en",
      [],
    );
  });

  it.each(["en", "ru"])(
    "emails one %s reminder per assignee, skipping disabled users",
    async (locale) => {
      const prisma = prismaMock();
      const due = new Date(Date.now() + 3_600_000);
      (prisma.boardMember.findMany as jest.Mock).mockResolvedValue([
        { boardId: "b1", userId: "u1" },
        { boardId: "b1", userId: "u2" },
      ]);
      (prisma.card.findMany as jest.Mock).mockResolvedValue([
        {
          id: "c1",
          title: "Task",
          dueDate: due,
          column: { boardId: "b1", board: { title: "Board" } },
          assignee: {
            id: "u1",
            email: "a@example.com",
            locale,
            notifyDigest: true,
            disabledAt: null,
          },
        },
        {
          id: "c2",
          title: "Task 2",
          dueDate: due,
          column: { boardId: "b1", board: { title: "Board" } },
          assignee: {
            id: "u2",
            email: "b@example.com",
            notifyDigest: true,
            disabledAt: new Date(),
          },
        },
      ]);
      const ops = {
        digestIntervalHours: jest.fn().mockResolvedValue(0),
        reminderLeadHours: jest.fn().mockResolvedValue(48),
      } as unknown as OpsSettingsService;
      const service = new CommsSchedulerService(
        prisma,
        ops,
        delivery,
        templatesMock,
      );

      const result = await service.run("due-reminders");
      expect(result.sent).toBe(1);
      expect(prisma.notificationMail.create).toHaveBeenCalledTimes(1);
      expect(templatesMock.dueReminderEmail).toHaveBeenCalledWith(
        1,
        expect.stringContaining(locale === "ru" ? "— срок " : "— due "),
        locale,
      );
      expect(prisma.reminderSent.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ cardId: "c1", userId: "u1" })],
        }),
      );
    },
  );

  it("does not re-remind an already-notified (card,user,dueDate) (TASK-83)", async () => {
    const prisma = prismaMock();
    const due = new Date(Date.now() + 3_600_000);
    (prisma.boardMember.findMany as jest.Mock).mockResolvedValue([
      { boardId: "b1", userId: "u1" },
    ]);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      {
        id: "c1",
        title: "Task",
        dueDate: due,
        column: { boardId: "b1", board: { title: "Board" } },
        assignee: {
          id: "u1",
          email: "a@example.com",
          notifyDigest: true,
          disabledAt: null,
        },
      },
    ]);
    (prisma.reminderSent.findMany as jest.Mock).mockResolvedValue([
      { cardId: "c1", dueDate: due },
    ]);
    const ops = {
      digestIntervalHours: jest.fn().mockResolvedValue(0),
      reminderLeadHours: jest.fn().mockResolvedValue(48),
    } as unknown as OpsSettingsService;
    const service = new CommsSchedulerService(
      prisma,
      ops,
      delivery,
      templatesMock,
    );

    const result = await service.run("due-reminders");
    expect(result.sent).toBe(0);
    expect(prisma.notificationMail.create).not.toHaveBeenCalled();
  });

  it("never reminds an assignee who is not an active member (B5)", async () => {
    const prisma = prismaMock();
    const due = new Date(Date.now() + 3_600_000);
    // The ex-member is still named on the card, but has no active row.
    (prisma.boardMember.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      {
        id: "c1",
        title: "Task of a removed member",
        dueDate: due,
        column: { boardId: "b1", board: { title: "Board" } },
        assignee: {
          id: "u9",
          email: "gone@example.com",
          notifyDigest: true,
          disabledAt: null,
        },
      },
    ]);
    const ops = {
      digestIntervalHours: jest.fn().mockResolvedValue(0),
      reminderLeadHours: jest.fn().mockResolvedValue(48),
    } as unknown as OpsSettingsService;
    const service = new CommsSchedulerService(
      prisma,
      ops,
      delivery,
      templatesMock,
    );

    const result = await service.run("due-reminders");
    expect(result.sent).toBe(0);
    expect(prisma.notificationMail.create).not.toHaveBeenCalled();
    expect(prisma.reminderSent.createMany).not.toHaveBeenCalled();
  });
});
