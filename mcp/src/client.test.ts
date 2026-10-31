import { afterEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";

import { JanosikClient, apiPath } from "./client.js";
import { ApiError, NoChangeError, describeError } from "./errors.js";

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(responder: (call: Call) => Response): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(responder(call));
  });
  return { calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("JanosikClient.command", () => {
  it("posts a stamped action with auth and an idempotency key", async () => {
    const { calls } = stubFetch(() =>
      json({ seq: 7, versions: { "board:b1": 1 } }),
    );
    const client = new JanosikClient("http://api.test", "jnk_token");

    const response = await client.command("b1", {
      type: "RENAME_BOARD",
      title: "X",
    });

    expect(response.seq).toBe(7);
    const call = calls[0]!;
    expect(call.url).toBe("http://api.test/api/v1/boards/b1/commands");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jnk_token");

    const body = JSON.parse(String(call.init.body));
    expect(body.commandId).toMatch(/^mcp-/);
    expect(body.action).toMatchObject({
      boardId: "b1",
      type: "RENAME_BOARD",
      title: "X",
    });
    expect(typeof body.action.at).toBe("number");
  });

  it("passes ifMatch through when requested", async () => {
    const { calls } = stubFetch(() =>
      json({ seq: 1, versions: { "board:b1": 1 } }),
    );
    const client = new JanosikClient("http://api.test", "t");
    await client.command(
      "b1",
      { type: "DELETE_CARD", cardId: "c1" },
      { ifMatch: 5 },
    );
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.ifMatch).toBe(5);
  });
});

describe("JanosikClient.command outcomes", () => {
  it("treats an empty versions map as a no-op error", async () => {
    stubFetch(() => json({ seq: 2, versions: {} }));
    const client = new JanosikClient("http://api.test", "t");
    const sent = client.command("b1", { type: "DELETE_CARD", cardId: "x" });
    await expect(sent).rejects.toBeInstanceOf(NoChangeError);
    await expect(
      client.command(
        "b1",
        { type: "DELETE_CARD", cardId: "x" },
        { allowNoChange: true },
      ),
    ).resolves.toMatchObject({ seq: 2 });
  });

  it("retries a network failure with the same commandId", async () => {
    let attempt = 0;
    const bodies: string[] = [];
    vi.stubGlobal("fetch", (_input: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      attempt += 1;
      if (attempt === 1) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve(json({ seq: 3, versions: { "board:b1": 1 } }));
    });
    const client = new JanosikClient("http://api.test", "t");
    await client.command("b1", { type: "DELETE_CARD", cardId: "x" });
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0]!).commandId).toBe(
      JSON.parse(bodies[1]!).commandId,
    );
  });

  it("retries a busy board (503 board_write_timeout)", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", () => {
      attempt += 1;
      return Promise.resolve(
        attempt === 1
          ? json({ code: "board_write_timeout" }, 503)
          : json({ seq: 4, versions: { "board:b1": 1 } }),
      );
    });
    const client = new JanosikClient("http://api.test", "t");
    await client.command("b1", { type: "DELETE_CARD", cardId: "x" });
    expect(attempt).toBe(2);
  });

  it("does not let an action override the stamped board id", async () => {
    const { calls } = stubFetch(() =>
      json({ seq: 1, versions: { "board:b1": 1 } }),
    );
    const client = new JanosikClient("http://api.test", "t");
    await client.command("b1", {
      type: "DELETE_CARD",
      cardId: "x",
      boardId: "other",
    } as never);
    expect(JSON.parse(String(calls[0]!.init.body)).action.boardId).toBe("b1");
  });
});

