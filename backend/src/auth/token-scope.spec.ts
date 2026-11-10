import { HttpException } from "@nestjs/common";
import type {
  ApiTokenIdentityDto,
  Board,
  BoardAction,
  ScopePreset,
} from "@janosik/shared";
import type { AuthPrincipal } from "./auth-principal";
import {
  assertAccountWidePreset,
  assertAgentRule,
  assertPatPreset,
  assertTokenBoardScope,
  classifyCommandAction,
  DEFAULT_BOARD_AGENT_POLICY,
  LIFECYCLE_ACTIONS,
  readBoardAgentPolicy,
} from "./token-scope";

/**
 * TASK-166 scope matrix. These tests pin the preset × action decisions and
 * the destructive/approval order (deny → preset → trustedCi → approval) so a
 * later route/tool cannot silently widen a token.
 */

const NOW = 1_700_000_000_000;

function principal(
  scope: ScopePreset,
  options: { trustedCi?: boolean; boardId?: string | null } = {},
): AuthPrincipal {
  const boardId = options.boardId ?? null;
  const identity: ApiTokenIdentityDto = {
    id: "token-1",
    name: "Agent",
    scopePreset: scope,
    trustedCi: options.trustedCi === true,
    effectiveTokenScope: scope,
    boardId,
    readOnly: false,
    rateLimitPerMinute: null,
    individualPausedAt: null,
    stopAllPausedAt: null,
    paused: false,
  };
  return {
    via: "pat",
    apiTokenId: "token-1",
    apiTokenName: "Agent",
    tokenIdentity: identity,
    tokenScope: { boardId, readOnly: false, rateLimitPerMinute: null },
  };
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    id: "board-1",
    title: "Board",
    columns: [
      { id: "todo", title: "Todo", cardIds: ["card-1"], createdAt: NOW },
      { id: "done", title: "Done", cardIds: [], createdAt: NOW },
    ],
    cards: {
      "card-1": {
        id: "card-1",
        title: "Card",
        labelIds: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      "card-done": {
        id: "card-done",
        title: "Done card",
        labelIds: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    labels: [],
    createdAt: NOW,
    updatedAt: NOW,
    workflow: {
      schemaVersion: 1,
      enabled: false,
      doneColumnIds: ["done"],
      transitions: [],
    },
    ...overrides,
  };
}

function action(
  type: string,
  extra: Record<string, unknown> = {},
): BoardAction {
  return { boardId: "board-1", at: NOW, type, ...extra } as BoardAction;
}

function errorBody(fn: () => void): Record<string, unknown> {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === "object" && body !== null) {
        return body as Record<string, unknown>;
      }
      return { message: body };
    }
    throw error;
  }
  throw new Error("expected the call to throw");
}

describe("TASK-166 token scope presets", () => {
  it("orders the presets and refuses a lower one", () => {
    expect(
      errorBody(() =>
        assertPatPreset(principal("observer"), "worker", "write"),
      ),
    ).toMatchObject({ code: "scope_denied", requiredScope: "worker" });
    expect(
      errorBody(() => assertPatPreset(principal("worker"), "reviewer", "done")),
    ).toMatchObject({ code: "scope_denied", requiredScope: "reviewer" });
    expect(
      errorBody(() => assertPatPreset(principal("reviewer"), "admin", "admin")),
    ).toMatchObject({ code: "scope_denied", requiredScope: "admin" });

    for (const [scope, required] of [
      ["worker", "worker"],
      ["reviewer", "worker"],
      ["reviewer", "reviewer"],
      ["admin", "admin"],
    ] as const) {
      expect(() =>
        assertPatPreset(principal(scope), required, "allowed"),
      ).not.toThrow();
    }
  });

  it("does not gate a browser session", () => {
    expect(() =>
      assertPatPreset({ via: "jwt" }, "admin", "admin"),
    ).not.toThrow();
  });

  it("keeps a board-scoped token on its board and refuses account-wide work", () => {
    const boardScope = errorBody(() =>
      assertTokenBoardScope(
        principal("admin", { boardId: "board-1" }),
        "board-2",
        "board.read",
      ),
    );
    expect(boardScope).toMatchObject({
      code: "scope_denied",
      action: "board.read",
      reason: "board_scope",
      message: "This API token is scoped to a different board",
    });
    expect(boardScope).not.toHaveProperty("requiredScope");
    expect(boardScope).not.toHaveProperty("effectiveTokenScope");
    expect(() =>
      assertTokenBoardScope(
        principal("admin", { boardId: "board-1" }),
        "board-1",
        "board.read",
      ),
    ).not.toThrow();
    expect(
      errorBody(() =>
        assertAccountWidePreset(
          principal("admin", { boardId: "board-1" }),
          "board.create",
        ),
      ),
    ).toMatchObject({ code: "scope_denied", requiredScope: "admin" });
    expect(
      errorBody(() =>
        assertAccountWidePreset(principal("worker"), "board.create"),
      ),
    ).toMatchObject({ code: "scope_denied" });
    expect(() =>
      assertAccountWidePreset(principal("admin"), "board.create"),
    ).not.toThrow();
  });
});

