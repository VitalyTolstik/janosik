import {
  approvalPlanHash,
  canonicalJson,
  normalizeApprovalPlan,
  planFromOperation,
  riskOfPlan,
  summarizePlan,
} from "./approval-plan";

/** TASK-166.5: the plan hash must be stable across JSON key order and server
 *  context (`at`, action-level boardId), and must change only with intent. */
describe("approval plan hashing and validation", () => {
  const boardId = "board-1";
  const command = {
    commandId: "cmd-1",
    action: { type: "DELETE_CARD", cardId: "card-1" },
  };

  it("includes absolute and relative expiry in lifecycle approval intent", () => {
    const hash = (body: Record<string, unknown>) =>
      approvalPlanHash(planFromOperation(boardId, "share.create", {}, body));
    expect(hash({ mode: "live" })).not.toBe(
      hash({ mode: "live", expiresAt: "2030-01-01T00:00:00Z" }),
    );
    expect(hash({ mode: "live", expiresInHours: 1 })).not.toBe(
      hash({ mode: "live", expiresInHours: 2 }),
    );
    expect(
      hash({
        mode: "live",
        expiresInHours: 1,
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    ).toBe(
      hash({
        mode: "live",
        expiresInHours: 1,
        expiresAt: "2030-01-02T00:00:00Z",
      }),
    );
    const body = {
      mode: "live",
      expiresInHours: 1,
      expiresAt: "2030-01-01T00:00:00Z",
    };
    const explicit = normalizeApprovalPlan(
      {
        schemaVersion: 1,
        boardId,
        operations: [{ op: "share.create", target: { boardId }, body }],
      },
      boardId,
    );
    expect(approvalPlanHash(explicit)).toBe(hash(body));
  });

  it("sorts object keys recursively and omits nothing from arrays", () => {
    expect(
      canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: true } }),
    ).toBe('{"a":{"c":true,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("hashes the same intent identically regardless of key order and at", () => {
    const first = normalizeApprovalPlan(
      { schemaVersion: 1, boardId, commands: [command] },
      boardId,
    );
    const second = normalizeApprovalPlan(
      {
        commands: [
          {
            action: {
              cardId: "card-1",
              type: "DELETE_CARD",
              at: Date.now(),
              boardId,
            },
            commandId: "cmd-1",
          },
        ],
        boardId,
        schemaVersion: 1,
      },
      boardId,
    );
    expect(approvalPlanHash(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(approvalPlanHash(second)).toBe(approvalPlanHash(first));
    expect(second.commands?.[0]?.action).toEqual({
      type: "DELETE_CARD",
      cardId: "card-1",
    });
  });

  it("changes the hash when the command id or action changes", () => {
    const base = normalizeApprovalPlan(
      { schemaVersion: 1, boardId, commands: [command] },
      boardId,
    );
    const otherId = normalizeApprovalPlan(
      {
        schemaVersion: 1,
        boardId,
        commands: [{ ...command, commandId: "cmd-2" }],
      },
      boardId,
    );
    const otherAction = normalizeApprovalPlan(
      {
        schemaVersion: 1,
        boardId,
        commands: [
          {
            commandId: "cmd-1",
            action: { type: "DELETE_CARD", cardId: "card-2" },
          },
        ],
      },
      boardId,
    );
    expect(approvalPlanHash(otherId)).not.toBe(approvalPlanHash(base));
    expect(approvalPlanHash(otherAction)).not.toBe(approvalPlanHash(base));
  });

  it("accepts exactly one whitelisted operation with a matching board", () => {
    const plan = normalizeApprovalPlan(
      {
        schemaVersion: 1,
        boardId,
        operations: [
          {
            op: "share.create",
            target: { boardId },
            body: { mode: "live" },
          },
        ],
      },
      boardId,
    );
    expect(plan.operations).toEqual([
      { op: "share.create", target: { boardId }, body: { mode: "live" } },
    ]);
    expect(riskOfPlan(plan)).toBe("medium");
    expect(summarizePlan(plan, "share.create")).toMatch(/share link/i);
  });

  it("rejects mixed, empty, foreign-board and unknown plans", () => {
    expect(() =>
      normalizeApprovalPlan(
        {
          schemaVersion: 1,
          boardId,
          commands: [command],
          operations: [],
        },
        boardId,
      ),
    ).toThrow(/exactly one/);
    expect(() =>
      normalizeApprovalPlan(
        { schemaVersion: 1, boardId, commands: [] },
        boardId,
      ),
    ).toThrow(/non-empty/);
    expect(() =>
      normalizeApprovalPlan(
        { schemaVersion: 1, boardId, operations: [] },
        boardId,
      ),
    ).toThrow(/exactly one operation/);
    expect(() =>
      normalizeApprovalPlan(
        {
          schemaVersion: 1,
          boardId: "board-2",
          operations: [
            { op: "board.delete", target: { boardId: "board-2" }, body: {} },
          ],
        },
        boardId,
      ),
    ).toThrow(/must match the board/);
    expect(() =>
      normalizeApprovalPlan(
        {
          schemaVersion: 1,
          boardId,
          operations: [{ op: "share.grant", target: { boardId }, body: {} }],
        },
        boardId,
      ),
    ).toThrow(/whitelisted/);
  });

  it("classifies lifecycle risk and summary", () => {
    expect(riskOfPlan(planFromOperation(boardId, "board.delete", {}, {}))).toBe(
      "high",
    );
    expect(
      riskOfPlan(planFromOperation(boardId, "attachment.delete", {}, {})),
    ).toBe("medium");
    expect(
      summarizePlan(
        normalizeApprovalPlan(
          {
            schemaVersion: 1,
            boardId,
            commands: [command, { ...command, commandId: "cmd-2" }],
          },
          boardId,
        ),
        "batch",
      ),
    ).toMatch(/2 commands/);
  });
});
