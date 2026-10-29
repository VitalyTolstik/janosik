import type { PrismaService } from "@/common/prisma/prisma.service";
import type { MailQueueService } from "@/mailer/mail-queue.service";
import type { EmailTemplateService } from "./email-template.service";
import type { OpsSettingsService } from "./ops-settings.service";
import { CommsSchedulerService } from "./comms-scheduler.service";

function prismaMock(): PrismaService {
  return {
    board: { findMany: jest.fn().mockResolvedValue([]) },
    boardMember: { findMany: jest.fn().mockResolvedValue([]) },
    card: { findMany: jest.fn().mockResolvedValue([]) },
    reminderSent: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;
}

const mailMock = {
  enqueue: jest.fn().mockResolvedValue(undefined),
} as unknown as MailQueueService & { enqueue: jest.Mock };

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
  beforeEach(() => jest.resetAllMocks());

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
      mailMock,
      templatesMock,
    );

    const result = await service.run("digest");
    expect(result.sent).toBe(1);
    expect(mailMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@example.com" }),
    );
  });

  it("emails one reminder per assignee, skipping disabled users", async () => {
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
      mailMock,
      templatesMock,
    );

    const result = await service.run("due-reminders");
    expect(result.sent).toBe(1);
    expect(mailMock.enqueue).toHaveBeenCalledTimes(1);
    expect(prisma.reminderSent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ cardId: "c1", userId: "u1" })],
      }),
    );
  });

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
      mailMock,
      templatesMock,
    );

    const result = await service.run("due-reminders");
    expect(result.sent).toBe(0);
    expect(mailMock.enqueue).not.toHaveBeenCalled();
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
      mailMock,
      templatesMock,
    );

    const result = await service.run("due-reminders");
    expect(result.sent).toBe(0);
    expect(mailMock.enqueue).not.toHaveBeenCalled();
    expect(prisma.reminderSent.createMany).not.toHaveBeenCalled();
  });
});
