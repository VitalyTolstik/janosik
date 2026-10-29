import { afterEach, describe, expect, it, vi } from "vitest";

import type { BoardAction, CommandResponse } from "@janosik/shared";
import { ApiError } from "@/api/client";
import {
  SENT_IDS_PER_BOARD,
  ServerSync,
  textEntityKey,
} from "@/store/server-sync";

function renameColumn(commandId: string): BoardAction {
  return {
    type: "RENAME_COLUMN",
    columnId: "col-1",
    title: "X",
    at: 1,
    commandId,
  };
}

function moveCard(commandId: string): BoardAction {
  return {
    type: "MOVE_CARD",
    cardId: "c-1",
    fromColumnId: "col-1",
    fromIndex: 0,
    toColumnId: "col-2",
    toIndex: 0,
    at: 2,
    commandId,
  };
}

function quietEdit(commandId: string, title: string): BoardAction {
  return {
    type: "UPDATE_CARD",
    cardId: "c-1",
    title,
    quiet: true,
    at: 3,
    commandId,
  };
}

const okResponse = (): CommandResponse => ({ seq: 1, versions: {} });

afterEach(() => {
  vi.useRealTimers();
});

describe("ServerSync", () => {
  it("sends commands of one board strictly in dispatch order", async () => {
    const sent: string[] = [];
    const control: { release: (() => void) | null } = { release: null };
    const sync = new ServerSync({
      send: async (_boardId, request) => {
        sent.push(request.action.type);
        if (sent.length === 1) {
          await new Promise<void>((resolve) => {
            control.release = resolve;
          });
        }
        return okResponse();
      },
    });

    const first = sync.enqueue("b-1", renameColumn("cd-1"));
    const second = sync.enqueue("b-1", moveCard("cd-2"));
    await vi.waitFor(() => expect(sent).toEqual(["RENAME_COLUMN"]));

    control.release?.();
    const [one, two] = await Promise.all([first, second]);
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    expect(sent).toEqual(["RENAME_COLUMN", "MOVE_CARD"]);
  });

  it("coalesces quiet edits per card and sends only the newest", async () => {
    vi.useFakeTimers();
    const requests: Array<string | undefined> = [];
    const sync = new ServerSync({
      send: async (_boardId, request) => {
        requests.push((request.action as { title?: string }).title);
        return okResponse();
      },
    });

    const pending = Promise.all([
      sync.enqueue("b-1", quietEdit("cd-1", "a")),
      sync.enqueue("b-1", quietEdit("cd-2", "ab")),
      sync.enqueue("b-1", quietEdit("cd-3", "abc")),
    ]);
    expect(requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toEqual(["abc"]);
    // The superseded patches resolve as success — the user's text is not
    // lost, only coalesced into the patch that goes out.
    const results = await pending;
    expect(results.every((outcome) => outcome.ok)).toBe(true);
  });

  it("merges coalesced quiet patches by field (C2)", async () => {
    vi.useFakeTimers();
    const sent: Array<Record<string, unknown>> = [];
    const sync = new ServerSync({
      send: async (_boardId, request) => {
        sent.push(request.action as unknown as Record<string, unknown>);
        return okResponse();
      },
    });

    const pending = Promise.all([
      sync.enqueue("b-1", {
        type: "UPDATE_CARD",
        cardId: "c-1",
        description: "Mine",
        quiet: true,
        at: 1,
        commandId: "cd-desc",
      }),
      sync.enqueue("b-1", {
        type: "UPDATE_CARD",
        cardId: "c-1",
        title: "New title",
        quiet: true,
        at: 2,
        commandId: "cd-title",
      }),
    ]);
    await vi.advanceTimersByTimeAsync(400);

    expect(sent).toHaveLength(1);
    // Both fields survive; the newest identity/clock fields win.
    expect(sent[0]).toMatchObject({
      title: "New title",
      description: "Mine",
      commandId: "cd-title",
      at: 2,
    });
    expect((await pending).every((outcome) => outcome.ok)).toBe(true);
  });

  it("reports a failed coalesced send to every merged waiter", async () => {
    vi.useFakeTimers();
    const sync = new ServerSync({
      send: async () => {
        throw new ApiError(0, null);
      },
    });

    const pending = Promise.all([
      sync.enqueue("b-1", quietEdit("cd-1", "a")),
      sync.enqueue("b-1", quietEdit("cd-2", "ab")),
    ]);
    await vi.advanceTimersByTimeAsync(400);
    const results = await pending;
    expect(
      results.every(
        (outcome) => !outcome.ok && outcome.failure.kind === "offline",
      ),
    ).toBe(true);
  });

  it("flushes a pending quiet edit before the next command of that board", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const sync = new ServerSync({
      send: async (_boardId, request) => {
        sent.push(request.action.type);
        return okResponse();
      },
    });

    void sync.enqueue("b-1", quietEdit("cd-1", "typed"));
    void sync.enqueue("b-1", moveCard("cd-2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["UPDATE_CARD", "MOVE_CARD"]);
  });

  it("does not mix boards: quiet edits of one board wait their window", async () => {
    vi.useFakeTimers();
    const sent: Array<{ boardId: string; type: string }> = [];
    const sync = new ServerSync({
      send: async (boardId, request) => {
        sent.push({ boardId, type: request.action.type });
        return okResponse();
      },
    });

    void sync.enqueue("b-1", quietEdit("cd-1", "typed"));
    void sync.enqueue("b-2", renameColumn("cd-2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ boardId: "b-2", type: "RENAME_COLUMN" }]);
    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toEqual([
      { boardId: "b-2", type: "RENAME_COLUMN" },
      { boardId: "b-1", type: "UPDATE_CARD" },
    ]);
  });

  it("classifies server and network failures", async () => {
    const cases: Array<[unknown, string]> = [
      [new ApiError(0, null), "offline"],
      [new ApiError(409, { conflict: "wip" }), "wip"],
      [new ApiError(409, { conflict: "version" }), "version"],
      [new ApiError(503, { code: "board_write_timeout" }), "busy"],
      [new ApiError(503, { message: "Service Unavailable" }), "rejected"],
      [new ApiError(400, { field: "action.title" }), "rejected"],
      [new Error("boom"), "rejected"],
    ];
    for (const [error, kind] of cases) {
      const sync = new ServerSync({
        send: async () => {
          throw error;
        },
      });
      const outcome = await sync.enqueue("b-1", renameColumn("cd-1"));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.failure.kind).toBe(kind);
        if (
          outcome.failure.kind === "rejected" &&
          error instanceof ApiError &&
          error.status === 400
        ) {
          expect(outcome.failure.field).toBe("action.title");
        }
      }
    }
  });

  it("reports busy while a command is in flight", async () => {
    const control: { release: (() => void) | null } = { release: null };
    const sync = new ServerSync({
      send: async () => {
        await new Promise<void>((resolve) => {
          control.release = resolve;
        });
        return okResponse();
      },
    });
    const pending = sync.enqueue("b-1", renameColumn("cd-1"));
    await vi.waitFor(() => expect(sync.isBusy("b-1")).toBe(true));
    control.release?.();
    await pending;
    expect(sync.isBusy("b-1")).toBe(false);
  });
});

describe("ServerSync lifecycle, flushing and touch keys", () => {
  it("refuses work after dispose and accepts it again after revive", async () => {
    const sent: string[] = [];
    const sync = new ServerSync({
      send: async () => {
        sent.push("sent");
        return okResponse();
      },
    });

    sync.dispose();
    const refused = await sync.enqueue("b-1", renameColumn("cd-1"));
    expect(refused).toEqual({ ok: false, failure: { kind: "offline" } });
    expect(sent).toEqual([]);

    sync.revive();
    const accepted = await sync.enqueue("b-1", renameColumn("cd-2"));
    expect(accepted.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("drops coalescing timers on dispose", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const sync = new ServerSync({
      send: async () => {
        sent.push("sent");
        return okResponse();
      },
    });

    void sync.enqueue("b-1", quietEdit("cd-1", "typed"));
    sync.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual([]);
  });

  it("flushes the quiet edits of every board on demand", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const sync = new ServerSync({
      send: async (_boardId, request) => {
        sent.push(request.action.type);
        return okResponse();
      },
    });

    void sync.enqueue("b-1", quietEdit("cd-1", "a"));
    void sync.enqueue("b-2", quietEdit("cd-2", "b"));
    sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["UPDATE_CARD", "UPDATE_CARD"]);
  });

  it("flushes one board without touching the other", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const sync = new ServerSync({
      send: async (_boardId, request) => {
        sent.push(request.action.type);
        return okResponse();
      },
    });

    void sync.enqueue("b-1", quietEdit("cd-1", "a"));
    void sync.enqueue("b-2", quietEdit("cd-2", "b"));
    sync.flush("b-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["UPDATE_CARD"]);

    await vi.advanceTimersByTimeAsync(400);
    expect(sent).toEqual(["UPDATE_CARD", "UPDATE_CARD"]);
  });

  it("reports busy while a quiet edit is still coalescing", async () => {
    vi.useFakeTimers();
    const sync = new ServerSync({
      send: async () => okResponse(),
    });
    const pending = sync.enqueue("b-1", quietEdit("cd-1", "typed"));
    expect(sync.isBusy("b-1")).toBe(true);
    expect(sync.isBusy("b-2")).toBe(false);
    sync.flush("b-1");
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(sync.isBusy("b-1")).toBe(false);
  });

  it("passes commandId and version preconditions through", async () => {
    let request: {
      commandId: string;
      ifMatchVersions?: Record<string, number>;
    };
    const sync = new ServerSync({
      send: async (_boardId, sent) => {
        request = sent;
        return okResponse();
      },
    });
    await sync.enqueue("b-1", renameColumn("cmd-9"), { "column:col-1": 3 });
    expect(request!.commandId).toBe("cmd-9");
    expect(request!.ifMatchVersions).toEqual({ "column:col-1": 3 });
  });

  it("maps text commands to their touch key and everything else to null", () => {
    expect(
      textEntityKey("b-1", { type: "UPDATE_CARD", cardId: "c", at: 1 }),
    ).toBe("card:c");
    expect(
      textEntityKey("b-1", {
        type: "RENAME_COLUMN",
        columnId: "col",
        title: "x",
        at: 1,
      }),
    ).toBe("column:col");
    expect(
      textEntityKey("b-1", { type: "RENAME_BOARD", title: "x", at: 1 }),
    ).toBe("board:b-1");
    expect(
      textEntityKey("b-1", {
        type: "RENAME_LABEL",
        labelId: "l",
        name: "x",
        at: 1,
      }),
    ).toBe("label:l");
    expect(
      textEntityKey("b-1", {
        type: "RENAME_CHECKLIST",
        cardId: "c",
        checklistId: "ch",
        title: "x",
        at: 1,
      }),
    ).toBe("checklist:ch");
    expect(
      textEntityKey("b-1", {
        type: "RENAME_CHECKLIST_ITEM",
        cardId: "c",
        checklistId: "ch",
        itemId: "i",
        text: "x",
        at: 1,
      }),
    ).toBe("checklistItem:i");
    expect(textEntityKey("b-1", moveCard("cd-1"))).toBeNull();
    // Malformed payloads (missing ids) never produce a key.
    for (const type of [
      "UPDATE_CARD",
      "RENAME_COLUMN",
      "RENAME_LABEL",
      "RENAME_CHECKLIST",
      "RENAME_CHECKLIST_ITEM",
    ]) {
      expect(
        textEntityKey("b-1", { type, at: 1 } as unknown as BoardAction),
      ).toBeNull();
    }
  });
});

describe("ServerSync own-command ids and drain (U-1, U-3)", () => {
  const ok = async (): Promise<CommandResponse> => ({ seq: 1, versions: {} });

  it("remembers what it sent — before the answer, per board, bounded", async () => {
    let release: () => void = () => undefined;
    const sync = new ServerSync({
      send: () =>
        new Promise<CommandResponse>((resolve) => {
          release = () => resolve({ seq: 1, versions: {} });
        }),
    });
    const pending = sync.enqueue("b-1", renameColumn("cmd-1"));
    // The echo can beat the ack: the id is known while still in flight.
    await Promise.resolve();
    expect(sync.wasSent("b-1", "cmd-1")).toBe(true);
    expect(sync.wasSent("b-2", "cmd-1")).toBe(false);
    expect(sync.wasSent("b-1", "someone-else")).toBe(false);
    release();
    await pending;

    const bounded = new ServerSync({ send: ok });
    for (let index = 0; index <= SENT_IDS_PER_BOARD; index += 1) {
      await bounded.enqueue("b-1", renameColumn(`id-${index}`));
    }
    expect(bounded.wasSent("b-1", "id-0")).toBe(false);
    expect(bounded.wasSent("b-1", `id-${SENT_IDS_PER_BOARD}`)).toBe(true);
  });

  it("drain() sends coalesced edits at once and waits for the answers", async () => {
    const send = vi.fn(ok);
    const sync = new ServerSync({ send, coalesceDelayMs: 60_000 });
    void sync.enqueue("b-1", quietEdit("q-1", "Typed"));
    expect(send).not.toHaveBeenCalled();
    await sync.drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(sync.isBusy("b-1")).toBe(false);
  });

  it("drain() gives up after its timeout instead of blocking logout", async () => {
    const sync = new ServerSync({ send: () => new Promise(() => undefined) });
    void sync.enqueue("b-1", renameColumn("stuck"));
    const started = Date.now();
    await sync.drain(20);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
