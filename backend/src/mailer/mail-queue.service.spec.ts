import type { Queue } from "bullmq";
import type { MailerService } from "./mailer.service";
import { MAIL_JOB, MailQueueService, type MailJob } from "./mail-queue.service";

const mailerMock = {
  send: jest.fn(),
} as unknown as MailerService & { send: jest.Mock };

const job: MailJob = {
  to: "user@example.com",
  subject: "Hi",
  text: "Hello",
  html: "<p>Hello</p>",
};

describe("MailQueueService", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("enqueues with retry options instead of sending inline (Redis)", async () => {
    const queue = {
      add: jest.fn(),
      getJobCounts: jest.fn(),
    } as unknown as Queue<MailJob> & { add: jest.Mock };
    const service = new MailQueueService(mailerMock, queue);

    expect(service.usingRedis).toBe(true);
    await service.enqueue(job);

    const [name, data, options] = queue.add.mock.calls[0];
    expect(name).toBe(MAIL_JOB);
    expect(data).toEqual(job);
    expect(options.attempts).toBe(3);
    expect(mailerMock.send).not.toHaveBeenCalled();
  });

  it("drains in-process when there is no Redis backend", async () => {
    mailerMock.send.mockResolvedValue(undefined);
    const service = new MailQueueService(mailerMock);

    expect(service.usingRedis).toBe(false);
    await service.enqueue(job);
    expect(mailerMock.send).toHaveBeenCalledWith(job);
  });

  it("swallows a transport failure so the caller never fails", async () => {
    mailerMock.send.mockRejectedValue(new Error("smtp down"));
    const service = new MailQueueService(mailerMock);

    await expect(service.enqueue(job)).resolves.toBeUndefined();
  });
});
