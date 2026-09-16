import { afterEach, describe, expect, it, vi } from "vitest";

import type { BoardAction, CommandResponse } from "@janosik/shared";
import { ApiError } from "@/api/client";
import { ServerSync } from "@/store/server-sync";

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
        if (outcome.failure.kind === "rejected" && error instanceof ApiError) {
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