describe("TASK-166 command classification", () => {
  it("requires worker for ordinary content writes", () => {
    for (const type of [
      "ADD_CARD",
      "UPDATE_CARD",
      "MOVE_CARD",
      "ARCHIVE_CARD",
    ]) {
      const rule = classifyCommandAction(
        action(type, {
          newCardId: "card-new",
          columnId: "todo",
          title: "T",
          cardId: "card-1",
          fromColumnId: "todo",
          fromIndex: 0,
          toColumnId: "todo",
          toIndex: 0,
        }),
        board(),
      );
      expect(rule.requiredScope).toBe("worker");
      expect(rule.destructive).toBe(false);
    }
  });

  it("requires reviewer for every done-column transition", () => {
    const base = board();
    const cases: BoardAction[] = [
      action("ADD_CARD", {
        newCardId: "card-new",
        columnId: "done",
        title: "Done direct",
      }),
      action("MOVE_CARD", {
        cardId: "card-1",
        fromColumnId: "todo",
        fromIndex: 0,
        toColumnId: "done",
        toIndex: 0,
      }),
      action("UNARCHIVE_CARD", { cardId: "card-1", columnId: "done" }),
    ];
    for (const input of cases) {
      const rule = classifyCommandAction(input, base);
      expect(rule.requiredScope).toBe("reviewer");
      expect(rule.policyKey).toBe("move_to_done");
    }

    // An unknown/absent target is resolved like the reducer: the first
    // column. If that column is Done, a worker cannot use a bogus id to
    // bypass the reviewer gate.
    const doneFirst = classifyCommandAction(
      action("UNARCHIVE_CARD", { cardId: "card-1", columnId: "bogus" }),
      board({
        columns: [
          { id: "done", title: "Done", cardIds: [], createdAt: NOW },
          { id: "todo", title: "Todo", cardIds: ["card-1"], createdAt: NOW },
        ],
      }),
    );
    expect(doneFirst).toMatchObject({
      requiredScope: "reviewer",
      policyKey: "move_to_done",
    });
    const absentTarget = classifyCommandAction(
      action("UNARCHIVE_CARD", { cardId: "card-1" }),
      board({
        columns: [
          { id: "done", title: "Done", cardIds: [], createdAt: NOW },
          { id: "todo", title: "Todo", cardIds: ["card-1"], createdAt: NOW },
        ],
      }),
    );
    expect(absentTarget.requiredScope).toBe("reviewer");

    // Reordering inside Done is not a transition.
    const reorder = classifyCommandAction(
      action("MOVE_CARD", {
        cardId: "card-done",
        fromColumnId: "done",
        fromIndex: 0,
        toColumnId: "done",
        toIndex: 1,
      }),
      board({
        columns: [
          { id: "todo", title: "Todo", cardIds: ["card-1"], createdAt: NOW },
          {
            id: "done",
            title: "Done",
            cardIds: ["card-done"],
            createdAt: NOW,
          },
        ],
      }),
    );
    expect(reorder.requiredScope).toBe("worker");
  });

  it("requires reviewer to duplicate a card that lives in a done column", () => {
    const rule = classifyCommandAction(
      action("DUPLICATE_CARD", { cardId: "card-done", newCardId: "copy" }),
      board({
        columns: [
          { id: "todo", title: "Todo", cardIds: ["card-1"], createdAt: NOW },
          {
            id: "done",
            title: "Done",
            cardIds: ["card-done"],
            createdAt: NOW,
          },
        ],
      }),
    );
    expect(rule.requiredScope).toBe("reviewer");
  });

  it("marks deletes/bulk archive destructive at worker scope", () => {
    for (const type of [
      "DELETE_CARD",
      "DELETE_COLUMN",
      "ARCHIVE_COLUMN_CARDS",
      "DELETE_LABEL",
      "DELETE_CHECKLIST",
      "DELETE_CHECKLIST_ITEM",
    ]) {
      const rule = classifyCommandAction(action(type), board());
      expect(rule).toMatchObject({
        requiredScope: "worker",
        destructive: true,
      });
    }
  });

  it("requires admin for workflow and board-level commands", () => {
    expect(
      classifyCommandAction(action("SET_BOARD_WORKFLOW"), board()),
    ).toMatchObject({
      requiredScope: "admin",
      destructive: false,
      policyKey: "workflow.update",
    });
    expect(
      classifyCommandAction(action("ARCHIVE_BOARD"), board()),
    ).toMatchObject({
      requiredScope: "admin",
      destructive: false,
    });
    expect(
      classifyCommandAction(action("UNARCHIVE_BOARD"), board()),
    ).toMatchObject({
      requiredScope: "admin",
      destructive: false,
    });
  });

  it("never delegates browser undo to a PAT", () => {
    expect(
      classifyCommandAction(action("RESTORE_CARD"), board()),
    ).toMatchObject({
      patForbidden: true,
    });
  });
});

