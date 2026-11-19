import type { Queue } from "bullmq";
import type { PrismaService } from "@/common/prisma/prisma.service";
import {
  NotificationDeliveryService,
  notificationMailId,
  type NotificationMailJob,
} from "@/mailer/notification-delivery.service";
import type { MailerService } from "@/mailer/mailer.service";
import { BroadcastQueueService } from "./broadcast-queue.service";

const job = {
  to: "a@example.com",
  subject: "News",
  text: "Hello",
  html: "<p>Hello</p>",
};

function fixture() {
  const send = jest.fn().mockResolvedValue(true);
  const ids = [
    notificationMailId("broadcast", "row:id:legacy:en:fallback", job.to),
    notificationMailId(
      "broadcast",
      "row:id:legacy:en:fallback",
      "b@example.com",
    ),
  ];
  const findMany = jest
    .fn()
    .mockResolvedValue(ids.map((id) => ({ id, kind: "broadcast" })));
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    notificationMail: { count, findMany },
  } as unknown as PrismaService;
  const mailer = { send } as unknown as MailerService;
  const addBulk = jest.fn();
  const getJobCounts = jest.fn().mockResolvedValue({
    waiting: 3,
    active: 1,
    delayed: 2,
    completed: 10,
    failed: 1,
  });
  const queue = {
    addBulk,
    getJobCounts,
  } as unknown as Queue<NotificationMailJob>;
  return { send, ids, prisma, mailer, addBulk, queue, findMany, count };
}

describe("broadcast delivery", () => {
  it("queues one stable, BullMQ-safe id per recipient through an ambiguous Redis failure", async () => {
    const { send, ids, prisma, mailer, addBulk, queue } = fixture();
    const delivery = new NotificationDeliveryService(
      prisma,
      mailer,
      undefined,
      queue,
    );
    addBulk.mockRejectedValueOnce(new Error("enqueue reply lost"));
    await delivery.kick();
    expect(send).not.toHaveBeenCalled();
    expect(addBulk).toHaveBeenCalledTimes(1);
    await delivery.kick();
    expect(addBulk).toHaveBeenCalledTimes(2);
    expect(ids[0]).not.toContain(":");
    expect(ids[0]).not.toBe(ids[1]);
    expect(addBulk).toHaveBeenCalledWith(
      ids.map((id) => ({
        name: "broadcast",
        data: { deliveryId: id },
        opts: expect.objectContaining({ jobId: id }),
      })),
    );
    expect(addBulk.mock.calls[0]).toEqual(addBulk.mock.calls[1]);
    expect(send).not.toHaveBeenCalled();
  });

  it("dispatches all due pages, including rows with the same retry timestamp", async () => {
    const { prisma, mailer, queue, addBulk, findMany } = fixture();
    const nextAttemptAt = new Date(0);
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: `row-${index.toString().padStart(3, "0")}`,
      kind: "broadcast",
      nextAttemptAt,
    }));
    findMany.mockImplementation(async ({ where, take }) => {
      const afterId = where.OR?.[1].id.gt ?? "";
      return rows.filter(({ id }) => id > afterId).slice(0, take);
    });
    await new NotificationDeliveryService(
      prisma,
      mailer,
      undefined,
      queue,
    ).kick();
    expect(addBulk.mock.calls.map(([jobs]) => jobs.length)).toEqual([
      100, 100, 5,
    ]);
    expect(
      addBulk.mock.calls.flatMap(([jobs]) =>
        jobs.map((job: { data: NotificationMailJob }) => job.data.deliveryId),
      ),
    ).toEqual(rows.map(({ id }) => id));
  });

  it("reports Redis job counts and durable attempts", async () => {
    const { prisma, mailer, queue, count } = fixture();
    count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);
    const stats = await new BroadcastQueueService(
      mailer,
      prisma,
      queue,
    ).stats();
    expect(stats).toEqual({
      pending: 8,
      processed: 14,
      failed: 3,
      backend: "redis",
    });
  });

  it("reports durable broadcast state with no Redis", async () => {
    const { prisma, mailer, count } = fixture();
    count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    expect(await new BroadcastQueueService(mailer, prisma).stats()).toEqual({
      pending: 1,
      processed: 2,
      failed: 1,
      backend: "memory",
    });
  });

  it("delivers legacy jobs and propagates SMTP failures to their workers", async () => {
    const { send, prisma, mailer } = fixture();
    const service = new BroadcastQueueService(mailer, prisma);
    await expect(service.deliver(job)).resolves.toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledWith(job);
    send.mockRejectedValueOnce(new Error("550 no such user"));
    await expect(service.deliver(job)).rejects.toThrow("550");
  });

  it("ignores an empty outbox", async () => {
    const { send, prisma, mailer, queue, addBulk, findMany } = fixture();
    findMany.mockResolvedValueOnce([]);
    await new NotificationDeliveryService(
      prisma,
      mailer,
      undefined,
      queue,
    ).kick();
    expect(send).not.toHaveBeenCalled();
    expect(addBulk).not.toHaveBeenCalled();
  });
});
