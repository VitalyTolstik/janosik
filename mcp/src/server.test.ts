import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TOOLSETS, TOOLSETS, type Config } from "./config.js";
import { createServer } from "./server.js";

/**
 * End-to-end tool tests over an in-memory MCP transport with a stubbed Janosik
 * API: registration, the read path, a write command's wire shape, and the
 * error mapping — the same wiring a real client sees, minus the network.
 */

interface Call {
  path: string;
  method: string;
  body: unknown;
  headers?: Record<string, string>;
}

let calls: Call[];

function respond(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Mutable fake state: the board's seq and how many 409s to answer first. */
let boardSeq: number;
let staleWrites: number;
let commandPayload: string;
let cardOverrides: Record<string, unknown>;
let searchFailure: number | null;
let archivedBoard: boolean;
let boardWorkflow: unknown;
let boardEpics: unknown[];
let approvalStatus:
  "pending" | "approved" | "rejected" | "expired" | "cancelled" | "consumed";
/** Command action type that answers 409 approval_required without a header. */
let approvalRequiredFor: string | null;
/** Older-server simulation: the ready endpoints answer 404. */
let readyEndpointMissing: boolean;
/** Pre-200.7 server simulation: card context/intent routes answer 404. */
let intentEndpointMissing: boolean;
/** Make the first move conflict also change the destination to Done. */
let doneAfterMoveConflict: boolean;
/** Transient fetch failures before the next ready request succeeds. */
let readyNetworkFailures: number;
/** 503 ready_poll_capacity answers before the next ready request succeeds. */
let readyCapacityFailures: number;
/** 429 rate_limited answers before the next list snapshot succeeds. */
let readyRateLimitFailures: number;

function board(cards: Record<string, unknown> = {}) {
  return {
    id: "b1",
    title: "Alpha",
    columns: [
      {
        id: "col1",
        title: "Todo",
        cardIds: ["k1", "k2", "k3", "k4"],
        createdAt: 1,
      },
      { id: "col2", title: "Done", cardIds: [], createdAt: 1 },
    ],
    cards: {
      k1: {
        id: "k1",
        title: "First",
        description: "original",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      k2: {
        id: "k2",
        title: "Widget task",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        checklists: [
          {
            id: "cl1",
            title: "DoD",
            items: [
              { id: "i1", text: "run the widget migration", done: false },
            ],
          },
        ],
      },
      k3: {
        id: "k3",
        title: "Contract card",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        checklists: [
          {
            id: "cl3",
            title: "Definition of Done",
            items: [{ id: "i3", text: "ship it", done: false }],
          },
        ],
      },
      k4: {
        id: "k4",
        title: "Done contract",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        checklists: [
          {
            id: "cl4",
            title: "Definition of Done",
            items: [{ id: "i4", text: "ship it", done: true }],
          },
        ],
      },
      k9: {
        id: "k9",
        title: "Zebrafish",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        archivedAt: 5,
      },
      ...cards,
    },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    ...(boardWorkflow ? { workflow: boardWorkflow } : {}),
    ...(boardEpics.length ? { epics: boardEpics } : {}),
  };
}

/** TASK-200.7 fake card context: one card, column names and done columns. */
function cardContext(cardId: string) {
  const snapshot = board(cardOverrides);
  const card = snapshot.cards[cardId as keyof typeof snapshot.cards] as
    Record<string, unknown> | undefined;
  const column =
    snapshot.columns.find((entry) => entry.cardIds.includes(cardId)) ?? null;
  const configured = (boardWorkflow as { doneColumnIds?: string[] } | null)
    ?.doneColumnIds;
  const doneColumnIds =
    configured && configured.length > 0
      ? configured
      : snapshot.columns.length > 0
        ? [snapshot.columns[snapshot.columns.length - 1]!.id]
        : [];
  return {
    boardId: "b1",
    card: card ?? null,
    columnId: column?.id ?? null,
    cardIndex: column ? column.cardIds.indexOf(cardId) : null,
    columns: snapshot.columns.map((entry) => ({
      id: entry.id,
      title: entry.title,
    })),
    doneColumnIds,
    ...(boardWorkflow ? { workflow: boardWorkflow } : {}),
    seq: boardSeq,
    versions: {
      "board:b1": 2,
      [`card:${cardId}`]: boardSeq,
      ...(column ? { [`column:${column.id}`]: 1 } : {}),
    },
  };
}

interface FakeReadyCard {
  id: string;
  title: string;
  priority?: string;
  claimedBy?: string;
  leaseUntil?: number;
  version?: number;
  description?: string;
  archivedAt?: number;
  assigneeId?: string;
  links?: Array<{ type: string; targetCardId: string }>;
}

interface FakeBoard {
  id: string;
  title: string;
  archivedAt?: number;
  columns: Array<{
    id: string;
    title: string;
    cardIds: string[];
    createdAt: number;
  }>;
  cards: Record<string, FakeReadyCard>;
  labels: unknown[];
  createdAt: number;
  updatedAt: number;
  workflow?: unknown;
}

/** The synthetic board a ready request targets, or null for an unknown id. */
function readyBoardSnapshot(boardId: string): FakeBoard | null {
  if (boardId === "b1") {
    return {
      ...(board(cardOverrides) as unknown as FakeBoard),
      ...(archivedBoard ? { archivedAt: 5 } : {}),
    };
  }
  if (boardId === "b3") {
    return {
      id: "b3",
      title: "Empty",
      columns: [{ id: "col1", title: "Backlog", cardIds: [], createdAt: 1 }],
      cards: {},
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    };
  }
  return null;
}

function priorityRank(priority: unknown): number {
  return ["blocker", "highest", "high", "medium", "low", "lowest"].indexOf(
    typeof priority === "string" ? priority : "medium",
  );
}

/** A ready summary in the real endpoint's shape, for the fake API. */
function readySummary(boardId: string, limit: number) {
  const snapshot = readyBoardSnapshot(boardId)!;
  const archived = snapshot.archivedAt !== undefined;
  const cards = archived
    ? []
    : (() => {
        const initial = (boardWorkflow as { initialColumnId?: string } | null)
          ?.initialColumnId;
        const column =
          snapshot.columns.find((entry) => entry.id === initial) ??
          snapshot.columns[0];
        if (!column) return [];
        const blocked = new Set<string>();
        for (const card of Object.values(snapshot.cards)) {
          if (card.archivedAt !== undefined) continue;
          for (const link of card.links ?? []) {
            if (link.type === "blocks") blocked.add(link.targetCardId);
          }
        }
        const now = Date.now();
        return column.cardIds
          .map((id) => snapshot.cards[id])
          .filter((card): card is FakeReadyCard => card !== undefined)
          .filter((card) => {
            if (card.archivedAt !== undefined) return false;
            if (card.assigneeId !== undefined) return false;
            if (card.claimedBy !== undefined && (card.leaseUntil ?? 0) > now) {
              return false;
            }
            return !blocked.has(card.id);
          })
          .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
          .slice(0, limit)
          .map((card) => ({
            id: card.id,
            title: card.title,
            boardId,
            boardTitle: snapshot.title,
            columnId: column.id,
            columnTitle: column.title,
            priority: card.priority ?? "medium",
            claimedBy: card.claimedBy ?? null,
            leaseUntil: card.leaseUntil ?? null,
            version: card.version ?? 0,
            descriptionChars: card.description?.length ?? 0,
          }));
      })();
  return {
    boardId,
    boardTitle: snapshot.title,
    archived,
    seq: boardSeq,
    limit,
    cards,
  };
}

/** A 204 long-poll timeout, after a short simulated hold. */
function timeoutResponse(waitMs: number): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(
      () => resolve(new Response(null, { status: 204 })),
      Math.min(waitMs, 25),
    );
  });
}