describe("TASK-166 destructive gate", () => {
  const deleteCard = classifyCommandAction(action("DELETE_CARD"), board());

  it("requires approval for a destructive action without trustedCi", () => {
    expect(
      errorBody(() =>
        assertAgentRule(
          principal("admin"),
          DEFAULT_BOARD_AGENT_POLICY,
          deleteCard,
        ),
      ),
    ).toMatchObject({ code: "approval_required", action: "DELETE_CARD" });
  });

  it("lets trustedCi execute a destructive action when policy allows", () => {
    expect(() =>
      assertAgentRule(
        principal("admin", { trustedCi: true }),
        DEFAULT_BOARD_AGENT_POLICY,
        deleteCard,
      ),
    ).not.toThrow();
  });

  it("lets a worker with trustedCi execute destructive work", () => {
    expect(() =>
      assertAgentRule(
        principal("worker", { trustedCi: true }),
        DEFAULT_BOARD_AGENT_POLICY,
        deleteCard,
      ),
    ).not.toThrow();
  });

  it("refuses an observer even with trustedCi (scope is checked first)", () => {
    expect(
      errorBody(() =>
        assertAgentRule(
          principal("observer", { trustedCi: true }),
          DEFAULT_BOARD_AGENT_POLICY,
          deleteCard,
        ),
      ),
    ).toMatchObject({ code: "scope_denied", requiredScope: "worker" });
  });

  it("hard-blocks destructive actions under destructive: deny, even for trustedCi", () => {
    const deny = { ...DEFAULT_BOARD_AGENT_POLICY, destructive: "deny" };
    expect(
      errorBody(() =>
        assertAgentRule(
          principal("admin", { trustedCi: true }),
          deny,
          deleteCard,
        ),
      ),
    ).toMatchObject({
      code: "destructive_denied",
      reason: "board_policy",
    });
  });

  it("still requires approval when a destructive key is removed from the list", () => {
    const policy = { ...DEFAULT_BOARD_AGENT_POLICY, requireApprovalFor: [] };
    expect(
      errorBody(() => assertAgentRule(principal("admin"), policy, deleteCard)),
    ).toMatchObject({ code: "approval_required" });
  });

  it("requires approval for workflow.update but lets trustedCi skip it", () => {
    const rule = LIFECYCLE_ACTIONS["workflow.update"];
    expect(
      errorBody(() =>
        assertAgentRule(principal("admin"), DEFAULT_BOARD_AGENT_POLICY, rule),
      ),
    ).toMatchObject({ code: "approval_required" });
    expect(() =>
      assertAgentRule(
        principal("admin", { trustedCi: true }),
        DEFAULT_BOARD_AGENT_POLICY,
        rule,
      ),
    ).not.toThrow();
    expect(
      errorBody(() =>
        assertAgentRule(principal("worker"), DEFAULT_BOARD_AGENT_POLICY, rule),
      ),
    ).toMatchObject({ code: "scope_denied", requiredScope: "admin" });
  });

  it("requires approval for done transitions only when policy asks", () => {
    const done = classifyCommandAction(
      action("MOVE_CARD", {
        cardId: "card-1",
        fromColumnId: "todo",
        fromIndex: 0,
        toColumnId: "done",
        toIndex: 0,
      }),
      board(),
    );
    expect(() =>
      assertAgentRule(principal("reviewer"), DEFAULT_BOARD_AGENT_POLICY, done),
    ).not.toThrow();
    const policy = {
      ...DEFAULT_BOARD_AGENT_POLICY,
      requireApprovalFor: ["move_to_done" as const],
    };
    expect(
      errorBody(() => assertAgentRule(principal("reviewer"), policy, done)),
    ).toMatchObject({ code: "approval_required" });
    expect(() =>
      assertAgentRule(principal("reviewer", { trustedCi: true }), policy, done),
    ).not.toThrow();
  });

  it("requires admin and approval for board/member/share lifecycle actions", () => {
    for (const key of [
      "board.delete",
      "member.invite",
      "member.update",
      "member.remove",
      "share.create",
      "share.update",
      "share.revoke",
      "share.delete",
      "attachment.delete",
    ] as const) {
      const rule = LIFECYCLE_ACTIONS[key];
      expect(rule).toMatchObject({ requiredScope: "admin", destructive: true });
      expect(
        errorBody(() =>
          assertAgentRule(
            principal("worker"),
            DEFAULT_BOARD_AGENT_POLICY,
            rule,
          ),
        ),
      ).toMatchObject({ code: "scope_denied", requiredScope: "admin" });
      expect(
        errorBody(() =>
          assertAgentRule(principal("admin"), DEFAULT_BOARD_AGENT_POLICY, rule),
        ),
      ).toMatchObject({ code: "approval_required" });
    }
  });

  it("refuses PAT restore even for an admin trustedCi token", () => {
    const restore = classifyCommandAction(action("RESTORE_CARD"), board());
    expect(
      errorBody(() =>
        assertAgentRule(
          principal("admin", { trustedCi: true }),
          DEFAULT_BOARD_AGENT_POLICY,
          restore,
        ),
      ),
    ).toMatchObject({ code: "scope_denied" });
  });

  it("does not gate a browser session for destructive actions", () => {
    expect(() =>
      assertAgentRule({ via: "jwt" }, { destructive: "deny" }, deleteCard),
    ).not.toThrow();
  });
});