describe("JanosikClient.commandOnFreshBoard", () => {
  const board = {
    id: "b1",
    columns: [],
    cards: {},
    labels: [],
  } as unknown as Board;
  const boardResponse = (seq: number): Response =>
    new Response(JSON.stringify(board), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Board-Seq": String(seq),
      },
    });

  it("reuses a prefetched snapshot instead of re-reading the board", async () => {
    const { calls } = stubFetch((call) =>
      call.init.method === "POST"
        ? json({ seq: 9, versions: { "board:b1": 1 } })
        : boardResponse(8),
    );
    const client = new JanosikClient("http://api.test", "t");
    const result = await client.commandOnFreshBoard(
      "b1",
      () => ({ action: { type: "DELETE_CARD", cardId: "c1" }, result: "ok" }),
      3,
      undefined,
      { board, seq: 8 },
    );
    expect(result).toBe("ok");
    // Exactly one request — the write. The prefetched snapshot is reused, so
    // a move that already read the board costs one GET fewer (TASK-154).
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body)).ifMatch).toBe(8);
  });

  it("re-reads once and retries on a version conflict", async () => {
    let gets = 0;
    let posts = 0;
    stubFetch((call) => {
      if (call.init.method === "POST") {
        posts += 1;
        return posts === 1
          ? json({ conflict: "version" }, 409)
          : json({ seq: 11, versions: { "board:b1": 1 } });
      }
      gets += 1;
      return boardResponse(10 + gets);
    });
    const client = new JanosikClient("http://api.test", "t");
    const result = await client.commandOnFreshBoard(
      "b1",
      () => ({ action: { type: "DELETE_CARD", cardId: "c1" }, result: "ok" }),
      3,
      undefined,
      { board, seq: 10 },
    );
    expect(result).toBe("ok");
    expect(posts).toBe(2);
    expect(gets).toBe(1); // the conflict forced one fresh read
  });
});

describe("apiPath", () => {
  it("percent-encodes every interpolated segment", () => {
    expect(apiPath`/comments/${"../boards/b1?"}`).toBe(
      "/comments/..%2Fboards%2Fb1%3F",
    );
  });
});

describe("describeError", () => {
  it("explains a timeout", () => {
    const timeout = new DOMException("aborted", "TimeoutError");
    expect(describeError(timeout)).toMatch(/did not answer in time/);
  });
});

describe("JanosikClient.request", () => {
  it("builds a cursor query", async () => {
    const { calls } = stubFetch(() => json({ items: [], nextCursor: null }));
    const client = new JanosikClient("http://api.test", "t");
    await client.listComments("c1", "abc");
    expect(calls[0]!.url).toBe(
      "http://api.test/api/v1/cards/c1/comments?cursor=abc",
    );
  });

  it("passes the page limit through", async () => {
    const { calls } = stubFetch(() => json({ items: [], nextCursor: null }));
    const client = new JanosikClient("http://api.test", "t");
    await client.listComments("c1", "abc", 50);
    expect(calls[0]!.url).toBe(
      "http://api.test/api/v1/cards/c1/comments?cursor=abc&limit=50",
    );
  });

  it("resolves an empty 200 body (accept invitation)", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const client = new JanosikClient("http://api.test", "t");
    await expect(client.acceptInvitation("inv1")).resolves.toBeUndefined();
  });

  it("throws ApiError with the parsed body on non-2xx", async () => {
    stubFetch(() => json({ conflict: "wip" }, 409));
    const client = new JanosikClient("http://api.test", "t");
    await expect(
      client.command("b1", {
        type: "ADD_CARD",
        newCardId: "c",
        columnId: "col",
        title: "T",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("JanosikClient.downloadAttachment", () => {
  it("reads the UTF-8 filename from Content-Disposition", async () => {
    stubFetch(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition":
              "attachment; filename*=UTF-8''report%20final.pdf",
          },
        }),
    );
    const client = new JanosikClient("http://api.test", "t");
    const file = await client.downloadAttachment("a1");
    expect(file.fileName).toBe("report final.pdf");
    expect(file.contentType).toBe("application/pdf");
    expect(file.bytes.length).toBe(3);
  });
});
