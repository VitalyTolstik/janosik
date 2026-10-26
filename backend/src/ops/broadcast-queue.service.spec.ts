import type { Queue } from "bullmq";
import type { MailerService } from "@/mailer/mailer.service";
import {
  BROADCAST_JOB,
  BroadcastQueueService,
  type BroadcastJob,
  type BroadcastRequest,
} from "./broadcast-queue.service";

const mailerMock = {
  send: jest.fn(),
} as unknown as MailerService & { send: jest.Mock };

const request: BroadcastRequest = {
  id: "ann-1",
  emails: ["a@example.com", "b@example.com"],
  subject: "News",
  text: "Hello",
  html: "<p>Hello</p>",
};

const oneJob: BroadcastJob = {
  to: "a@example.com",
  subject: "News",
  text: "Hello",
  html: "<p>Hello</p>",
};

describe("BroadcastQueueService", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("BullMQ backend (queue injected)", () => {
    it("fans out one retryable job per recipient with a deterministic id (TASK-110)", async () => {
      const queue = {
        add: jest.fn(),
        getJobCounts: jest.fn(),
      } as unknown as Queue<BroadcastJob> & { add: jest.Mock };
      const service = new BroadcastQueueService(mailerMock, queue);

      expect(service.usingRedis).toBe(true);
      await service.enqueue(request);

      expect(queue.add).toHaveBeenCalledTimes(2);
      const [name, data, options] = queue.add.mock.calls[0];
      expect(name).toBe(BROADCAST_JOB);
      expect(data).toEqual({
        to: "a@example.com",
        subject: "News",
        text: "Hello",
        html: "<p>Hello</p>",
      });
      expect(options.attempts).toBe(3);
      expect(options.backoff).toEqual({ type: "exponential", delay: 2_000 });
      expect(options.jobId).toBe("ann-1:a@example.com");
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

      await service.enqueue(request);

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
      await service.enqueue(request);

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

    it("throws on a failed recipient so the job retries (TASK-110)", async () => {
      mailerMock.send.mockRejectedValueOnce(new Error("550 no such user"));
      const service = new BroadcastQueueService(mailerMock);

      await expect(service.deliver(oneJob)).rejects.toThrow("550");
      expect(await service.stats()).toEqual({
        pending: 0,
        processed: 0,
        failed: 1,
        backend: "memory",
      });
    });

    it("keeps going when one address fails during the drain", async () => {
      mailerMock.send
        .mockRejectedValueOnce(new Error("550 no such user"))
        .mockResolvedValueOnce(undefined);
      const service = new BroadcastQueueService(mailerMock);

      await service.enqueue(request);

      expect(mailerMock.send).toHaveBeenCalledTimes(2);
      expect((await service.stats()).failed).toBe(1);
    });

    it("ignores an empty recipient list", async () => {
      const service = new BroadcastQueueService(mailerMock);
      await service.enqueue({ ...request, emails: [] });
      expect(mailerMock.send).not.toHaveBeenCalled();
    });
  });
});