describe("TASK-166 board agent policy", () => {
  it("uses safe defaults for NULL/corrupt values", () => {
    expect(readBoardAgentPolicy(null)).toEqual(DEFAULT_BOARD_AGENT_POLICY);
    expect(readBoardAgentPolicy("garbage")).toEqual(DEFAULT_BOARD_AGENT_POLICY);
    expect(readBoardAgentPolicy({ destructive: "off" }).destructive).toBe(
      "approval",
    );
  });

  it("preserves deny, an explicit empty list and valid limits", () => {
    expect(
      readBoardAgentPolicy({
        destructive: "deny",
        requireApprovalFor: [],
        maxCommandsPerRun: 10,
        maxCardsPerRun: 5,
        approvalTtlMinutes: 5,
      }),
    ).toMatchObject({
      destructive: "deny",
      requireApprovalFor: [],
      maxCommandsPerRun: 10,
      maxCardsPerRun: 5,
      approvalTtlMinutes: 5,
    });
  });

  it("drops unknown approval keys and rejects out-of-range limits", () => {
    expect(
      readBoardAgentPolicy({
        requireApprovalFor: ["delete_card", "nonsense", "move_to_done"],
        maxCommandsPerRun: 1000,
        maxCardsPerRun: 0,
        approvalTtlMinutes: 1,
      }),
    ).toMatchObject({
      requireApprovalFor: ["delete_card", "move_to_done"],
      maxCommandsPerRun: 100,
      maxCardsPerRun: 50,
      approvalTtlMinutes: 60,
    });
  });
});
