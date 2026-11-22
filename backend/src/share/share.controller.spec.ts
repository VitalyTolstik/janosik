import { sanitizePublicFrame } from "./share.controller";

/**
 * TASK-185.2 public live-share allowlist. These assertions are deliberately
 * field-exact: the public contour is its own contract, not "member frames
 * minus a few keys".
 */
describe("sanitizePublicFrame (TASK-185.2)", () => {
  it("projects an activity frame to the comment allowlist only", () => {
    const frame = sanitizePublicFrame({
      type: "activity",
      id: "activity-1",
      boardId: "b-1",
      cardId: "card-1",
      actorId: "master-1",
      actorType: "admin",
      at: 123,
      kind: "comment_updated",
      commentId: "comment-1",
      revisionId: "revision-1",
      detail: "comment-1",
      apiTokenId: "token-1",
      agentSessionId: "session-1",
      agentName: "agent",
      details: { text: "secret" },
      text: "secret",
    });
    expect(frame).toEqual({
      type: "activity",
      id: "activity-1",
      boardId: "b-1",
      cardId: "card-1",
      at: 123,
      kind: "comment_updated",
      commentId: "comment-1",
      detail: "comment-1",
    });
    expect(JSON.stringify(frame)).not.toContain("secret");
  });

  it("accepts a legacy id from detail but drops unknown kinds", () => {
    expect(
      sanitizePublicFrame({
        type: "activity",
        id: "activity-1",
        boardId: "b-1",
        at: 1,
        kind: "comment_deleted",
        detail: "comment-1",
      }),
    ).toMatchObject({ commentId: "comment-1", detail: "comment-1" });
    expect(
      sanitizePublicFrame({
        type: "activity",
        id: "activity-2",
        boardId: "b-1",
        at: 1,
        kind: "member_removed",
        commentId: "comment-1",
      }),
    ).toBeNull();
    expect(
      sanitizePublicFrame({
        type: "activity",
        id: "activity-3",
        boardId: "b-1",
        at: 1,
        kind: "comment_added",
      }),
    ).toBeNull();
  });

  it("projects commands field by field and never copies attribution", () => {
    const frame = sanitizePublicFrame({
      type: "command",
      seq: 7,
      actorId: "master-1",
      actorType: "agent",
      commandId: "cmd-1",
      apiTokenId: "token-1",
      agentSessionId: "session-1",
      agentName: "agent",
      runId: "run-1",
      touches: ["card:card-1", "private secret", "board:b-1"],
      action: {
        type: "MOVE_CARD",
        boardId: "b-1",
        at: 99,
        cardId: "card-1",
        fromColumnId: "col-1",
        fromIndex: 0,
        toColumnId: "col-2",
        toIndex: 1,
        actorId: "master-1",
        activityIds: ["activity-secret"],
        inverse: { secret: true },
      },
    });
    expect(frame).toEqual({
      type: "command",
      seq: 7,
      touches: ["card:card-1", "board:b-1"],
      action: {
        type: "MOVE_CARD",
        boardId: "b-1",
        at: 99,
        cardId: "card-1",
        fromColumnId: "col-1",
        fromIndex: 0,
        toColumnId: "col-2",
        toIndex: 1,
      },
    });
  });

  it("turns an unprojectable command into resync", () => {
    expect(
      sanitizePublicFrame({
        type: "command",
        seq: 8,
        action: { type: "RESTORE_BOARD", at: 1, board: { secret: true } },
      }),
    ).toEqual({ type: "resync" });
    expect(
      sanitizePublicFrame({
        type: "command",
        seq: 9,
        action: { type: "UNKNOWN_ACTION", at: 1 },
      }),
    ).toEqual({ type: "resync" });
  });

  it("allows only ping and resync service frames", () => {
    expect(sanitizePublicFrame("ping")).toBe("ping");
    expect(sanitizePublicFrame("keepalive")).toBeNull();
    expect(sanitizePublicFrame({ type: "resync" })).toEqual({
      type: "resync",
    });
    expect(sanitizePublicFrame({ type: "presence", op: "join" })).toBeNull();
    expect(sanitizePublicFrame({ type: "keepalive" })).toBeNull();
    expect(sanitizePublicFrame({ type: "agent", op: "started" })).toBeNull();
  });
});
