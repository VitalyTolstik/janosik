import { randomUUID } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { Queue, Worker } from "bullmq";
import { PrismaService } from "@/common/prisma/prisma.service";
import { MailerService } from "@/mailer/mailer.service";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  NotificationDeliveryService,
  notificationMailId,
  type NotificationMailJob,
} from "@/mailer/notification-delivery.service";
import { AttentionService } from "@/notifications/attention.service";
import { CommsService } from "@/admin/comms.service";
import { BroadcastProcessor } from "@/ops/broadcast.processor";
import { BroadcastQueueService } from "@/ops/broadcast-queue.service";
import { CommsSchedulerService } from "@/ops/comms-scheduler.service";
import { EmailTemplateService } from "@/ops/email-template.service";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import { wipeAll } from "./support/wipe";

/** An SMTP endpoint that can reject RCPT, then accept the retried message. */
function smtpEndpoint() {
  const accepted: Array<{ to: string; data: string }> = [];
  const rejecting = new Map<string, number>();
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost ready\r\n");
    let buffer = "";
    let data: string | undefined;
    let to = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line === ".") {
            accepted.push({ to, data });
            data = undefined;
            socket.write("250 queued\r\n");
          } else {
            data += line + "\r\n";
          }
        } else if (/^(EHLO|HELO) /i.test(line)) {
          socket.write("250 localhost\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          to = /<([^>]+)>/.exec(line)?.[1] ?? "";
          const rejection = rejecting.get(to);
          socket.write(
            rejection
              ? `${rejection} mailbox unavailable\r\n`
              : "250 recipient accepted\r\n",
          );
        } else if (line === "DATA") {
          data = "";
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  return {
    accepted,
    rejecting,
    async open() {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      return (server.address() as AddressInfo).port;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      ),
  };
}

const EN = "en@example.com";
const RU = "ru@example.com";

async function eventually(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for notification work");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("durable notification delivery (e2e)", () => {
  const prisma = new PrismaService();
  const mailer = new MailerService();
  const delivery = new NotificationDeliveryService(prisma, mailer);
  const templates = new EmailTemplateService(prisma);
  const smtp = smtpEndpoint();

  beforeAll(async () => {
    await prisma.$connect();
    const port = await smtp.open();
    mailer.reconfigure(
      { host: "127.0.0.1", port, secure: false, username: "", password: "" },
      "test@example.com",
    );
  });

  beforeEach(async () => {
    await wipeAll(prisma);
    smtp.accepted.length = 0;
    smtp.rejecting.clear();
  });

  afterAll(async () => {
    await delivery.onModuleDestroy();
    await smtp.close();
    await prisma.$disconnect();
  });

  async function makeBoard() {
    const [en, ru] = await Promise.all([
      prisma.user.create({ data: { email: EN, locale: "en" } }),
      prisma.user.create({ data: { email: RU, locale: "ru" } }),
    ]);
    const board = await prisma.board.create({
      data: {
        title: "Delivery board",
        members: {
          create: [en, ru].map((user) => ({
            userId: user.id,
            role: "ADMIN",
            acceptedAt: new Date(),
          })),
        },
        columns: { create: { id: "delivery-col", title: "Todo", position: 0 } },
      },
    });
    return { board, en, ru };
  }

  it("keeps attention and digest bookmarks empty through real SMTP failures and retries each failed letter once", async () => {
    const { board, en, ru } = await makeBoard();
    await prisma.opsSettings.create({
      data: { id: "singleton", digestIntervalHours: 24 },
    });
    const ops = new OpsSettingsService(prisma);
    const scheduler = new CommsSchedulerService(
      prisma,
      ops,
      delivery,
      templates,
    );
    const attention = new AttentionService(prisma, delivery, templates);
    const approval = {
      id: "failure-approval",
      boardId: board.id,
      summary: "Approval test",
      actionType: "DELETE_CARD",
      risk: "medium",
      expiresAt: new Date(Date.now() + 3_600_000),
    };

    smtp.rejecting.set(EN, 451);
    await attention.notifyApprovalRequested(approval);
    await delivery.kick();

    const inbox = (userId: string) =>
      prisma.attentionNotification.findFirstOrThrow({ where: { userId } });
    expect((await inbox(en.id)).emailedAt).toBeNull();
    expect((await inbox(ru.id)).emailedAt).toBeInstanceOf(Date);
    expect(
      await prisma.notificationMail.count({
        where: { kind: "attention", attempts: 1, finishedAt: null },
      }),
    ).toBe(1);

    expect(await scheduler.run("digest", "test-digest")).toEqual({ sent: 2 });
    await delivery.kick();
    expect((await inbox(en.id)).digestedAt).toBeNull();
    expect((await inbox(ru.id)).digestedAt).toBeInstanceOf(Date);
    expect(await scheduler.run("digest", "test-digest")).toEqual({ sent: 0 });
    await attention.notifyApprovalRequested(approval);
    expect(await prisma.notificationMail.count()).toBe(4);

    smtp.rejecting.delete(EN);
    // Make backoff elapse without sleeping through it.
    await prisma.notificationMail.updateMany({
      where: { finishedAt: null },
      data: { nextAttemptAt: new Date(0) },
    });
    // Two processes try to pick up the same rows after recovery.
    const restarted = new NotificationDeliveryService(prisma, mailer);
    await Promise.all([delivery.kick(), restarted.kick()]);
    await restarted.onModuleDestroy();
    expect((await inbox(en.id)).emailedAt).toBeInstanceOf(Date);
    expect((await inbox(en.id)).digestedAt).toBeInstanceOf(Date);
    expect((await inbox(en.id)).digestMailId).toBeNull();
    expect(smtp.accepted.filter((message) => message.to === EN)).toHaveLength(
      2,
    );
    expect(smtp.accepted.filter((message) => message.to === RU)).toHaveLength(
      2,
    );
    await delivery.kick();
    expect(smtp.accepted).toHaveLength(4);
  });

  it("delivers the EN and RU due-reminder templates to their respective assignees", async () => {
    const { en, ru } = await makeBoard();
    await prisma.opsSettings.create({
      data: { id: "singleton", reminderLeadHours: 4 },
    });
    const dueDate = new Date(Date.now() + 3_600_000);
    await prisma.card.createMany({
      data: [en, ru].map((user, position) => ({
        id: `card-${position}`,
        title: "Due test",
        columnId: "delivery-col",
        assigneeId: user.id,
        dueDate,
        position,
      })),
    });
    const scheduler = new CommsSchedulerService(
      prisma,
      new OpsSettingsService(prisma),
      delivery,
      templates,
    );
    expect(await scheduler.run("due-reminders")).toEqual({ sent: 2 });
    await delivery.kick();
    expect(smtp.accepted.find((letter) => letter.to === EN)?.data).toContain(
      "1 task due soon",
    );
    // Check the actual rendered Russian text before MIME's transfer encoding.
    const staged = await prisma.reminderSent.count();
    expect(staged).toBe(2);
    const russian = smtp.accepted.find((letter) => letter.to === RU);
    expect(russian?.data).toMatch(/Subject: =\?UTF-8\?/);
    const encoded = /Subject:\s*=\?UTF-8\?([BQ])\?([^?]+)\?=/i.exec(
      russian?.data ?? "",
    );
    expect(encoded).not.toBeNull();
    const [, transfer, subject] = encoded!;
    const decoded =
      transfer.toUpperCase() === "B"
        ? Buffer.from(subject, "base64").toString("utf8")
        : Buffer.from(
            subject
              .replaceAll("_", " ")
              .replace(/=([A-F0-9]{2})/gi, (_, byte: string) =>
                String.fromCharCode(Number.parseInt(byte, 16)),
              ),
            "latin1",
          ).toString("utf8");
    expect(decoded).toContain("1 задача");
    expect(await scheduler.run("due-reminders")).toEqual({ sent: 0 });
  });

  async function stageBroadcast(addresses: string[]) {
    const stagedDelivery = new NotificationDeliveryService(prisma, mailer);
    jest.spyOn(stagedDelivery, "kick").mockResolvedValue(undefined);
    const comms = new CommsService(prisma, mailer, templates, stagedDelivery);
    const announcement = await comms.createAnnouncement(
      {
        audience: "segment",
        segment: addresses.join(","),
        sendEmail: true,
        title: "News",
        body: "Test announcement",
      },
      "test-admin",
    );
    return (address: string) =>
      notificationMailId("broadcast", announcement.id, address);
  }

  it("skips staged recipients disabled or deleted before dispatch and delivers to external addresses", async () => {
    const [en, ru] = await Promise.all([
      prisma.user.create({ data: { email: EN } }),
      prisma.user.create({ data: { email: RU } }),
    ]);
    const external = "external@example.com";
    const id = await stageBroadcast([EN, RU, external]);
    expect(
      await prisma.notificationMail.findUnique({ where: { id: id(EN) } }),
    ).toMatchObject({ userId: en.id });
    expect(
      await prisma.notificationMail.findUnique({ where: { id: id(RU) } }),
    ).toMatchObject({ userId: ru.id });
    await prisma.user.update({
      where: { id: en.id },
      data: { disabledAt: new Date() },
    });
    await prisma.user.delete({ where: { id: ru.id } });
    await delivery.kick();
    expect(smtp.accepted.map(({ to }) => to)).toEqual([external]);
    for (const address of [EN, RU, external]) {
      expect(
        await prisma.notificationMail.findUnique({
          where: { id: id(address) },
        }),
      ).toMatchObject({
        finishedAt: expect.any(Date),
        message: null,
        userId: null,
      });
    }
  });

  it("records terminal SMTP failures and stops retrying these deliveries", async () => {
    const id = await stageBroadcast([EN, RU]);
    smtp.rejecting.set(EN, 550);
    smtp.rejecting.set(RU, 451);
    for (let attempt = 1; attempt <= MAX_NOTIFICATION_ATTEMPTS; attempt += 1) {
      await prisma.notificationMail.updateMany({
        where: { finishedAt: null },
        data: { nextAttemptAt: new Date(0) },
      });
      await delivery.kick();
      const transient = await prisma.notificationMail.findUniqueOrThrow({
        where: { id: id(RU) },
      });
      expect(transient.attempts).toBe(attempt);
      if (attempt < MAX_NOTIFICATION_ATTEMPTS) {
        expect(transient.failedAt).toBeNull();
        expect(transient.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      }
    }
    for (const [address, attempts] of [
      [EN, 1],
      [RU, MAX_NOTIFICATION_ATTEMPTS],
    ] as const) {
      const row = await prisma.notificationMail.findUniqueOrThrow({
        where: { id: id(address) },
      });
      expect(row).toMatchObject({
        failedAt: expect.any(Date),
        finishedAt: row.failedAt,
        message: null,
        attempts,
      });
    }
    smtp.rejecting.clear();
    await delivery.kick();
    expect(smtp.accepted).toHaveLength(0);
    expect(
      await new BroadcastQueueService(mailer, prisma).stats(),
    ).toMatchObject({
      pending: 0,
      processed: 0,
      failed: 2,
    });
  });

  const redisUrl = process.env.TASK1806_TEST_REDIS_URL;
  (redisUrl ? it : it.skip)(
    "replays a partially accepted BullMQ broadcast and recovers from SMTP failure without re-sending successful recipients",
    async () => {
      const connection = { url: redisUrl!, maxRetriesPerRequest: null };
      const prefix = `task1806-${randomUUID()}`;
      const queue = new Queue<NotificationMailJob>("broadcast", {
        connection,
        prefix,
      });
      const redisDelivery = new NotificationDeliveryService(
        prisma,
        mailer,
        undefined,
        queue,
      );
      const comms = new CommsService(prisma, mailer, templates, redisDelivery);
      const processor = new BroadcastProcessor(
        redisDelivery,
        new BroadcastQueueService(mailer, prisma, queue),
      );
      const addBulk = queue.addBulk.bind(queue);
      const loseEnqueueReply = jest
        .spyOn(queue, "addBulk")
        .mockImplementationOnce(async (jobs) => {
          await addBulk(jobs.slice(0, 1));
          throw new Error("Redis reply lost after enqueue");
        });
      let worker: Worker<NotificationMailJob> | undefined;
      try {
        await makeBoard();
        const announcement = await comms.createAnnouncement(
          {
            active: true,
            sendEmail: true,
            sourceLocale: "en",
            translations: {
              en: { title: "News", body: "Test announcement" },
              ru: { title: "Новости", body: "Тестовое объявление" },
            },
          },
          "test-admin",
        );
        await eventually(async () => (await queue.getWaitingCount()) === 1);
        expect(announcement.emailSentAt).toEqual(expect.any(Number));
        expect(smtp.accepted).toHaveLength(0);
        expect(
          await prisma.notificationMail.count({ where: { finishedAt: null } }),
        ).toBe(2);
        loseEnqueueReply.mockRestore();

        await redisDelivery.kick();
        const queued = await queue.getWaiting();
        expect(queued).toHaveLength(2);
        expect(
          queued.every(
            (job) => job.id === job.data.deliveryId && !job.id.includes(":"),
          ),
        ).toBe(true);
        // Drop Redis jobs while keeping the authoritative PostgreSQL rows.
        await queue.drain();
        expect(await queue.getWaitingCount()).toBe(0);
        await redisDelivery.kick();
        expect(await queue.getWaitingCount()).toBe(2);
        smtp.rejecting.set(EN, 451);
        worker = new Worker<NotificationMailJob>(
          "broadcast",
          (job) => processor.process(job),
          { connection, prefix },
        );
        await eventually(
          async () =>
            (await prisma.notificationMail.count({
              where: { finishedAt: { not: null } },
            })) === 1 &&
            (await prisma.notificationMail.count({
              where: { attempts: 1, finishedAt: null },
            })) === 1 &&
            (await queue.getActiveCount()) === 0,
        );
        expect(smtp.accepted.map((message) => message.to)).toEqual([RU]);

        smtp.rejecting.delete(EN);
        await prisma.notificationMail.updateMany({
          where: { finishedAt: null },
          data: { nextAttemptAt: new Date(0) },
        });
        await redisDelivery.kick();
        await eventually(
          async () =>
            (await prisma.notificationMail.count({
              where: { finishedAt: null },
            })) === 0,
        );
        expect(smtp.accepted.map((message) => message.to).sort()).toEqual([
          EN,
          RU,
        ]);
      } finally {
        loseEnqueueReply.mockRestore();
        await redisDelivery.onModuleDestroy();
        await worker?.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    },
  );
});
