import type { Queue } from "bullmq";
import type { MailerService } from "@/mailer/mailer.service";
import {
  BROADCAST_JOB,
  BroadcastQueueService,
  type BroadcastJob,
} from "./broadcast-queue.service";

const mailerMock = {
  send: jest.fn(),
} as unknown as MailerService & { send: jest.Mock };

const job: BroadcastJob = {
  emails: ["a@example.com", "b@example.com"],
  subject: "News",
  text: "Hello",
  html: "<p>Hello</p>",
};

describe("BroadcastQueueService", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("BullMQ backend (queue injected)", () => {
    it("enqueues one job with retry options instead of sending inline", async () => {
      const queue = {
        add: jest.fn(),
        getJobCounts: jest.fn(),
      } as unknown as Queue<BroadcastJob> & { add: jest.Mock };
      const service = new BroadcastQueueService(mailerMock, queue);

      expect(service.usingRedis).toBe(true);
      await service.enqueue(job);

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [name, data, options] = queue.add.mock.calls[0];
      expect(name).toBe(BROADCAST_JOB);
      expect(data).toEqual(job);
      expect(options.attempts).toBe(3);
      expect(options.backoff).toEqual({ type: "exponential", delay: 2_000 });
      // Nothing leaves the process until the worker runs.
      expect(mailerMock.send).not.toHaveBeenCalled();
    });

    it("falls back to the in-process drain when Redis rejects the job", async () => {
      mailerMock.send.mockResolvedValue(undefined);
      const queue = {
        add: jest.fn().mockRejectedValue(new Error("redis down")),
        getJobCounts: jest.fn(),
      } as unknown as Queue<BroadcastJob> & { add: jest.Mock };
      const service = new BroadcastQueueService(mailerMock, queue);

      await service.enqueue(job);

      // Both addresses still got a direct send attempt.
      expect(mailerMock.send).toHaveBeenCalledTimes(2);
    });

    it("reads job counts from the Redis queue", async () => {
      const queue = {
        add: jest.fn(),
        getJobCounts: jest.fn().mockResolvedValue({
          waiting: 3,
          active: 1,
          delayed: 2,
          completed: 10,
          failed: 1,
        }),
      } as unknown as Queue<BroadcastJob> & { getJobCounts: jest.Mock };
      const service = new BroadcastQueueService(mailerMock, queue);

      const stats = await service.stats();
      expect(stats).toEqual({
        pending: 6,
        processed: 10,
        failed: 1,
        backend: "redis",
      });
    });
  });

  describe("In-process fallback (no queue)", () => {
    it("delivers every address and reports memory stats", async () => {
      mailerMock.send.mockResolvedValue(undefined);
      const service = new BroadcastQueueService(mailerMock);

      expect(service.usingRedis).toBe(false);
      await service.enqueue(job);

      expect(mailerMock.send).toHaveBeenCalledTimes(2);
      expect(mailerMock.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "a@example.com", subject: "News" }),
      );
      expect(await service.stats()).toEqual({
        pending: 0,
        processed: 2,
        failed: 0,
        backend: "memory",
      });
    });

    it("keeps going when one address fails", async () => {
      mailerMock.send
        .mockRejectedValueOnce(new Error("550 no such user"))
        .mockResolvedValueOnce(undefined);
      const service = new BroadcastQueueService(mailerMock);

      const result = await service.deliver(job);

      expect(result).toEqual({ sent: 1, failed: 1 });
      expect(mailerMock.send).toHaveBeenCalledTimes(2);
    });

    it("ignores an empty recipient list", async () => {
      const service = new BroadcastQueueService(mailerMock);
      await service.enqueue({ ...job, emails: [] });
      expect(mailerMock.send).not.toHaveBeenCalled();
    });
  });
});
