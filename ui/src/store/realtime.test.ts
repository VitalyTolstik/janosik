import { describe, expect, it, vi } from "vitest";
import type { BoardSseEvent, CommandSseEvent } from "@janosik/shared";
import { ApiError } from "@/api/client";
import {
  BoardRealtime,
  parseBlock,
  parseEventStream,
  touchedEntityIds,
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

function frame(event: CommandSseEvent): string {
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
    const realtime = new BoardRealtime({
      open,
      onEvent: () => undefined,
      getSince: () => 0,
      retryDelayMs: () => 0,
    });

    realtime.watch("b-1");
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(open).toHaveBeenCalledTimes(1);
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
