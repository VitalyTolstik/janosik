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
let reorderOnConflict: boolean;
let boardWorkflow: unknown;

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
  };
}

function fakeApi(
  path: string,
  method: string,
  body: unknown,
  searchParams: URLSearchParams,
): Response {
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
  if (path === "/boards/b1" && method === "GET") {
    const snapshot = board(cardOverrides);
    if (reorderOnConflict) {
      snapshot.columns.splice(boardSeq > 3 ? 1 : 2, 0, {
        id: "col3",
        title: "Other",
        cardIds: [],
        createdAt: 1,
      });
    }
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
    return respond({ results });
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
  reorderOnConflict = false;
  boardWorkflow = null;
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      path: url.pathname.replace("/api/v1", ""),
      method,
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(
      fakeApi(
        url.pathname.replace("/api/v1", ""),
        method,
        body,
        url.searchParams,
      ),
    );
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("janosik MCP server", () => {
  it("registers the full tool catalog with every toolset", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    // Pinned exactly so a dropped or renamed tool fails loudly. TASK-166
    // removed the invitation and profile tools (session-only routes).
    expect(names.length).toBe(74);
    expect(names).toContain("janosik_list_boards");
    expect(names).toContain("janosik_create_card");
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

  it("moves with ifMatch and retries after a concurrent write", async () => {
    staleWrites = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k1", position: 2 },
    });
    expect(result.isError).toBeFalsy();
    const writes = calls.filter((call) => call.path === "/boards/b1/commands");
    expect(writes).toHaveLength(2);
    const last = writes[1]!.body as { ifMatch: number; action: unknown };
    expect(last.ifMatch).toBe(4);
    expect(last.action).toMatchObject({
      type: "MOVE_CARD",
      fromColumnId: "col1",
      fromIndex: 0,
      toColumnId: "col1",
      toIndex: 2,
    });
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

  it("posts a typed comment", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_add_comment",
      arguments: { cardId: "k1", text: "stuck", kind: "blocker" },
    });
    expect(result.isError).toBeFalsy();
    const call = calls.find(
      (entry) => entry.path === "/cards/k1/comments" && entry.method === "POST",
    );
    expect(call?.body).toMatchObject({ text: "stuck", kind: "blocker" });
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

  it("rechecks Done after a concurrent column reorder", async () => {
    staleWrites = 1;
    reorderOnConflict = true;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k3", toColumnId: "col2" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Definition of Done/i);
    expect(
      calls.filter((call) => call.path === "/boards/b1/commands"),
    ).toHaveLength(1);
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
});
