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

function board(cards: Record<string, unknown> = {}) {
  return {
    id: "b1",
    title: "Alpha",
    columns: [
      { id: "col1", title: "Todo", cardIds: ["k1", "k2"], createdAt: 1 },
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
    return respond(board(), 200, { "X-Board-Seq": String(boardSeq) });
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
  if (path === "/boards/b1/members" && method === "GET") {
    return respond([{ userId: "u1", role: "ADMIN" }]);
  }
  if (path === "/invitations/inv1/accept" && method === "POST") {
    // The real endpoint answers 200 with an empty body.
    return new Response(null, { status: 200 });
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
  const commentMatch = /^\/cards\/([^/]+)\/comments$/.exec(path);
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
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname.replace("/api/v1", ""), method, body });
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
    // Pinned exactly so a dropped or renamed tool fails loudly.
    expect(names.length).toBe(71);
    expect(names).toContain("janosik_list_boards");
    expect(names).toContain("janosik_create_card");
    expect(names).toContain("janosik_claim_card");
    expect(names).toContain("janosik_release_card");
    expect(names).toContain("janosik_set_card_task_spec");
    expect(names).toContain("janosik_create_share");
    expect(names).toContain("janosik_upload_attachment");
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

  it("creates a card as a stamped ADD_CARD command", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_create_card",
      arguments: { boardId: "b1", columnId: "col1", title: "New task" },
    });
    const command = calls.find((call) => call.path === "/boards/b1/commands");
    const action = (command?.body as { action: Record<string, unknown> })
      .action;
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

  it("accepts an invitation without reading a body", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_accept_invitation",
      arguments: { invitationId: "inv1" },
    });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain("Accepted invitation inv1");
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

  it("leaves the account-level groups out by default", async () => {
    const client = await connect({ toolsets: new Set(DEFAULT_TOOLSETS) });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("janosik_create_card");
    for (const optIn of [
      "janosik_whoami",
      "janosik_invite_member",
      "janosik_create_share",
      "janosik_accept_invitation",
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
    expect(calls.some((call) => call.path === "/boards/b1/commands")).toBe(
      false,
    );
    await client.close();
  });

  it("names the created card when a follow-up field fails", async () => {
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
    expect(firstText(result)).toMatch(/was created — `[0-9a-f-]{36}`/);
    expect(firstText(result)).toMatch(/do not create the card again/);
    await client.close();
  });

  it("moves with ifMatch and retries after a concurrent write", async () => {
    staleWrites = 1;
    const client = await connect();
    const result = await client.callTool({
      name: "janosik_move_card",
      arguments: { boardId: "b1", cardId: "k1", toColumnId: "col2" },
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
      toColumnId: "col2",
      toIndex: 0,
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
    const writes = calls.filter((call) => call.path === "/boards/b1/commands");
    expect(writes).toHaveLength(2);
    expect(
      writes.map((call) => (call.body as { commandId: string }).commandId),
    ).toEqual(["my-card", "my-card"]);
    expect(
      writes.map(
        (call) =>
          (call.body as { action: { newCardId: string } }).action.newCardId,
      ),
    ).toEqual(["my-card", "my-card"]);
    await client.close();
  });
});