async function fakeApi(
  path: string,
  method: string,
  body: unknown,
  searchParams: URLSearchParams,
  headers: Record<string, string>,
): Promise<Response> {
  const readyMatch = /^\/boards\/([^/]+)\/ready$/.exec(path);
  if (readyMatch && method === "GET") {
    if (readyEndpointMissing) return respond({ message: "not found" }, 404);
    if (readyCapacityFailures > 0) {
      readyCapacityFailures -= 1;
      return respond(
        {
          message: "Too many held ready polls; retry shortly",
          code: "ready_poll_capacity",
          retryable: true,
          retryAfter: 0,
        },
        503,
        { "Retry-After": "0" },
      );
    }
    if (readyRateLimitFailures > 0) {
      readyRateLimitFailures -= 1;
      return respond(
        {
          message: "Too many requests",
          code: "rate_limited",
          retryable: true,
          retryAfter: 0,
        },
        429,
        { "Retry-After": "0" },
      );
    }
    const boardId = readyMatch[1]!;
    if (boardId !== "b1" && boardId !== "b3") {
      return respond({ message: "not found" }, 404);
    }
    const limit = Number(searchParams.get("limit") ?? 30);
    const wait = Number(searchParams.get("wait") ?? 0);
    const since = searchParams.get("since");
    const summary = readySummary(boardId, limit);
    if (
      wait > 0 &&
      summary.cards.length === 0 &&
      !summary.archived &&
      (since === null || Number(since) === boardSeq)
    ) {
      return timeoutResponse(wait);
    }
    return respond(summary);
  }
  if (path === "/boards/ready" && method === "GET") {
    if (readyEndpointMissing) return respond({ message: "not found" }, 404);
    if (readyCapacityFailures > 0) {
      readyCapacityFailures -= 1;
      return respond(
        {
          message: "Too many held ready polls; retry shortly",
          code: "ready_poll_capacity",
          retryable: true,
          retryAfter: 0,
        },
        503,
        { "Retry-After": "0" },
      );
    }
    if (readyRateLimitFailures > 0) {
      readyRateLimitFailures -= 1;
      return respond(
        {
          message: "Too many requests",
          code: "rate_limited",
          retryable: true,
          retryAfter: 0,
        },
        429,
        { "Retry-After": "0" },
      );
    }
    const limit = Number(searchParams.get("limit") ?? 30);
    const summary = readySummary("b1", limit);
    return respond({
      boards: [
        {
          id: "b1",
          title: "Alpha",
          archived: summary.archived,
          seq: boardSeq,
        },
      ],
      limit,
      cards: summary.cards,
    });
  }
  if (path === "/boards" && method === "GET") {
    return respond([
      {
        id: "b1",
        title: "Alpha",
        counters: { cards: 1, columns: 2 },
        role: "ADMIN",
      },
    ]);
  }
  if (path === "/boards" && method === "POST") {
    const title = (body as { title?: string } | undefined)?.title ?? "New";
    return respond(
      {
        id: "b-new",
        title,
        columns: [],
        cards: {},
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
      201,
    );
  }
  if (path === "/boards/import" && method === "POST") {
    return respond(
      [
        {
          id: "b-import",
          title: "Imported",
          columns: [],
          cards: {},
          labels: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      201,
    );
  }
  if (path === "/boards/b1/shares" && method === "POST") {
    return respond(
      {
        id: "share-1",
        token: "share-token",
        boardId: "b1",
        boardTitle: "Alpha",
        mode: "live",
        title: null,
        includeComments: true,
        includeAttachments: false,
        expiresAt: null,
        revokedAt: null,
        views: 0,
        lastViewedAt: null,
        createdAt: 1,
        createdBy: "u1",
      },
      201,
    );
  }
  if (path === "/boards/b1" && method === "GET") {
    const snapshot = board(cardOverrides);
    return respond(
      { ...snapshot, ...(archivedBoard ? { archivedAt: 5 } : {}) },
      200,
      {
        "X-Board-Seq": String(boardSeq),
      },
    );
  }
  if (path === "/boards/b1/export" && method === "GET") {
    return respond({ formatVersion: 1, boards: [board()] });
  }
  const contextMatch = /^\/boards\/b1\/cards\/([^/]+)\/context$/.exec(path);
  if (contextMatch && method === "GET") {
    if (intentEndpointMissing) return respond({ message: "not found" }, 404);
    const context = cardContext(contextMatch[1]!);
    if (context.card === null) {
      return respond({ message: "Card not found", code: "not_found" }, 404, {
        "X-Janosik-Intent-API": "1",
      });
    }
    return respond(context);
  }
  const intentMatch = /^\/boards\/b1\/cards\/([^/]+)(?:\/(claim|move))?$/.exec(
    path,
  );
  if (
    intentMatch &&
    (method === "POST" || method === "PATCH") &&
    intentEndpointMissing
  ) {
    return respond({ message: "not found" }, 404);
  }
  if (intentMatch && (method === "POST" || method === "PATCH")) {
    const [, cardId, intent] = intentMatch;
    const request = body as {
      ifMatch?: number;
      ifMatchVersions?: Record<string, number>;
      release?: boolean;
      leaseMs?: number;
      toColumnId?: string;
      position?: number;
      title?: string;
      description?: string;
    };
    if (request.ifMatch !== undefined && request.ifMatch !== boardSeq) {
      return respond(
        {
          conflict: "version",
          currentVersion: boardSeq,
          versions: { [`card:${cardId}`]: boardSeq },
        },
        409,
      );
    }
    const pinned = request.ifMatchVersions?.[`card:${cardId}`];
    if (pinned !== undefined) {
      if (staleWrites > 0) {
        staleWrites -= 1;
        boardSeq += 1;
        if (doneAfterMoveConflict && intent === "move") {
          boardWorkflow = {
            schemaVersion: 1,
            enabled: false,
            doneColumnIds: ["col2"],
            transitions: [],
          };
        }
        return respond(
          {
            conflict: "version",
            currentVersion: boardSeq,
            versions: { [`card:${cardId}`]: boardSeq },
          },
          409,
        );
      }
      if (pinned !== boardSeq) {
        return respond(
          {
            conflict: "version",
            currentVersion: boardSeq,
            versions: { [`card:${cardId}`]: boardSeq },
          },
          409,
        );
      }
    }
    const current = cardContext(cardId);
    const seq = ++boardSeq;
    const versions = {
      "board:b1": 2,
      [`card:${cardId}`]: seq,
      [`column:${current.columnId ?? "col1"}`]: 1,
    };
    if (intent === "claim") {
      const release = request.release === true;
      return respond({
        seq,
        versions,
        card: {
          ...current.card,
          ...(release
            ? {}
            : {
                claimedBy: "u1",
                leaseUntil: Date.now() + (request.leaseMs ?? 900_000),
              }),
        },
        columnId: current.columnId,
        claimedBy: release ? null : "u1",
        leaseUntil: release ? null : Date.now() + (request.leaseMs ?? 900_000),
        results: [{ seq, versions }],
      });
    }
    if (intent === "move") {
      const target =
        request.toColumnId ??
        current.columnId ??
        current.columns[0]?.id ??
        "col1";
      const targetTitle =
        current.columns.find((column) => column.id === target)?.title ?? "Todo";
      return respond({
        seq,
        versions,
        card: current.card,
        columnId: target,
        fromColumnId: current.columnId ?? "col1",
        toColumnId: target,
        toIndex: request.position ?? 0,
        columnTitle: targetTitle,
        results: [{ seq, versions }],
      });
    }
    return respond({
      seq,
      versions,
      card: {
        ...current.card,
        ...(request.title !== undefined ? { title: request.title } : {}),
        ...(request.description !== undefined
          ? { description: request.description }
          : {}),
      },
      columnId: current.columnId,
      results: [{ seq, versions }],
    });
  }
  if (path === "/boards/b2" && method === "GET") {
    // A board too large for one JSON response.
    const cards = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [
        `c${i}`,
        { id: `c${i}`, title: "x".repeat(150), labelIds: [], createdAt: 1 },
      ]),
    );
    const big = board(cards);
    big.columns[0]!.cardIds = Object.keys(cards);
    return respond({ ...big, id: "b2" }, 200, { "X-Board-Seq": "1" });
  }
  if (path === "/boards/b3" && method === "GET") {
    // An empty Backlog: nothing is ready to work.
    return respond(
      {
        id: "b3",
        title: "Empty",
        columns: [{ id: "col1", title: "Backlog", cardIds: [], createdAt: 1 }],
        cards: {},
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
      200,
      { "X-Board-Seq": "1" },
    );
  }
  if (path === "/boards/b1/members" && method === "GET") {
    return respond([{ userId: "u1", role: "ADMIN" }]);
  }
  if (path === "/auth/me" && method === "GET") {
    return respond({
      id: "u1",
      email: "user@example.com",
      displayName: "Test user",
      avatarColor: "teal",
      avatarPath: null,
      emailVerifiedAt: 123,
      impersonatedBy: null,
      createdAt: 1,
      token: { id: "tok1", name: "CI", scopePreset: "worker" },
      session: null,
      server: { version: "0.2.0", apiVersion: "1" },
    });
  }
  const planMatch = /^\/boards\/([^/]+)\/plans(\/apply)?$/.exec(path);
  if (planMatch && method === "POST") {
    const [, planBoard, action] = planMatch;
    const request = body as {
      commands: Array<{ commandId: string; action: { type: string } }>;
      planHash?: string;
    };
    if (action === "/apply") {
      return respond({
        runId: "run-plan-1",
        planHash: request.planHash ?? "b".repeat(64),
        results: request.commands.map((_command, index) => ({
          seq: boardSeq + index + 1,
          versions: { [`board:${planBoard}`]: 2 },
          runId: "run-plan-1",
        })),
      });
    }
    return respond({
      dryRun: true,
      schemaVersion: 1,
      boardId: planBoard,
      planHash: "b".repeat(64),
      plan: {
        schemaVersion: 1,
        boardId: planBoard,
        commands: request.commands.map((command) => ({
          commandId: command.commandId,
          action: command.action,
        })),
      },
      commandCount: request.commands.length,
      cardCreates: request.commands.filter(
        (command) => command.action.type === "ADD_CARD",
      ).length,
      limits: { commands: 100, cards: 50 },
      requirement: {
        kind: "custom",
        requiresApproval: false,
        requiredScope: "worker",
        action: "batch",
        risk: "low",
        summary: `Apply ${request.commands.length} commands`,
      },
      diff: [
        {
          touch: "card:k1",
          kind: "update",
          before: { title: "First" },
          after: { title: "Second" },
          fields: ["title"],
        },
      ],
      warnings: [],
      conflicts: [],
      canApply: true,
    });
  }

  const runMatch =
    /^\/boards\/([^/]+)\/runs(?:\/([^/]+)(\/revert\/preview)?)?$/.exec(path);
  if (runMatch) {
    const [, runBoard, runId, action] = runMatch;
    const runDto = {
      id: runId ?? "run-1",
      boardId: runBoard,
      apiTokenId: "tok1",
      agentSessionId: null,
      actorId: "u1",
      kind: "batch",
      status: "applied",
      clientRunId: null,
      planHash: null,
      approvalId: null,
      commandCount: 1,
      firstSeq: 4,
      lastSeq: 4,
      revertsRunId: null,
      createdAt: 1,
      appliedAt: 1,
      revertedAt: null,
    };
    if (action === "/revert/preview" && method === "POST") {
      return respond({
        dryRun: true,
        run: runDto,
        conflicts: [],
        canRevert: true,
      });
    }
    if (runId === undefined && method === "GET") {
      return respond([runDto]);
    }
    if (runId !== undefined && method === "GET") {
      return respond({
        run: runDto,
        commands: [
          {
            seq: 4,
            action: { type: "UPDATE_CARD", boardId: runBoard, cardId: "k1" },
            actorId: "u1",
            commandId: "cmd-1",
            touches: ["card:k1"],
            runId: runDto.id,
          },
        ],
        preimages: {},
      });
    }
  }

  const approval =
    /^\/boards\/([^/]+)\/approvals(?:\/([^/]+)(\/cancel|\/decision)?)?$/.exec(
      path,
    );
  if (approval) {
    const [, approvalBoard, approvalId, action] = approval;
    const request = body as
      { kind?: string; cardId?: string; plan?: unknown } | undefined;
    const dto = {
      id: approvalId ?? "apr-1",
      boardId: approvalBoard,
      cardId: request?.cardId ?? null,
      requestedBy: "u1",
      requestedByTokenId: "tok1",
      agentSessionId: null,
      kind: request?.kind ?? "destructive",
      actionType: "DELETE_CARD",
      summary: "Apply DELETE_CARD (1 command)",
      risk: "medium",
      planHash: "a".repeat(64),
      status:
        action === "/cancel"
          ? "cancelled"
          : action === "/decision"
            ? "approved"
            : approvalStatus,
      expiresAt: Date.now() + 3_600_000,
      decidedBy: action === "/decision" ? "u1" : null,
      decidedAt: action === "/decision" ? Date.now() : null,
      decisionComment: null,
      runId: approvalStatus === "consumed" ? "run-1" : null,
      consumedAt: approvalStatus === "consumed" ? Date.now() : null,
      createdAt: Date.now(),
      plan: request?.plan ?? {
        schemaVersion: 1,
        boardId: approvalBoard,
        commands: [],
      },
    };
    if (method === "POST" && approvalId === undefined) {
      return respond(dto, 201);
    }
    if (method === "GET" && approvalId === undefined) {
      return respond([dto]);
    }
    if (method === "GET" || method === "POST") {
      return respond(dto);
    }
  }

  const agentSession =
    /^\/boards\/([^/]+)\/agent-sessions(?:\/([^/]+)\/(heartbeat|end))?$/.exec(
      path,
    );
  if (agentSession && method === "POST") {
    const [, boardId, sessionId, action] = agentSession;
    return respond(
      {
        id: sessionId ?? `sess-${boardId}`,
        userId: "u1",
        apiTokenId: "tok1",
        boardId,
        name: (body as { name?: string } | undefined)?.name ?? null,
        clientName: null,
        model: null,
        status: action === "end" ? "completed" : "active",
        currentCardId: null,
        currentRunId: null,
        startedAt: 1,
        lastHeartbeatAt: 2,
        stale: false,
        paused: false,
        pausedAt: null,
        pausedBy: null,
        pausedReason: null,
        pauseScope: null,
        endedAt: action === "end" ? 3 : null,
        endReason: action === "end" ? "completed" : null,
        summary: null,
      },
      action === undefined && sessionId === undefined ? 201 : 200,
    );
  }
  if (path === "/boards/b1/commands" && method === "POST") {
    const request = body as {
      ifMatch?: number;
      action: { type: string; dueDate?: number };
    };
    commandPayload = commandPayload || JSON.stringify(request);
    if (
      approvalRequiredFor === request.action.type &&
      headers["X-Approval-Id"] === undefined
    ) {
      return respond(
        {
          message: "Human approval is required for this destructive action",
          code: "approval_required",
          approvalId: "apr-1",
          planHash: "a".repeat(64),
          expiresAt: Date.now() + 3_600_000,
          retryable: false,
        },
        409,
      );
    }
    if (request.ifMatch !== undefined) {
      if (staleWrites > 0) {
        staleWrites -= 1;
        boardSeq += 1;
        return respond({ conflict: "version", currentVersion: boardSeq }, 409);
      }
      if (request.ifMatch !== boardSeq) {
        return respond({ conflict: "version", currentVersion: boardSeq }, 409);
      }
    }
    switch (request.action.type) {
      case "RENAME_BOARD":
        return respond({ conflict: "wip" }, 409);
      case "SET_CHECKLIST_ITEM_DONE":
        // The reducer found nothing to change: no versions.
        return respond({ seq: ++boardSeq, versions: {} });
      case "SET_CARD_DUE_DATE":
        return respond({ message: "boom" }, 500);
      default:
        return respond({ seq: ++boardSeq, versions: { "board:b1": 2 } });
    }
  }
  const batchMatch = /^\/boards\/([^/]+)\/commands\/batch$/.exec(path);
  if (batchMatch && method === "POST") {
    // TASK-160: apply every command in order, one result each. A failing
    // member fails the whole batch (the real server rolls it back).
    const boardId = batchMatch[1];
    const request = body as {
      commands: Array<{
        ifMatch?: number;
        action: { type: string; dueDate?: number };
      }>;
    };
    commandPayload = commandPayload || JSON.stringify(request);
    const results: Array<{ seq: number; versions: Record<string, number> }> =
      [];
    for (const command of request.commands) {
      if (command.ifMatch !== undefined) {
        if (staleWrites > 0) {
          staleWrites -= 1;
          boardSeq += 1;
          return respond(
            { conflict: "version", currentVersion: boardSeq },
            409,
          );
        }
        if (command.ifMatch !== boardSeq) {
          return respond(
            { conflict: "version", currentVersion: boardSeq },
            409,
          );
        }
      }
      switch (command.action.type) {
        case "RENAME_BOARD":
          return respond({ conflict: "wip" }, 409);
        case "SET_CHECKLIST_ITEM_DONE":
          results.push({ seq: ++boardSeq, versions: {} });
          break;
        case "SET_CARD_DUE_DATE":
          return respond({ message: "boom" }, 500);
        default:
          results.push({
            seq: ++boardSeq,
            versions: { [`board:${boardId}`]: 2 },
          });
      }
    }
    return respond({ results, runId: "batch-run" });
  }
  const commentMatch = /^\/cards\/([^/]+)\/comments$/.exec(path);
  if (commentMatch && method === "GET") {
    // No seeded comments: the DoD gate finds no evidence.
    return respond({ items: [], nextCursor: null });
  }
  if (commentMatch && method === "POST") {
    const request = body as { text: string; kind?: string };
    return respond(
      {
        id: "cm1",
        cardId: commentMatch[1],
        authorId: "u1",
        text: request.text,
        kind: request.kind ?? "note",
        createdAt: 1,
      },
      201,
    );
  }
  const searchMatch = /^\/boards\/([^/]+)\/search$/.exec(path);
  if (searchMatch && method === "GET") {
    if (searchFailure !== null)
      return respond({ message: "search failed" }, searchFailure);
    // Only a comment-only match is modelled; everything else falls through
    // to the client-side title/description/checklist match.
    const q = searchParams.get("q") ?? "";
    return respond({ cardIds: q === "incomment" ? ["k1"] : [] });
  }
  return respond({ message: "not found" }, 404);
}

/** The first text block of a tool result, without depending on its shape. */
function firstText(result: unknown): string {
  const blocks =
    (result as { content?: Array<{ text?: string }> }).content ?? [];
  return blocks[0]?.text ?? "";
}

async function connect(overrides: Partial<Config> = {}) {
  const server = createServer({
    url: "http://api.test",
    token: "jnk_test",
    appBase: "",
    allowFs: false,
    fsRoot: null,
    toolsets: new Set(TOOLSETS),
    readOnly: false,
    ...overrides,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  calls = [];
  boardSeq = 3;
  staleWrites = 0;
  commandPayload = "";
  cardOverrides = {};
  searchFailure = null;
  archivedBoard = false;
  boardWorkflow = null;
  boardEpics = [];
  approvalStatus = "pending";
  approvalRequiredFor = null;
  readyEndpointMissing = false;
  intentEndpointMissing = false;
  doneAfterMoveConflict = false;
  readyNetworkFailures = 0;
  readyCapacityFailures = 0;
  readyRateLimitFailures = 0;
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (readyNetworkFailures > 0) {
      readyNetworkFailures -= 1;
      calls.push({
        path: url.pathname.replace("/api/v1", ""),
        method,
        body: undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return Promise.reject(new TypeError("fetch failed"));
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      path: url.pathname.replace("/api/v1", ""),
      method,
      body,
      headers,
    });
    return Promise.resolve(
      fakeApi(
        url.pathname.replace("/api/v1", ""),
        method,
        body,
        url.searchParams,
        headers,
      ),
    );
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("janosik MCP server", () => {
  it("keeps epic membership and board-wide progress in a sliced summary", async () => {
    boardEpics = [
      {
        id: "epic-1",
        title: "Launch",
        description: "Full notes",
        color: "rose",
        status: "active",
        position: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    cardOverrides = { k1: { ...board().cards.k1, epicId: "epic-1" } };
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_get_board",
      arguments: {
        boardId: "b1",
        columnId: "col1",
        detail: "summary",
        response_format: "json",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      board: {
        epics: [{ id: "epic-1", progress: { total: 1, done: 0, open: 1 } }],
        cards: { k1: { epicId: "epic-1" } },
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain(
      "Full notes",
    );
    await client.close();
  });

  it("writes epic CRUD and card membership over the command transport", async () => {
    const client = await connect();
    const created = await client.callTool({
      name: "janosik_create_epic",
      arguments: {
        boardId: "b1",
        epicId: "epic-1",
        title: "Launch",
        dueDate: "2026-12-01",
      },
    });
    expect(created.isError).toBeFalsy();
    expect(calls.at(-1)?.body).toMatchObject({
      action: {
        type: "ADD_EPIC",
        epic: { id: "epic-1", title: "Launch", dueDate: Date.UTC(2026, 11, 1) },
      },
    });
    const updated = await client.callTool({
      name: "janosik_update_epic",
      arguments: {
        boardId: "b1",
        epicId: "epic-1",
        description: null,
        status: "completed",
      },
    });
    expect(updated.isError).toBeFalsy();
    expect(calls.at(-1)?.body).toMatchObject({
      commands: [
        {
          action: { type: "UPDATE_EPIC", epicId: "epic-1", description: null },
        },
        {
          action: {
            type: "SET_EPIC_STATUS",
            epicId: "epic-1",
            status: "completed",
          },
        },
      ],
    });
    await client.callTool({
      name: "janosik_create_card",
      arguments: {
        boardId: "b1",
        columnId: "col1",
        title: "Subtask",
        epicId: "epic-1",
      },
    });
    expect(calls.at(-1)?.body).toMatchObject({
      commands: [{ action: { type: "ADD_CARD", epicId: "epic-1" } }],
    });
    await client.callTool({
      name: "janosik_update_card",
      arguments: {
        boardId: "b1",
        cardId: "k1",
        title: "Retitled",
        epicId: null,
      },
    });
    expect(calls.at(-1)?.body).toMatchObject({
      commands: [
        { action: { type: "UPDATE_CARD", title: "Retitled" } },
        { action: { type: "SET_CARD_EPIC", cardId: "k1", epicId: null } },
      ],
    });
    approvalRequiredFor = "DELETE_EPIC";
    const deleteArgs = {
      boardId: "b1",
      epicId: "epic-1",
      commandId: "delete-epic-1",
    };
    const pending = await client.callTool({
      name: "janosik_delete_epic",
      arguments: deleteArgs,
    });
    expect(pending.isError).toBe(true);
    const approved = await client.callTool({
      name: "janosik_delete_epic",
      arguments: { ...deleteArgs, approvalId: "approval-epic" },
    });
    expect(approved.isError).toBeFalsy();
    expect(calls.at(-1)?.body).toMatchObject({
      commandId: "delete-epic-1",
      action: { type: "DELETE_EPIC", epicId: "epic-1" },
    });
    expect(calls.at(-1)?.headers?.["X-Approval-Id"]).toBe("approval-epic");
    await client.close();
  });

  it("registers the full tool catalog with every toolset", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    // Pinned exactly so a dropped or renamed tool fails loudly. TASK-166
    // removed the invitation and profile tools (session-only routes);
    // TASK-166.7 added three read-only run tools; TASK-166.8 added the
    // plan/apply pair.
    expect(names.length).toBe(87);
    expect(names).toContain("janosik_list_boards");
    expect(names).toContain("janosik_create_card");
    expect(names).toContain("janosik_request_approval");
    expect(names).toContain("janosik_get_approval");
    expect(names).toContain("janosik_wait_for_decision");
    expect(names).toContain("janosik_cancel_approval");
    expect(names).toContain("janosik_plan_changes");
    expect(names).toContain("janosik_apply_plan");
    expect(names).toContain("janosik_list_runs");
    expect(names).toContain("janosik_get_run");
    expect(names).toContain("janosik_preview_run_revert");
    // Rollback itself is human-only (ADR D17): no MCP apply tool.
    expect(names).not.toContain("janosik_revert_run");
    expect(names).not.toContain("janosik_apply_run_revert");
    // Decision is session-only: an agent must not approve its own plan.
    expect(names).not.toContain("janosik_decide_approval");
    expect(names).toContain("janosik_set_column_accent");
    expect(names).toContain("janosik_claim_card");
    expect(names).toContain("janosik_release_card");
    expect(names).toContain("janosik_set_card_task_spec");
    expect(names).toContain("janosik_create_share");
    expect(names).toContain("janosik_upload_attachment");
    // TASK-166: removing a link is a reversible relationship edit, not a
    // destructive action (ADR §7.1/§13.4.6).
    const removeLink = tools.find(
      (tool) => tool.name === "janosik_remove_card_link",
    );
    expect(removeLink?.annotations?.destructiveHint).toBe(false);
    // Every tool is prefixed for coexistence with other servers.
    expect(names.every((name) => name.startsWith("janosik_"))).toBe(true);
    await client.close();
  });

  it("lists boards as markdown by default", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_list_boards",
      arguments: {},
    });
    expect(firstText(result)).toContain("Alpha");
    expect(result.structuredContent).toMatchObject({
      boards: [{ id: "b1" }],
    });
    await client.close();
  });

  it("returns structured mutation results and forwards an idempotency key", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_create_board",
      arguments: { title: "New board", idempotencyKey: "create-board-key" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      resourceId: "b-new",
      board: { id: "b-new", title: "New board" },
    });
    const call = calls.find(
      (entry) => entry.path === "/boards" && entry.method === "POST",
    );
    expect(call?.headers?.["Idempotency-Key"]).toBe("create-board-key");
    await client.close();
  });

  it("replays import_board with the same key and returns structured ids", async () => {
    const client = await connect();
    const args = {
      envelope: { app: "janosik", schemaVersion: 3, boards: [] },
      idempotencyKey: "import-key-1",
    };
    const first = await client.callTool({
      name: "janosik_import_board",
      arguments: args,
    });
    const second = await client.callTool({
      name: "janosik_import_board",
      arguments: args,
    });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({
      ok: true,
      resourceId: "b-import",
      boards: [{ id: "b-import" }],
    });
    expect(second.structuredContent).toMatchObject({
      resourceId: "b-import",
    });
    const imports = calls.filter(
      (call) => call.path === "/boards/import" && call.method === "POST",
    );
    expect(imports).toHaveLength(2);
    expect(imports.map((call) => call.headers?.["Idempotency-Key"])).toEqual([
      "import-key-1",
      "import-key-1",
    ]);
    await client.close();
  });

  it("forwards an idempotency key when creating a share", async () => {
    const client = await connect();
    const args = {
      boardId: "b1",
      mode: "live",
      expiresInHours: 24,
      idempotencyKey: "share-key-1",
    };
    const result = await client.callTool({
      name: "janosik_create_share",
      arguments: args,
    });
    const retry = await client.callTool({
      name: "janosik_create_share",
      arguments: { ...args, expiresInHours: 25 },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      resourceId: "share-1",
    });
    expect(retry.structuredContent).toMatchObject({
      ok: true,
      resourceId: "share-1",
    });
    const shareCalls = calls.filter(
      (entry) => entry.path === "/boards/b1/shares" && entry.method === "POST",
    );
    expect(shareCalls.map((call) => call.headers?.["Idempotency-Key"])).toEqual(
      ["share-key-1", "share-key-1"],
    );
    expect(shareCalls.map((call) => call.body)).toEqual([
      expect.objectContaining({
        expiresInHours: 24,
        expiresAt: expect.any(String),
      }),
      expect.objectContaining({
        expiresInHours: 25,
        expiresAt: expect.any(String),
      }),
    ]);
    await client.close();
  });

  it("keeps duplicate_card args stable across a keyed retry", async () => {
    const client = await connect();
    const args = {
      boardId: "b1",
      cardId: "k1",
      idempotencyKey: "duplicate-key-1",
    };
    await client.callTool({ name: "janosik_duplicate_card", arguments: args });
    await client.callTool({ name: "janosik_duplicate_card", arguments: args });
    const writes = calls.filter(
      (call) => call.path === "/boards/b1/commands" && call.method === "POST",
    );
    expect(writes).toHaveLength(2);
    const bodies = writes.map((call) => call.body as Record<string, unknown>);
    const commands = bodies.map(
      (body) => (body as { commandId: string }).commandId,
    );
    expect(commands[0]).toBe(commands[1]);
    expect((bodies[0]!.action as { newCardId: string }).newCardId).toBe(
      (bodies[1]!.action as { newCardId: string }).newCardId,
    );
    expect(writes.map((call) => call.headers?.["Idempotency-Key"])).toEqual([
      "duplicate-key-1",
      "duplicate-key-1",
    ]);
    await client.close();
  });

  it("rejects a blank duplicate title before sending a command", async () => {
    const client = await connect();
    const before = calls.filter(
      (call) => call.path === "/boards/b1/commands" && call.method === "POST",
    ).length;
    const result = await client.callTool({
      name: "janosik_duplicate_card",
      arguments: { boardId: "b1", cardId: "k1", title: "   " },
    });
    expect(result.isError).toBe(true);
    expect(
      calls.filter(
        (call) => call.path === "/boards/b1/commands" && call.method === "POST",
      ),
    ).toHaveLength(before);
    await client.close();
  });

  it("rejects a blank duplicate column title before sending a command", async () => {
    const client = await connect();
    const before = calls.filter(
      (call) => call.path === "/boards/b1/commands" && call.method === "POST",
    ).length;
    const result = await client.callTool({
      name: "janosik_duplicate_column",
      arguments: { boardId: "b1", columnId: "col1", title: "   " },
    });
    expect(result.isError).toBe(true);
    expect(
      calls.filter(
        (call) => call.path === "/boards/b1/commands" && call.method === "POST",
      ),
    ).toHaveLength(before);
    await client.close();
  });

  it("reads the workflow and validates a card's moves", async () => {
    boardWorkflow = {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: "col1",
      doneColumnIds: ["col2"],
      transitions: [
        {
          id: "todo-done",
          fromColumnId: "col1",
          toColumnId: "col2",
          allowedRoles: ["ADMIN", "MEMBER"],
        },
      ],
    };
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_get_workflow",
      arguments: { boardId: "b1", cardId: "k1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      enabled: true,
      initialColumnId: "col1",
      doneColumnIds: ["col2"],
      transitions: [
        {
          id: "todo-done",
          fromTitle: "Todo",
          toTitle: "Done",
          roles: ["ADMIN", "MEMBER"],
        },
      ],
      card: {
        id: "k1",
        columnId: "col1",
        allowedToColumnIds: ["col2"],
      },
    });
    expect(firstText(result)).toContain("Todo → Done");
    await client.close();
  });

  it("creates a card as a stamped ADD_CARD command", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_create_card",
      arguments: { boardId: "b1", columnId: "col1", title: "New task" },
    });
    const call = calls.find((c) => c.path === "/boards/b1/commands/batch");
    const action = (
      call?.body as { commands: Array<{ action: Record<string, unknown> }> }
    ).commands[0]!.action;
    expect(action).toMatchObject({
      type: "ADD_CARD",
      boardId: "b1",
      columnId: "col1",
      title: "New task",
    });
    expect(action.newCardId).toMatch(/^[0-9a-f-]{36}$/);
    expect(firstText(result)).toContain("New task");
    expect(result.structuredContent).toMatchObject({
      ok: true,
      resourceId: action.newCardId,
      seq: boardSeq,
      runId: "batch-run",
    });
    await client.close();
  });

  it("maps a WIP conflict to an actionable error result", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_rename_board",
      arguments: { boardId: "b1", title: "X" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/limit/i);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      status: 409,
      conflict: "wip",
    });
    await client.close();
  });

  it("reports a missing card as an error, not a success", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_get_card",
      arguments: { boardId: "b1", cardId: "missing" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not on board");
    await client.close();
  });

  it("does not register account-only tools", async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const removed of [
      "janosik_update_profile",
      "janosik_list_invitations",
      "janosik_accept_invitation",
      "janosik_decline_invitation",
    ]) {
      expect(names).not.toContain(removed);
    }
    await client.close();
  });

  it("refuses attachment upload unless filesystem access is enabled", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_upload_attachment",
      arguments: { cardId: "c1", filePath: "/tmp/anything" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/JANOSIK_MCP_ALLOW_FS/);
    await client.close();
  });

  it("returns whoami as { user, token, session, server }", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_whoami",
      arguments: { response_format: "json" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      user: {
        id: "u1",
        email: "user@example.com",
        displayName: "Test user",
        avatarColor: "teal",
        emailVerifiedAt: 123,
        createdAt: 1,
      },
      token: { id: "tok1", name: "CI" },
      session: null,
      server: { version: "0.2.0", apiVersion: "1" },
    });
    expect(
      (result.structuredContent as { user: Record<string, unknown> }).user,
    ).not.toHaveProperty("token");
    await client.close();
  });

  it("starts a session and attaches X-Agent-Session to later writes", async () => {
    const client = await connect();
    const started = await client.callTool({
      name: "janosik_start_session",
      arguments: { boardId: "b1", name: "run-1", response_format: "json" },
    });
    expect(started.isError).toBeFalsy();
    expect(started.structuredContent).toMatchObject({
      session: { id: "sess-b1", boardId: "b1", status: "active" },
    });

    await client.callTool({
      name: "janosik_create_card",
      arguments: { boardId: "b1", columnId: "col1", title: "Attributed" },
    });
    const write = calls.find(
      (call) => call.path === "/boards/b1/commands/batch",
    );
    expect(write?.headers?.["X-Agent-Session"]).toBe("sess-b1");

    const heartbeat = await client.callTool({
      name: "janosik_heartbeat",
      arguments: { boardId: "b1", sessionId: "sess-b1", status: "idle" },
    });
    expect(heartbeat.isError).toBeFalsy();

    const ended = await client.callTool({
      name: "janosik_end_session",
      arguments: { boardId: "b1", sessionId: "sess-b1" },
    });
    expect(ended.isError).toBeFalsy();

    calls.length = 0;
    await client.callTool({
      name: "janosik_create_card",
      arguments: { boardId: "b1", columnId: "col1", title: "Unattributed" },
    });
    const after = calls.find(
      (call) => call.path === "/boards/b1/commands/batch",
    );
    expect(after?.headers?.["X-Agent-Session"]).toBeUndefined();
    await client.close();
  });

  it("scopes X-Agent-Session to the board that owns it", async () => {
    const client = await connect();
    const a = await client.callTool({
      name: "janosik_start_session",
      arguments: { boardId: "b1", response_format: "json" },
    });
    expect(a.structuredContent).toMatchObject({
      session: { id: "sess-b1" },
    });

    calls.length = 0;
    await client.callTool({
      name: "janosik_create_card",
      arguments: { boardId: "b2", columnId: "col1", title: "Elsewhere" },
    });
    const writeB = calls.find(
      (call) => call.path === "/boards/b2/commands/batch",
    );
    expect(writeB?.headers?.["X-Agent-Session"]).toBeUndefined();

    const b = await client.callTool({
      name: "janosik_start_session",
      arguments: { boardId: "b2", response_format: "json" },
    });
    expect(b.structuredContent).toMatchObject({
      session: { id: "sess-b2" },
    });

    calls.length = 0;
    await client.callTool({
      name: "janosik_create_card",
      arguments: { boardId: "b1", columnId: "col1", title: "Back on A" },
    });
    const writeA = calls.find(
      (call) => call.path === "/boards/b1/commands/batch",
    );
    expect(writeA?.headers?.["X-Agent-Session"]).toBe("sess-b1");
    await client.close();
  });

  it("leaves the account-level groups out by default", async () => {
    const client = await connect({ toolsets: new Set(DEFAULT_TOOLSETS) });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("janosik_create_card");
    for (const optIn of [
      "janosik_whoami",
      "janosik_invite_member",
      "janosik_create_share",
    ]) {
      expect(names).not.toContain(optIn);
    }
    await client.close();
  });

  it("registers only read-only tools in read-only mode", async () => {
    const client = await connect({ readOnly: true });
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    expect(tools.map((tool) => tool.name)).toContain("janosik_export_board");
    const exportResult = await client.callTool({
      name: "janosik_export_board",
      arguments: { boardId: "b1", response_format: "json" },
    });
    expect(exportResult.isError).toBeFalsy();
    const fileResult = await client.callTool({
      name: "janosik_export_board",
      arguments: { boardId: "b1", outputPath: "/tmp/export.json" },
    });
    expect(fileResult.isError).toBe(true);
    expect(firstText(fileResult)).toMatch(/read-only mode/);
    await client.close();
  });

  it.each([
    {
      allowFs: false,
      readOnly: false,
      message: /Filesystem access is disabled/,
    },
    { allowFs: true, readOnly: true, message: /read-only mode/ },
  ])(
    "keeps card reads available but refuses file output with $message",
    async ({ message, ...config }) => {
      const client = await connect(config);
      const { tools } = await client.listTools();
      for (const name of [
        "janosik_get_card",
        "janosik_get_run",
        "janosik_get_approval",
      ]) {
        const tool = tools.find((entry) => entry.name === name);
        expect(tool?.inputSchema.properties).toHaveProperty("outputPath");
        expect(tool?.annotations?.readOnlyHint).toBe(true);
      }

      const args = { boardId: "b1", cardId: "k1" };
      const inline = await client.callTool({
        name: "janosik_get_card",
        arguments: args,
      });
      expect(inline.structuredContent).toMatchObject({ card: { id: "k1" } });
      const file = await client.callTool({
        name: "janosik_get_card",
        arguments: { ...args, outputPath: "refused.json" },
      });
      expect(file.isError).toBe(true);
      expect(firstText(file)).toMatch(message);
      await client.close();
    },
  );

  it("marks optional document output as writable when local writes are enabled", async () => {
    const client = await connect({ allowFs: true, readOnly: false });
    const { tools } = await client.listTools();
    for (const name of [
      "janosik_get_card",
      "janosik_get_run",
      "janosik_get_approval",
    ]) {
      const tool = tools.find((entry) => entry.name === name);
      expect(tool?.inputSchema.properties).toHaveProperty("outputPath");
      expect(tool?.annotations?.readOnlyHint).toBe(false);
    }
    await client.close();
  });

  it("reports a command that changed nothing as an error", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_set_checklist_item_done",
      arguments: {
        boardId: "b1",
        cardId: "k1",
        checklistId: "nope",
        itemId: "nope",
        done: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/nothing changed/i);
    await client.close();
  });

  it("refuses an id that would re-target the request path", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_delete_comment",
      arguments: { commentId: "../boards/b1?" },
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
    await client.close();
  });

  it("validates create_card fields before the card exists", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_create_card",
      arguments: {
        boardId: "b1",
        columnId: "col1",
        title: "T",
        dueDate: "next friday",
      },
    });
    expect(result.isError).toBe(true);
    expect(
      calls.some((call) => call.path.startsWith("/boards/b1/commands")),
    ).toBe(false);
    await client.close();
  });

  it("reports a failed batch without claiming the card exists", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_create_card",
      arguments: {
        boardId: "b1",
        columnId: "col1",
        title: "T",
        dueDate: "2026-11-01T09:00:00Z",
      },
    });
    expect(result.isError).toBe(true);
    // The batch is atomic: the card was not created, so a plain retry is
    // safe — the error must not tell the agent a card now exists.
    expect(firstText(result)).toMatch(/500|boom/i);
    expect(firstText(result)).not.toMatch(/was created/);
    await client.close();
  });

  it("moves a card through the targeted intent and retries only that card", async () => {
    staleWrites = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k1", position: 2 },
    });
    expect(result.isError).toBeFalsy();
    const writes = calls.filter(
      (call) => call.path === "/boards/b1/cards/k1/move",
    );
    expect(writes).toHaveLength(2);
    const last = writes[1]!.body as {
      ifMatch?: number;
      ifMatchVersions: Record<string, number>;
      commandId: string;
    };
    expect(last.ifMatch).toBeUndefined();
    expect(last.ifMatchVersions).toHaveProperty("card:k1");
    // No full board read: only the one-card context.
    expect(calls.some((call) => call.path === "/boards/b1")).toBe(false);
    expect(
      calls.filter((call) => call.path === "/boards/b1/cards/k1/context"),
    ).toHaveLength(2);
    // The retry reuses the idempotency key; the first intent never applied.
    expect((writes[0]!.body as { commandId: string }).commandId).toBe(
      last.commandId,
    );
    await client.close();
  });

  it("keeps expectedVersion as the explicit full-board CAS mode", async () => {
    const client = await connect();
    const expected = boardSeq;
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: {
        boardId: "b1",
        cardId: "k1",
        position: 2,
        expectedVersion: expected,
      },
    });
    expect(result.isError).toBeFalsy();
    const write = calls.find((call) => call.path === "/boards/b1/commands");
    expect(write?.body).toMatchObject({ ifMatch: expected });
    expect(calls.some((call) => call.path === "/boards/b1/cards/k1/move")).toBe(
      false,
    );
    await client.close();
  });

  it("updates a card through the targeted PATCH without reading the board", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_update_card",
      arguments: { boardId: "b1", cardId: "k1", description: "mine" },
    });
    expect(result.isError).toBeFalsy();
    expect(calls.some((call) => call.path === "/boards/b1")).toBe(false);
    const patch = calls.find(
      (call) => call.path === "/boards/b1/cards/k1" && call.method === "PATCH",
    );
    expect(patch?.body).toMatchObject({
      description: "mine",
      ifMatchVersions: { "card:k1": expect.any(Number) },
    });
    expect((patch?.body as { ifMatch?: number }).ifMatch).toBeUndefined();
    await client.close();
  });

  it("retries a patch version conflict on the same card only", async () => {
    staleWrites = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_update_card",
      arguments: { boardId: "b1", cardId: "k1", title: "Renamed" },
    });
    expect(result.isError).toBeFalsy();
    const writes = calls.filter(
      (call) => call.path === "/boards/b1/cards/k1" && call.method === "PATCH",
    );
    expect(writes).toHaveLength(2);
    expect(calls.some((call) => call.path === "/boards/b1")).toBe(false);
    expect((writes[0]!.body as { commandId: string }).commandId).toBe(
      (writes[1]!.body as { commandId: string }).commandId,
    );
    await client.close();
  });

  it("claims a card through the targeted intent without reading the board", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_claim_card",
      arguments: { boardId: "b1", cardId: "k1", leaseMs: 60_000 },
    });
    expect(result.isError).toBeFalsy();
    expect(calls.some((call) => call.path === "/boards/b1")).toBe(false);
    const claim = calls.find(
      (call) => call.path === "/boards/b1/cards/k1/claim",
    );
    expect(claim?.body).toMatchObject({
      leaseMs: 60_000,
      ifMatchVersions: { "card:k1": expect.any(Number) },
    });
    expect((claim?.body as { ifMatch?: number }).ifMatch).toBeUndefined();
    await client.close();
  });

  it("falls back to the command API on a pre-200.7 server", async () => {
    intentEndpointMissing = true;
    const client = await connect();
    for (const [name, arguments_] of [
      ["janosik_claim_card", { cardId: "k1", leaseMs: 60_000 }],
      ["janosik_move_card", { cardId: "k1", position: 1 }],
      ["janosik_update_card", { cardId: "k1", title: "Legacy" }],
      [
        "janosik_update_card",
        {
          cardId: "k1",
          description: "Legacy text",
          expectedDescription: "original",
        },
      ],
      ["janosik_release_card", { cardId: "k1" }],
    ] as const) {
      const result = await client.callTool({
        name,
        arguments: { boardId: "b1", ...arguments_ },
      });
      expect(result.isError).toBeFalsy();
    }
    expect(
      calls.filter(
        (call) => call.path === "/boards/b1/commands" && call.method === "POST",
      ).length,
    ).toBeGreaterThanOrEqual(5);
    await client.close();
  });

  it("reports a genuine missing card on an intent-capable server", async () => {
    const client = await connect();
    for (const [name, extra] of [
      ["janosik_move_card", { position: 1 }],
      ["janosik_update_card", { title: "X" }],
      ["janosik_claim_card", { leaseMs: 60_000 }],
      ["janosik_release_card", {}],
    ] as const) {
      const result = await client.callTool({
        name,
        arguments: { boardId: "b1", cardId: "missing", ...extra },
      });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain("not on board");
    }
    expect(
      calls.some(
        (call) => call.path === "/boards/b1/commands" && call.method === "POST",
      ),
    ).toBe(false);
    await client.close();
  });

  it("refuses a compare-and-set update when the description changed", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_update_card",
      arguments: {
        boardId: "b1",
        cardId: "k1",
        description: "mine",
        expectedDescription: "what I read earlier",
      },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/changed since you read it/);
    expect(calls.some((call) => call.path === "/boards/b1/commands")).toBe(
      false,
    );
    await client.close();
  });

  it("finds archived cards when include_archived is set", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_search_cards",
      arguments: { boardId: "b1", query: "zebra", include_archived: true },
    });
    expect(result.structuredContent).toMatchObject({
      results: [{ id: "k9", archived: true }],
    });
    await client.close();
  });

  it("refuses an oversized JSON board instead of truncating it", async () => {
    const client = await connect();
    const whole = await client.callTool({
      name: "janosik_get_board",
      arguments: { boardId: "b2", response_format: "json" },
    });
    expect(whole.isError).toBe(true);
    expect(firstText(whole)).toMatch(/columnId/);

    const slice = await client.callTool({
      name: "janosik_get_board",
      arguments: { boardId: "b1", columnId: "col2", response_format: "json" },
    });
    const board = (slice.structuredContent as { board: { columns: unknown[] } })
      .board;
    expect(board.columns).toHaveLength(1);
    await client.close();
  });

  it("projects a board in summary mode without the descriptions", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_get_board",
      arguments: { boardId: "b1", detail: "summary", response_format: "json" },
    });
    expect(result.isError).toBeFalsy();
    const summary = (
      result.structuredContent as {
        board: { cards: Record<string, Record<string, unknown>> };
      }
    ).board;
    const k1 = summary.cards.k1!;
    expect(k1).not.toHaveProperty("description");
    expect(k1.descriptionChars).toBe("original".length);
    expect(k1.columnId).toBe("col1");
    // The markdown form flags that it is a summary (the JSON is the payload).
    const markdown = await client.callTool({
      name: "janosik_get_board",
      arguments: { boardId: "b1", detail: "summary" },
    });
    expect(firstText(markdown)).toMatch(/summary/i);
    await client.close();
  });

  it("adds a description snippet in full search mode", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_search_cards",
      arguments: { boardId: "b1", query: "first", detail: "full" },
    });
    expect(result.structuredContent).toMatchObject({
      results: [{ id: "k1", description: "original" }],
    });
    await client.close();
  });

  it("omits the description in the default search mode", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_search_cards",
      arguments: { boardId: "b1", query: "first" },
    });
    const results = (result.structuredContent as { results: unknown[] })
      .results;
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("description");
    await client.close();
  });

  it("posts a typed comment and forwards its idempotency key", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_add_comment",
      arguments: {
        cardId: "k1",
        text: "stuck",
        kind: "blocker",
        idempotencyKey: "comment-key-1",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      resourceId: "cm1",
    });
    const call = calls.find(
      (entry) => entry.path === "/cards/k1/comments" && entry.method === "POST",
    );
    expect(call?.body).toMatchObject({ text: "stuck", kind: "blocker" });
    expect(call?.headers?.["Idempotency-Key"]).toBe("comment-key-1");
    expect(calls.some((entry) => entry.path === "/boards/b1")).toBe(false);
    expect(firstText(result)).toMatch(/blocker/);
    await client.close();
  });

  it("finds a card by a checklist item", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_search_cards",
      arguments: { boardId: "b1", query: "widget migration" },
    });
    expect(result.structuredContent).toMatchObject({ results: [{ id: "k2" }] });
    await client.close();
  });

  it("includes cards whose comments match the query", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_search_cards",
      arguments: { boardId: "b1", query: "incomment" },
    });
    expect(result.structuredContent).toMatchObject({ results: [{ id: "k1" }] });
    await client.close();
  });

  it("reports search API failures instead of silently omitting comment matches", async () => {
    searchFailure = 429;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_search_cards",
      arguments: { boardId: "b1", query: "incomment" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/rate limit/i);
    await client.close();
  });

  it("returns the board version so a write can pin it", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_get_board",
      arguments: { boardId: "b1", response_format: "json" },
    });
    expect(result.structuredContent).toMatchObject({ seq: boardSeq });
    await client.close();
  });

  it("pins a write to expectedVersion as an ifMatch precondition", async () => {
    const client = await connect();
    // The fake advances `boardSeq` as it applies, so capture it first.
    const version = boardSeq;
    await client.callTool({
      name: "janosik_set_card_priority",
      arguments: {
        boardId: "b1",
        cardId: "k1",
        priority: "high",
        expectedVersion: version,
      },
    });
    const write = calls.find((call) => call.path === "/boards/b1/commands");
    expect((write?.body as { ifMatch?: number }).ifMatch).toBe(version);
    await client.close();
  });

  it("refuses a write pinned to a stale version", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_set_card_priority",
      arguments: {
        boardId: "b1",
        cardId: "k1",
        priority: "high",
        expectedVersion: boardSeq - 1,
      },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("reuses a client id as the idempotency key on a create retry", async () => {
    const client = await connect();
    const args = {
      boardId: "b1",
      columnId: "col1",
      cardId: "my-card",
      title: "Stable",
    };
    await client.callTool({ name: "janosik_create_card", arguments: args });
    await client.callTool({ name: "janosik_create_card", arguments: args });
    const writes = calls.filter(
      (call) => call.path === "/boards/b1/commands/batch",
    );
    expect(writes).toHaveLength(2);
    expect(
      writes.map(
        (call) =>
          (call.body as { commands: Array<{ commandId: string }> }).commands[0]!
            .commandId,
      ),
    ).toEqual(["my-card", "my-card"]);
    expect(
      writes.map(
        (call) =>
          (
            call.body as {
              commands: Array<{ action: { newCardId: string } }>;
            }
          ).commands[0]!.action.newCardId,
      ),
    ).toEqual(["my-card", "my-card"]);
    await client.close();
  });

  it("reuses field command keys when a create-card call is retried", async () => {
    const client = await connect();
    const args = {
      boardId: "b1",
      columnId: "col1",
      cardId: "stable-card",
      title: "Stable",
      description: "Details",
      priority: "high",
    };
    await client.callTool({ name: "janosik_create_card", arguments: args });
    await client.callTool({ name: "janosik_create_card", arguments: args });
    const batches = calls.filter(
      (call) => call.path === "/boards/b1/commands/batch",
    );
    const keys = batches.map((call) =>
      (call.body as { commands: Array<{ commandId: string }> }).commands.map(
        (command) => command.commandId,
      ),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual(keys[1]);
    expect(new Set(keys[0]).size).toBe(3);
    expect(keys[0]?.every((key) => key.length <= 64)).toBe(true);
    await client.close();
  });

  it("keeps a long client entity id within the command-id limit", async () => {
    const client = await connect();
    const cardId = "x".repeat(128);
    await client.callTool({
      name: "janosik_create_card",
      arguments: { boardId: "b1", columnId: "col1", cardId, title: "Long id" },
    });
    const batch = calls.find(
      (call) => call.path === "/boards/b1/commands/batch",
    );
    const command = (
      batch?.body as {
        commands: Array<{ commandId: string; action: { newCardId: string } }>;
      }
    ).commands[0]!;
    expect(command.action.newCardId).toBe(cardId);
    expect(command.commandId.length).toBeLessThanOrEqual(64);
    await client.close();
  });

  it("refuses to move a card into Done with an unticked Definition of Done", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k3", toColumnId: "col2" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Definition of Done/i);
    expect(calls.some((call) => call.path === "/boards/b1/commands")).toBe(
      false,
    );
    await client.close();
  });

  it("refuses to move a card into Done without an evidence comment", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k4", toColumnId: "col2" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/evidence/i);
    await client.close();
  });

  it("rechecks the current task contract after a human edit (TASK-177.4)", async () => {
    const client = await connect();
    // The agent sets a contract.
    const set = await client.callTool({
      name: "janosik_set_card_task_spec",
      arguments: {
        boardId: "b1",
        cardId: "k1",
        definitionOfDone: ["agent item"],
      },
    });
    expect(set.isError).toBeFalsy();

    // A human replaces the contract through the card dialog; the next tool
    // call must read that saved version, not the one the agent remembered.
    cardOverrides = {
      k1: {
        id: "k1",
        title: "First",
        labelIds: [],
        definitionOfDone: ["human-edited item"],
        createdAt: 1,
        updatedAt: 2,
      },
    };
    // The MCP read shows the human's item, not the agent's original one.
    const read = await client.callTool({
      name: "janosik_get_card",
      arguments: { boardId: "b1", cardId: "k1" },
    });
    expect(firstText(read)).toContain("human-edited item");
    expect(firstText(read)).not.toContain("agent item");

    const blocked = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k1", toColumnId: "col2" },
    });
    expect(blocked.isError).toBe(true);
    expect(firstText(blocked)).toMatch(/evidence/i);
    expect(
      calls.some(
        (call) =>
          call.path === "/boards/b1/commands" &&
          (call.body as { action?: { type?: string } }).action?.type ===
            "MOVE_CARD",
      ),
    ).toBe(false);

    // The human clears it: with no contract the DoD gate no longer binds and
    // the move goes through against the fresh board.
    cardOverrides = {
      k1: {
        id: "k1",
        title: "First",
        labelIds: [],
        createdAt: 1,
        updatedAt: 3,
      },
    };
    const moved = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k1", toColumnId: "col2" },
    });
    expect(moved.isError).toBeFalsy();
    expect(firstText(moved)).toMatch(/Moved card k1/i);
    await client.close();
  });

  it("rechecks Done from the fresh card context before moving", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k3", toColumnId: "col2" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Definition of Done/i);
    expect(calls.some((call) => call.path === "/boards/b1/cards/k3/move")).toBe(
      false,
    );
    expect(calls.some((call) => call.path === "/boards/b1")).toBe(false);
    await client.close();
  });

  it("rechecks Done after the destination becomes done on the retry", async () => {
    boardWorkflow = {
      schemaVersion: 1,
      enabled: false,
      doneColumnIds: ["col1"],
      transitions: [],
    };
    staleWrites = 1;
    doneAfterMoveConflict = true;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k3", toColumnId: "col2" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Definition of Done/i);
    // One intent was refused; the retry was blocked by the fresh context and
    // never became a second move or a command.
    expect(
      calls.filter((call) => call.path === "/boards/b1/cards/k3/move"),
    ).toHaveLength(1);
    expect(calls.some((call) => call.path === "/boards/b1")).toBe(false);
    await client.close();
  });

  it("refuses to release another user's live card claim", async () => {
    cardOverrides = {
      k1: {
        id: "k1",
        title: "First",
        labelIds: [],
        claimedBy: "u2",
        leaseUntil: Date.now() + 60_000,
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_release_card",
      arguments: { boardId: "b1", cardId: "k1" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/live claim held by another user/i);
    expect(calls.some((call) => call.path === "/boards/b1/commands")).toBe(
      false,
    );
    await client.close();
  });

  it("moves a card without a task contract into Done", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k1", toColumnId: "col2" },
    });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("lists the cards ready to work", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_list_ready_cards",
      arguments: { boardId: "b1" },
    });
    const results = (
      result.structuredContent as { results: Array<{ id: string }> }
    ).results;
    expect(results.map((entry) => entry.id)).toContain("k1");
    await client.close();
  });

  it("does not offer work from an archived board", async () => {
    archivedBoard = true;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_list_ready_cards",
      arguments: { boardId: "b1", response_format: "json" },
    });
    expect(result.structuredContent).toMatchObject({ results: [] });
    await client.close();
  });

  it("waits for work and returns a ready card", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 1000 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    await client.close();
  });

  it("times out when no card is ready", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b3", timeoutMs: 0 },
    });
    expect(result.structuredContent).toMatchObject({ card: null });
    await client.close();
  });

  it("long-polls the ready endpoint instead of reading the board", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 1000 },
    });
    expect(result.structuredContent).toMatchObject({
      card: { id: "k1", column: "Todo" },
    });
    expect(
      calls.some(
        (call) => call.path === "/boards/b1/ready" && call.method === "GET",
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.path === "/boards/b1" && call.method === "GET"),
    ).toBe(false);
    await client.close();
  });

  it("long-polls a board with no ready card and returns null on timeout", async () => {
    const client = await connect();
    const started = Date.now();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b3", timeoutMs: 80 },
    });
    expect(result.structuredContent).toMatchObject({ card: null });
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
    expect(
      calls.filter((call) => call.path === "/boards/b3/ready").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      calls.filter((call) => call.path === "/boards/b3/ready").length,
    ).toBeLessThanOrEqual(2);
    expect(
      calls.some((call) => call.path === "/boards/b3" && call.method === "GET"),
    ).toBe(false);
    await client.close();
  });

  it("uses the cross-board ready snapshot when boardId is omitted", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { timeoutMs: 1000 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    expect(
      calls.some(
        (call) => call.path === "/boards/ready" && call.method === "GET",
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.path.startsWith("/boards/") &&
          call.path !== "/boards/ready" &&
          call.method === "GET",
      ),
    ).toBe(false);
    await client.close();
  });

  it("falls back to a full board read on a server without the ready endpoint", async () => {
    readyEndpointMissing = true;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 1000 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    expect(
      calls.some(
        (call) => call.path === "/boards/b1/ready" && call.method === "GET",
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.path === "/boards/b1" && call.method === "GET"),
    ).toBe(true);
    await client.close();
  });

  it("lists ready cards from the summary endpoint", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_list_ready_cards",
      arguments: { boardId: "b1" },
    });
    expect(result.structuredContent).toBeDefined();
    const results = (
      result.structuredContent as {
        results: Array<{ id: string; descriptionChars: number }>;
      }
    ).results;
    expect(
      results.some(
        (entry) =>
          entry.id === "k1" && entry.descriptionChars === "original".length,
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) => call.path === "/boards/b1/ready" && call.method === "GET",
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.path === "/boards/b1" && call.method === "GET"),
    ).toBe(false);
    await client.close();
  });

  it("retries list_ready_cards network and 429 failures for a board", async () => {
    readyNetworkFailures = 1;
    readyRateLimitFailures = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_list_ready_cards",
      arguments: { boardId: "b1", response_format: "json" },
    });
    const results = (
      result.structuredContent as { results: Array<{ id: string }> }
    ).results;
    expect(results.map((entry) => entry.id)).toContain("k1");
    expect(
      calls.filter((call) => call.path === "/boards/b1/ready").length,
    ).toBeGreaterThanOrEqual(3);
    await client.close();
  });

  it("does not retry wait_for_work network failures past a zero deadline", async () => {
    readyNetworkFailures = 1;
    const client = await connect();
    const started = Date.now();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 0 },
    });
    expect(result.isError).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(
      calls.filter((call) => call.path === "/boards/b1/ready").length,
    ).toBe(1);
    await client.close();
  });

  it("does not retry wait_for_work 429s past a short deadline", async () => {
    readyRateLimitFailures = 1;
    const client = await connect();
    const started = Date.now();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 50 },
    });
    expect(result.isError).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(
      calls.filter((call) => call.path === "/boards/b1/ready").length,
    ).toBe(1);
    await client.close();
  });

  it("snapshots a ready board even when timeoutMs is 0", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 0 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    expect(
      calls.some(
        (call) => call.path === "/boards/b1/ready" && call.method === "GET",
      ),
    ).toBe(true);
    await client.close();
  });

  it("snapshots the cross-board ready set even when timeoutMs is 0", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { timeoutMs: 0 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    expect(
      calls.some(
        (call) => call.path === "/boards/ready" && call.method === "GET",
      ),
    ).toBe(true);
    await client.close();
  });

  it("retries a transient network failure inside the long-poll deadline", async () => {
    readyNetworkFailures = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 1000 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    expect(
      calls.filter((call) => call.path === "/boards/b1/ready").length,
    ).toBeGreaterThanOrEqual(2);
    await client.close();
  });

  it("retries ready_poll_capacity inside the deadline", async () => {
    readyCapacityFailures = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { boardId: "b1", timeoutMs: 1000 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    expect(
      calls.filter((call) => call.path === "/boards/b1/ready").length,
    ).toBeGreaterThanOrEqual(2);
    await client.close();
  });

  it("retries cross-board network and capacity failures inside the deadline", async () => {
    readyNetworkFailures = 1;
    readyCapacityFailures = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_wait_for_work",
      arguments: { timeoutMs: 1000 },
    });
    expect(result.structuredContent).toMatchObject({ card: { id: "k1" } });
    expect(
      calls.filter((call) => call.path === "/boards/ready").length,
    ).toBeGreaterThanOrEqual(3);
    await client.close();
  });

  it("falls back to a full board read when list_ready_cards gets a 404", async () => {
    readyEndpointMissing = true;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_list_ready_cards",
      arguments: { boardId: "b1", response_format: "json" },
    });
    const results = (
      result.structuredContent as { results: Array<{ id: string }> }
    ).results;
    expect(results.map((entry) => entry.id)).toContain("k1");
    expect(
      calls.some((call) => call.path === "/boards/b1" && call.method === "GET"),
    ).toBe(true);
    await client.close();
  });

  it("requests an approval for an exact command plan", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_request_approval",
      arguments: {
        boardId: "b1",
        kind: "destructive",
        cardId: "k1",
        ttlMinutes: 30,
        plan: {
          schemaVersion: 1,
          boardId: "b1",
          commands: [
            {
              commandId: "cmd-1",
              action: { type: "DELETE_CARD", cardId: "k1" },
            },
          ],
        },
        response_format: "json",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      approval: {
        id: "apr-1",
        status: "pending",
        kind: "destructive",
        planHash: "a".repeat(64),
      },
    });
    const call = calls.find(
      (entry) =>
        entry.path === "/boards/b1/approvals" && entry.method === "POST",
    );
    expect(call?.body).toMatchObject({
      kind: "destructive",
      cardId: "k1",
      ttlMinutes: 30,
      plan: { schemaVersion: 1, boardId: "b1" },
    });
    await client.close();
  });

  it("lists, reads and waits for an approval decision", async () => {
    const client = await connect();
    const list = await client.callTool({
      name: "janosik_list_approvals",
      arguments: { boardId: "b1", status: "pending", response_format: "json" },
    });
    expect(list.structuredContent).toMatchObject({
      count: 1,
      approvals: [{ id: "apr-1" }],
    });

    approvalStatus = "approved";
    const waited = await client.callTool({
      name: "janosik_wait_for_decision",
      arguments: { boardId: "b1", approvalId: "apr-1", timeoutSeconds: 1 },
    });
    expect(waited.isError).toBeFalsy();
    expect(waited.structuredContent).toMatchObject({
      approval: { id: "apr-1", status: "approved" },
      waited: true,
    });
    const getCall = calls.find(
      (entry) => entry.path === "/boards/b1/approvals/apr-1",
    );
    expect(getCall?.method).toBe("GET");
    await client.close();
  });

  it("cancels a pending approval", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_cancel_approval",
      arguments: { boardId: "b1", approvalId: "apr-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      approval: { id: "apr-1", status: "cancelled" },
    });
    const call = calls.find(
      (entry) =>
        entry.path === "/boards/b1/approvals/apr-1/cancel" &&
        entry.method === "POST",
    );
    expect(call).toBeDefined();
    await client.close();
  });

  it("passes an approved id as X-Approval-Id on a destructive tool", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_delete_card",
      arguments: { boardId: "b1", cardId: "k1", approvalId: "apr-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      seq: boardSeq,
      runId: null,
    });
    const call = calls.find(
      (entry) =>
        entry.path === "/boards/b1/commands" && entry.method === "POST",
    );
    expect(call?.headers?.["X-Approval-Id"]).toBe("apr-1");
    await client.close();
  });

  it.each<[string, Record<string, unknown>]>([
    ["janosik_delete_card", { cardId: "k1" }],
    ["janosik_unarchive_card", { cardId: "k9" }],
    ["janosik_move_card", { cardId: "k1", toColumnId: "col1", position: 0 }],
    ["janosik_duplicate_card", { cardId: "k1", newCardId: "copy-1" }],
    ["janosik_clear_column", { columnId: "col1" }],
    ["janosik_delete_column", { columnId: "col1" }],
    ["janosik_delete_label", { labelId: "label-1" }],
    ["janosik_delete_checklist", { cardId: "k1", checklistId: "checklist-1" }],
    [
      "janosik_delete_checklist_item",
      { cardId: "k1", checklistId: "checklist-1", itemId: "item-1" },
    ],
  ])("%s uses a fresh commandId for each invocation", async (name, extra) => {
    const client = await connect();
    const args = { boardId: "b1", ...extra };
    await client.callTool({ name, arguments: args });
    await client.callTool({ name, arguments: args });
    const writes = calls.filter(
      (entry) =>
        (entry.path === "/boards/b1/commands" ||
          entry.path === "/boards/b1/commands/batch" ||
          /^\/boards\/b1\/cards\/[^/]+\/(claim|move)$/.test(entry.path)) &&
        entry.method === "POST",
    );
    expect(writes).toHaveLength(2);
    const ids = writes.map((entry) => {
      const body = entry.body as {
        commandId?: string;
        commands?: Array<{ commandId?: string }>;
      };
      return body.commandId ?? body.commands?.[0]?.commandId;
    });
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toEqual(expect.any(String));
    expect(ids[1]).not.toBe(ids[0]);
    await client.close();
  });

  it("creates a card with a stable commandId seeded plan", async () => {
    const client = await connect();
    const args = {
      boardId: "b1",
      columnId: "col1",
      title: "Approval-created card",
      commandId: "cmd-create-approved",
    };
    await client.callTool({ name: "janosik_create_card", arguments: args });
    await client.callTool({ name: "janosik_create_card", arguments: args });
    const writes = calls.filter(
      (entry) =>
        entry.path === "/boards/b1/commands/batch" && entry.method === "POST",
    );
    expect(writes).toHaveLength(2);
    const bodies = writes.map(
      (entry) =>
        entry.body as {
          commands: Array<{
            commandId: string;
            action: { newCardId?: string };
          }>;
        },
    );
    expect(bodies[0]!.commands[0]!.commandId).toBe("cmd-create-approved");
    expect(bodies[1]!.commands[0]!.commandId).toBe("cmd-create-approved");
    expect(bodies[1]!.commands[0]!.action.newCardId).toBe(
      bodies[0]!.commands[0]!.action.newCardId,
    );
    await client.close();
  });

  it("applies a destructive MCP action after approval with the same plan command", async () => {
    approvalRequiredFor = "DELETE_LABEL";
    const client = await connect();
    const args = {
      boardId: "b1",
      labelId: "label-1",
      expectedVersion: 3,
    };
    const refused = await client.callTool({
      name: "janosik_delete_label",
      arguments: args,
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      ok: false,
      code: "approval_required",
      approvalId: "apr-1",
    });

    const requestedCommand = calls.find(
      (entry) =>
        entry.path === "/boards/b1/commands" && entry.method === "POST",
    )!.body as { commandId: string };
    const approved = await client.callTool({
      name: "janosik_delete_label",
      arguments: {
        ...args,
        approvalId: "apr-1",
        commandId: requestedCommand.commandId,
      },
    });
    expect(approved.isError).toBeFalsy();

    const writes = calls.filter(
      (entry) =>
        entry.path === "/boards/b1/commands" && entry.method === "POST",
    );
    expect(writes).toHaveLength(2);
    const bodies = writes.map((entry) => entry.body as { commandId: string });
    expect(bodies[1]!.commandId).toBe(bodies[0]!.commandId);
    expect(writes[0]!.headers?.["X-Approval-Id"]).toBeUndefined();
    expect(writes[1]!.headers?.["X-Approval-Id"]).toBe("apr-1");
    await client.close();
  });

  it("lists, reads and previews runs without exposing an apply tool", async () => {
    const client = await connect();
    const list = await client.callTool({
      name: "janosik_list_runs",
      arguments: { boardId: "b1", kind: "batch", response_format: "json" },
    });
    expect(list.isError).toBeFalsy();
    expect(list.structuredContent).toMatchObject({
      count: 1,
      runs: [{ id: "run-1", kind: "batch", status: "applied" }],
    });
    const listCall = calls.find(
      (entry) => entry.path === "/boards/b1/runs" && entry.method === "GET",
    );
    expect(listCall).toBeDefined();

    const detail = await client.callTool({
      name: "janosik_get_run",
      arguments: { boardId: "b1", runId: "run-1", response_format: "json" },
    });
    expect(detail.isError).toBeFalsy();
    expect(detail.structuredContent).toMatchObject({
      run: { id: "run-1" },
      commands: [{ commandId: "cmd-1" }],
      preimages: {},
    });

    const preview = await client.callTool({
      name: "janosik_preview_run_revert",
      arguments: { boardId: "b1", runId: "run-1", response_format: "json" },
    });
    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent).toMatchObject({
      canRevert: true,
      conflicts: [],
      run: { id: "run-1" },
    });
    const previewCall = calls.find(
      (entry) =>
        entry.path === "/boards/b1/runs/run-1/revert/preview" &&
        entry.method === "POST",
    );
    expect(previewCall).toBeDefined();
    await client.close();
  });

  it("previews a plan and applies exactly the returned commands and hash", async () => {
    const client = await connect();
    const commands = [
      {
        commandId: "cmd-plan-1",
        action: {
          type: "ADD_CARD",
          newCardId: "c-new",
          columnId: "col1",
          title: "Bulk one",
        },
      },
      {
        commandId: "cmd-plan-2",
        action: { type: "UPDATE_CARD", cardId: "k1", title: "First!" },
      },
    ];
    const preview = await client.callTool({
      name: "janosik_plan_changes",
      arguments: { boardId: "b1", commands },
    });
    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent).toMatchObject({
      dryRun: true,
      boardId: "b1",
      commandCount: 2,
      cardCreates: 1,
      canApply: true,
    });
    expect(firstText(preview)).toContain("planHash");
    const previewCall = calls.find(
      (entry) => entry.path === "/boards/b1/plans" && entry.method === "POST",
    );
    expect(previewCall?.body).toMatchObject({ commands });

    const previewHash = (preview.structuredContent as { planHash: string })
      .planHash;
    const applied = await client.callTool({
      name: "janosik_apply_plan",
      arguments: { boardId: "b1", planHash: previewHash, commands },
    });
    expect(applied.isError).toBeFalsy();
    expect(applied.structuredContent).toMatchObject({
      ok: true,
      planHash: previewHash,
      seq: boardSeq + 2,
      runId: "run-plan-1",
      commandCount: 2,
    });
    const applyCall = calls.find(
      (entry) =>
        entry.path === "/boards/b1/plans/apply" && entry.method === "POST",
    );
    expect(applyCall?.body).toMatchObject({ planHash: previewHash, commands });
    expect(applyCall?.headers?.["X-Approval-Id"]).toBeUndefined();
    await client.close();
  });

  it("passes approvalId on a plan apply and keeps the plan hash", async () => {
    const client = await connect();
    const commands = [
      {
        commandId: "cmd-delete-1",
        action: { type: "DELETE_CARD", cardId: "k1" },
      },
    ];
    const result = await client.callTool({
      name: "janosik_apply_plan",
      arguments: {
        boardId: "b1",
        planHash: "c".repeat(64),
        commands,
        approvalId: "apr-1",
      },
    });
    expect(result.isError).toBeFalsy();
    const call = calls.find(
      (entry) =>
        entry.path === "/boards/b1/plans/apply" && entry.method === "POST",
    );
    expect(call?.headers?.["X-Approval-Id"]).toBe("apr-1");
    expect(call?.body).toMatchObject({ planHash: "c".repeat(64), commands });
    await client.close();
  });
});
