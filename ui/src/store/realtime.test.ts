import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BoardSseEvent,
  CommandSseEvent,
  PresenceSseEvent,
} from "@janosik/shared";
import { ApiError, api } from "@/api/client";
import {
  BoardRealtime,
  createClientId,
  createRealtimeBridge,
  parseBlock,
  parseEventStream,
  pingPresence,
  touchedEntityIds,
  type RealtimeHost,
} from "@/store/realtime";

/**
 * The realtime transport (TASK-30): SSE parsing, the resume-from-seq
 * reconnect and the fatal-answer stop. The provider-level behaviour (what a
 * foreign command does to the board) is covered in BoardContext.server.
 */

const COMMAND: CommandSseEvent = {
  type: "command",
  seq: 1,
  action: { type: "RENAME_BOARD", title: "New", at: 1 },
  actorId: "user-1",
  touches: [],
};

function frame(event: CommandSseEvent | PresenceSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const events: BoardSseEvent[] = [];
  for await (const event of parseEventStream(stream)) events.push(event);
  return events;
}

describe("parseEventStream", () => {
  it("parses frames split mid-JSON and mid-separator", async () => {
    const json = JSON.stringify(COMMAND);
    const events = await drain(
      streamOf([
        `data: ${json.slice(0, 12)}`,
        `${json.slice(12)}\n`,
        `\ndata: ${JSON.stringify({ ...COMMAND, seq: 2 })}\n\n`,
      ]),
    );
    expect(
      events.map((event) => (event.type === "command" ? event.seq : 0)),
    ).toEqual([1, 2]);
  });

  it("ignores comments, keep-alive pings and malformed frames", async () => {
    const events = await drain(
      streamOf([
        ": keep-alive\n\n",
        "data: ping\n\n",
        "data: {not json}\n\n",
        frame(COMMAND),
      ]),
    );
    expect(events).toEqual([COMMAND]);
  });

  it("joins multi-line data and tolerates CRLF", async () => {
    expect(parseBlock('data: {"a":\r\ndata: 1}')).toEqual({ a: 1 });
    expect(parseBlock("data: {not json}")).toBeNull();
    expect(parseBlock(`data: ${JSON.stringify(COMMAND)}`)).toEqual(COMMAND);
    expect(parseBlock("data: ping")).toBeNull();
    expect(parseBlock("event: message")).toBeNull();
  });
});

describe("touchedEntityIds", () => {
  it("strips known touch prefixes down to plain ids", () => {
    expect(
      touchedEntityIds([
        "board:b-1",
        "card:c-1",
        "column:col-1",
        "label:l-1",
        "checklist:ck-1",
        "checklistItem:ck-1-item-2",
      ]),
    ).toEqual(["b-1", "c-1", "col-1", "l-1", "ck-1", "ck-1-item-2"]);
  });

  it("skips unknown prefixes and unlabelled entries", () => {
    expect(touchedEntityIds(["future:thing", "nonsense", ""])).toEqual([]);
  });
});

describe("BoardRealtime", () => {
  it("resumes each connection from the last applied seq", async () => {
    const opens: number[] = [];
    const applied: number[] = [];
    let since = 0;
    let call = 0;
    const realtime = new BoardRealtime({
      open: (_boardId, from) => {
        opens.push(from);
        call += 1;
        return Promise.resolve(
          streamOf([
            frame({ ...COMMAND, seq: call }),
            frame({ ...COMMAND, seq: call + 10 }),
          ]),
        );
      },
      onEvent: (event) => {
        if (event.type !== "command" || event.seq <= since) return;
        since = event.seq;
        applied.push(event.seq);
      },
      getSince: () => since,
      retryDelayMs: () => 0,
    });

    realtime.watch("b-1");
    // First connection: seq 1 + 11 (the stream then ends); second resumes
    // from 11 and delivers 12; third from 12 …
    await vi.waitFor(() => expect(applied.length).toBeGreaterThanOrEqual(4));
    expect(applied.slice(0, 2)).toEqual([1, 11]);
    expect(opens.slice(0, 3)).toEqual([0, 11, 12]);
    realtime.stop();
  });

  it("does not reconnect after a fatal answer", async () => {
    const open = vi.fn().mockRejectedValue(new ApiError(403, null));
    const onFatal = vi.fn();
    const realtime = new BoardRealtime({
      open,
      onEvent: () => undefined,
      getSince: () => 0,
      retryDelayMs: () => 0,
      onFatal,
    });

    realtime.watch("b-1");
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(open).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledWith("b-1", 403);
    realtime.stop();
  });

  it("wakeNow skips the backoff wait", async () => {
    const open = vi.fn().mockRejectedValue(new ApiError(0, null));
    const realtime = new BoardRealtime({
      open,
      onEvent: () => undefined,
      getSince: () => 0,
      retryDelayMs: () => 60_000,
    });

    realtime.watch("b-1");
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    realtime.wakeNow();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    realtime.stop();
  });

  it("reports connect/disconnect around each stream", async () => {
    const events: string[] = [];
    const realtime = new BoardRealtime({
      open: () => Promise.resolve(streamOf([frame(COMMAND)])),
      onEvent: () => undefined,
      getSince: () => 0,
      retryDelayMs: () => 60_000,
      onConnected: (boardId) => events.push(`up:${boardId}`),
      onDisconnected: (boardId) => events.push(`down:${boardId}`),
    });

    realtime.watch("b-1");
    await vi.waitFor(() => expect(events).toEqual(["up:b-1", "down:b-1"]));
    realtime.stop();
  });

  it("switching boards abandons the old board's stream", async () => {
    const opened: string[] = [];
    const realtime = new BoardRealtime({
      open: (boardId) => {
        opened.push(boardId);
        return Promise.resolve(streamOf([frame(COMMAND)]));
      },
      onEvent: () => undefined,
      getSince: () => 0,
      retryDelayMs: () => 10_000,
    });

    realtime.watch("b-1");
    await vi.waitFor(() => expect(opened).toEqual(["b-1"]));
    realtime.watch("b-2");
    await vi.waitFor(() => expect(opened).toEqual(["b-1", "b-2"]));
    realtime.stop();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(opened).toEqual(["b-1", "b-2"]);
  });
});

