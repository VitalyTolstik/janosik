import { MediaService } from "./media.service";
import { TranscodeService } from "./transcode.service";
import { recentQueueJobs, resetQueueJobLog } from "@/ops/queue-core";

function queueStub() {
  return { add: jest.fn().mockResolvedValue({ id: "job-1" }) };
}

/** TASK-166.10: media/transcode jobs carry request attribution. */
describe("attachment queue attribution", () => {
  beforeEach(() => resetQueueJobLog());

  it("puts token/session/board ids on a media job", async () => {
    const queue = queueStub();
    const service = new MediaService(
      {} as never,
      {} as never,
      {} as never,
      queue as never,
    );
    service.enqueue("att-1", {
      actorType: "agent",
      actorId: "user-1",
      boardId: "board-1",
      apiTokenId: "token-1",
      agentSessionId: "session-1",
      runId: "run-1",
    });
    await Promise.resolve();

    expect(queue.add).toHaveBeenCalledWith(
      "derive",
      {
        attachmentId: "att-1",
        attribution: {
          actorType: "agent",
          actorId: "user-1",
          boardId: "board-1",
          apiTokenId: "token-1",
          agentSessionId: "session-1",
          runId: "run-1",
        },
      },
      expect.objectContaining({ jobId: "att-1" }),
    );
    expect(recentQueueJobs()[0]).toMatchObject({
      queue: "media",
      attribution: { apiTokenId: "token-1", agentSessionId: "session-1" },
    });
  });

  it("leaves a boot-recovery job without an attribution field", async () => {
    const queue = queueStub();
    const service = new TranscodeService(
      {} as never,
      {} as never,
      {} as never,
      queue as never,
    );
    service.enqueue("att-2");
    await Promise.resolve();

    expect(queue.add).toHaveBeenCalledWith(
      "transcode",
      { attachmentId: "att-2" },
      expect.objectContaining({ jobId: "att-2" }),
    );
    expect(recentQueueJobs()[0]?.attribution).toBeUndefined();
  });
});
