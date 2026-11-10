import {
  jobAttribution,
  logQueueJob,
  QUEUE_NAMES,
  recentQueueJobs,
  resetQueueJobLog,
} from "./queue-core";

/** TASK-166.10: queue payload attribution contains ids only. */
describe("jobAttribution", () => {
  it("keeps the present attribution fields and drops absent ones", () => {
    expect(
      jobAttribution({
        actorType: "agent",
        actorId: "user-1",
        boardId: "board-1",
        apiTokenId: "token-1",
        agentSessionId: "session-1",
        runId: "run-1",
      }),
    ).toEqual({
      actorType: "agent",
      actorId: "user-1",
      boardId: "board-1",
      apiTokenId: "token-1",
      agentSessionId: "session-1",
      runId: "run-1",
    });
    expect(jobAttribution({ boardId: "b" })).toEqual({ boardId: "b" });
    expect(jobAttribution(undefined)).toBeUndefined();
    expect(jobAttribution({})).toBeUndefined();
  });

  it("records a bounded structured event without content", () => {
    resetQueueJobLog();
    logQueueJob(QUEUE_NAMES.media, "derive", {
      actorType: "agent",
      actorId: "user-1",
      boardId: "board-1",
      apiTokenId: "token-1",
      agentSessionId: "session-1",
      runId: "run-1",
    });
    const [event] = recentQueueJobs();
    expect(event).toMatchObject({
      event: "queue.job",
      queue: "media",
      job: "derive",
      attribution: {
        actorType: "agent",
        boardId: "board-1",
        apiTokenId: "token-1",
        agentSessionId: "session-1",
        runId: "run-1",
      },
    });
    const line = JSON.stringify(event);
    expect(line).not.toContain("fileName");
    expect(line).not.toContain("@example.com");
    resetQueueJobLog();
    expect(recentQueueJobs()).toEqual([]);
  });
});