describe("presence bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const PRESENCE: PresenceSseEvent = {
    type: "presence",
    users: [{ id: "u-2", displayName: "Boris", avatarColor: null }],
  };
  const FOREIGN: CommandSseEvent = {
    type: "command",
    seq: 1,
    action: {
      type: "UPDATE_CARD",
      cardId: "c-1",
      title: "Edited",
      at: 1,
      boardId: "b-1",
    },
    actorId: "u-2",
    touches: ["board:b-1", "card:c-1"],
  };

  function host(): RealtimeHost {
    return {
      getActiveBoardId: () => "b-1",
      getBaseline: () => 0,
      setBaseline: vi.fn(),
      apply: vi.fn(),
      markForeign: vi.fn(),
      setPresence: vi.fn(),
      flagForeign: vi.fn(),
      isBusy: () => false,
      getUserId: () => "me",
      onMembershipChange: vi.fn(),
      onAccessRevoked: vi.fn(),
    };
  }

  it("routes rosters, flags foreign changes and heartbeats the tab", async () => {
    const pings: { clientId: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/presence")) {
          pings.push(JSON.parse(String(init?.body)) as { clientId: string });
          return new Response(null, { status: 204 });
        }
        return new Response(streamOf([frame(PRESENCE), frame(FOREIGN)]), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const bridgeHost = host();
    const bridge = createRealtimeBridge(bridgeHost);
    bridge.watch("b-1");

    await vi.waitFor(() =>
      expect(bridgeHost.setPresence).toHaveBeenCalledWith(
        "b-1",
        PRESENCE.users,
      ),
    );
    expect(bridgeHost.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_CARD",
        boardId: "b-1",
        actorId: "u-2",
      }),
    );
    expect(bridgeHost.markForeign).toHaveBeenCalledWith("b-1", ["b-1", "c-1"]);
    expect(bridgeHost.flagForeign).toHaveBeenCalledWith("b-1", "u-2", [
      "b-1",
      "c-1",
    ]);
    expect(bridgeHost.setBaseline).toHaveBeenCalledWith("b-1", 1);

    // The connect handshake starts the heartbeat with a stable client id.
    await vi.waitFor(() => expect(pings.length).toBeGreaterThan(0));
    expect(pings[0].clientId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    bridge.dispose();
  });

  it("forwards membership changes and drops only the removed user's board", async () => {
    const revoked = (userId: string): string =>
      `data: ${JSON.stringify({ type: "membership", boardId: "b-1", userId, change: "removed" })}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/presence")) {
          return new Response(null, { status: 204 });
        }
        // An open stream: the frames land once, the connection stays.
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(revoked("u-2")));
            controller.enqueue(encoder.encode(revoked("me")));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const bridgeHost = host();
    const bridge = createRealtimeBridge(bridgeHost);
    bridge.watch("b-1");

    await vi.waitFor(() =>
      expect(bridgeHost.onMembershipChange).toHaveBeenCalledWith(
        "b-1",
        "me",
        "removed",
      ),
    );
    // Someone else's removal is a directory change, not ours to act on —
    // and the stream stops after our own frame instead of reconnecting.
    expect(bridgeHost.onMembershipChange).toHaveBeenCalledWith(
      "b-1",
      "u-2",
      "removed",
    );
    expect(bridgeHost.onMembershipChange).toHaveBeenCalledTimes(2);
    expect(bridgeHost.onAccessRevoked).not.toHaveBeenCalled();
    bridge.dispose();
  });
});

describe("pingPresence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    api.clearAccessToken();
  });

  it("posts the client id and retries once through a refresh on 401", async () => {
    const calls: { method: string; url: string; auth: string | undefined }[] =
      [];
    let presenceCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          method: init?.method ?? "GET",
          url,
          auth: (init?.headers as Record<string, string> | undefined)
            ?.Authorization,
        });
        if (url.endsWith("/auth/refresh")) {
          return new Response(
            JSON.stringify({
              user: { id: "u-1", email: "a@b.c", displayName: "A" },
              accessToken: "token-1",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        presenceCalls += 1;
        return new Response(null, { status: presenceCalls === 1 ? 401 : 204 });
      }),
    );
    api.clearAccessToken();

    await pingPresence("b-1", "client-12345678");
    expect(calls.map((call) => call.method)).toEqual(["POST", "POST", "POST"]);
    expect(calls[0].url).toBe("/api/v1/boards/b-1/presence");
    expect(calls[1].url).toBe("/api/v1/auth/refresh");
    // The retry carries the refreshed token.
    expect(calls[2].auth).toBe("Bearer token-1");
  });
});

describe("createClientId", () => {
  it("mints url-safe ids", () => {
    const id = createClientId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(createClientId()).not.toBe(id);
  });
});
