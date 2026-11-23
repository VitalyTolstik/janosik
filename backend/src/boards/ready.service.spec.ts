import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Subject } from "rxjs";
import type { BoardSseEvent } from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { RealtimeService } from "@/realtime/realtime.service";
import {
  ReadyPollAdmission,
  ReadyService,
  firstWorkColumn,
  isReadyFrame,
  normalizeLimit,
  normalizeSince,
  normalizeWait,
  wakeKeyOf,
} from "./ready.service";

/**
 * TASK-200.2 — the ready/work summary must stay a few small indexed reads,
 * never a board aggregate. These tests pin the column choice, the summary
 * shape, the query count (including the cross-board path), the wake filter,
 * empty post-wake holding, shared snapshot coalescing, timeout/abort and the
 * held-poll admission cap.
 */

interface ReadyCardRow {
  id: string;
  title: string;
  priority: string | null;
  claimedBy: string | null;
  leaseUntil: Date | null;
  version: number;
  descriptionChars: number;
}

const CARD_ROW: ReadyCardRow = {
  id: "card-1",
  title: "Ship it",
  priority: "high",
  claimedBy: null,
  leaseUntil: null,
  version: 4,
  descriptionChars: 12,
};

const BOARD = {
  id: "b1",
  title: "Alpha",
  archivedAt: null,
  workflow: null,
  columns: [
    { id: "col-1", title: "Todo" },
    { id: "col-2", title: "Done" },
  ],
};

function board(overrides: Record<string, unknown> = {}) {
  return { ...BOARD, ...overrides };
}

function sqlCall(mock: jest.Mock, index = 0) {
  return mock.mock.calls[index]?.[0] as {
    strings?: readonly string[];
    values?: unknown[];
  };
}

async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function setup(options: { polls?: ReadyPollAdmission } = {}) {
  const subject = new Subject<BoardSseEvent>();
  const prisma = {
    board: { findFirst: jest.fn(), findMany: jest.fn() },
    command: { groupBy: jest.fn() },
    card: { findMany: jest.fn() },
    column: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  } as unknown as PrismaService;
  const realtime = {
    watch: jest.fn(() => subject.asObservable()),
  } as unknown as RealtimeService;
  const polls = options.polls ?? new ReadyPollAdmission();
  const service = new ReadyService(prisma, realtime, polls);
  const boardFindFirst = prisma.board.findFirst as unknown as jest.Mock;
  const boardFindMany = prisma.board.findMany as unknown as jest.Mock;
  const groupBy = prisma.command.groupBy as unknown as jest.Mock;
  const queryRaw = prisma.$queryRaw as unknown as jest.Mock;
  const cardFindMany = prisma.card.findMany as unknown as jest.Mock;
  const columnFindMany = prisma.column.findMany as unknown as jest.Mock;
  return {
    service,
    polls,
    subject,
    boardFindFirst,
    boardFindMany,
    groupBy,
    queryRaw,
    cardFindMany,
    columnFindMany,
  };
}

/** One board row, one seq row and one card row, in that order. */
function primeSnapshot(
  mocks: ReturnType<typeof setup>,
  rows: ReadyCardRow[] = [CARD_ROW],
  seq = 7,
) {
  mocks.boardFindFirst.mockResolvedValue(board());
  mocks.groupBy.mockResolvedValue([
    { boardId: "b1", _max: { seq: BigInt(seq) } },
  ]);
  mocks.queryRaw.mockResolvedValue(rows);
}

describe("ReadyService.getBoardReady", () => {
  it("returns the summary shape from one first-column query", async () => {
    const mocks = setup();
    primeSnapshot(mocks);

    const result = await mocks.service.getBoardReady("b1", { userId: "u1" });

    expect(result).toMatchObject({
      status: "ready",
      held: false,
      body: {
        boardId: "b1",
        boardTitle: "Alpha",
        archived: false,
        seq: 7,
        limit: 30,
        cards: [
          {
            id: "card-1",
            title: "Ship it",
            boardId: "b1",
            boardTitle: "Alpha",
            columnId: "col-1",
            columnTitle: "Todo",
            priority: "high",
            claimedBy: null,
            leaseUntil: null,
            version: 4,
            descriptionChars: 12,
          },
        ],
      },
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.body.cards[0]).not.toHaveProperty("description");

    // The card query is scoped to the first column, carries a LIMIT and selects
    // only the stored length, never the description text.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const query = sqlCall(mocks.queryRaw);
    const sql = query.strings?.join("?") ?? "";
    expect(sql).toContain('c."columnId" = ?');
    expect(sql).toMatch(/c\."descriptionLength"\s+AS\s+"descriptionChars"/);
    expect(sql).not.toMatch(/c\."description"(?!Length)/);
    expect(sql).toContain("LIMIT ?");
    expect(query.values).toContain("col-1");
    expect(query.values).not.toContain("col-2");
    expect(query.values).toContain(30);

    // No full aggregate, no per-column or per-card enumeration.
    expect(mocks.cardFindMany).not.toHaveBeenCalled();
    expect(mocks.columnFindMany).not.toHaveBeenCalled();
    expect(mocks.boardFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
  });

  it("uses workflow.initialColumnId when that column still exists", async () => {
    const mocks = setup();
    primeSnapshot(mocks);
    mocks.boardFindFirst.mockResolvedValue(
      board({
        workflow: {
          schemaVersion: 1,
          enabled: false,
          initialColumnId: "col-2",
          doneColumnIds: [],
          transitions: [],
        },
      }),
    );

    await mocks.service.getBoardReady("b1", { userId: "u1" });

    expect(sqlCall(mocks.queryRaw).values).toContain("col-2");
    expect(sqlCall(mocks.queryRaw).values).not.toContain("col-1");
  });

  it("falls back to the first column when the configured one is gone", () => {
    expect(
      firstWorkColumn({
        workflow: {
          schemaVersion: 1,
          enabled: false,
          initialColumnId: "deleted-column",
          doneColumnIds: [],
          transitions: [],
        },
        columns: [{ id: "col-1", title: "Todo" }],
      }),
    ).toEqual({ id: "col-1", title: "Todo" });
  });

  it("honours limit, rejects invalid bounds and returns an empty list", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);

    const result = await mocks.service.getBoardReady("b1", {
      userId: "u1",
      limit: 5,
    });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.body.cards).toEqual([]);
    expect(result.body.limit).toBe(5);
    expect(sqlCall(mocks.queryRaw).values).toContain(5);

    expect(() => normalizeLimit(0)).toThrow(BadRequestException);
    expect(() => normalizeLimit(101)).toThrow(BadRequestException);
    expect(() => normalizeLimit(2.5)).toThrow(BadRequestException);
    expect(() => normalizeWait(-1)).toThrow(BadRequestException);
    expect(() => normalizeWait(60_001)).toThrow(BadRequestException);
    expect(() => normalizeSince(-1)).toThrow(BadRequestException);
    expect(normalizeSince(0)).toBe(0);
  });

  it("answers an archived board with no cards and no card query", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(
      board({ archivedAt: new Date("2026-01-01T00:00:00Z") }),
    );
    mocks.groupBy.mockResolvedValue([
      { boardId: "b1", _max: { seq: BigInt(9) } },
    ]);

    const result = await mocks.service.getBoardReady("b1", { userId: "u1" });

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.body).toMatchObject({ archived: true, seq: 9, cards: [] });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("long-polls until a relevant command wakes it", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([
      { boardId: "b1", _max: { seq: BigInt(7) } },
    ]);
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([CARD_ROW]);

    const pending = mocks.service.getBoardReady("b1", {
      userId: "u1",
      wait: 5_000,
    });
    await waitFor(() => mocks.queryRaw.mock.calls.length === 1);
    mocks.subject.next(commandFrame("ADD_CARD", ["board:b1", "card:card-1"]));
    const result = await pending;

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.held).toBe(true);
    expect(result.body.cards.map((card) => card.id)).toEqual(["card-1"]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("keeps holding after a relevant wake that leaves no work, then returns work", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([CARD_ROW]);

    const pending = mocks.service.getBoardReady("b1", {
      userId: "u1",
      wait: 5_000,
    });
    await waitFor(() => mocks.queryRaw.mock.calls.length === 1);
    mocks.subject.next(commandFrame("MOVE_CARD", ["board:b1", "card:card-1"]));
    await waitFor(() => mocks.queryRaw.mock.calls.length === 2);
    // Still empty: no `200` was returned and the hold continues.
    mocks.subject.next(
      commandFrame("ADD_CARD", ["board:b1", "card:card-1"], 9),
    );
    const result = await pending;

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.body.cards.map((card) => card.id)).toEqual(["card-1"]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
  });

  it("coalesces a burst of co-waiters into one post-wake snapshot", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockImplementation(() =>
      Promise.resolve(mocks.queryRaw.mock.calls.length <= 20 ? [] : [CARD_ROW]),
    );

    const waiters = Array.from({ length: 20 }, (_, index) =>
      mocks.service.getBoardReady("b1", {
        userId: `u${index}`,
        wait: 5_000,
      }),
    );
    await waitFor(() => mocks.queryRaw.mock.calls.length === 20);
    mocks.subject.next(commandFrame("ADD_CARD", ["board:b1", "card:card-1"]));
    const results = await Promise.all(waiters);

    for (const result of results) {
      if (result.status !== "ready") throw new Error("expected ready");
      expect(result.body.cards.map((card) => card.id)).toEqual(["card-1"]);
    }
    // 20 initial snapshots + one shared post-wake read, not 40.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(21);
    expect(mocks.polls.active()).toBe(0);
  });

  it("times out with the latest seq and never returns an empty snapshot", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([
      { boardId: "b1", _max: { seq: BigInt(7) } },
    ]);
    mocks.queryRaw.mockResolvedValue([]);

    const result = await mocks.service.getBoardReady("b1", {
      userId: "u1",
      wait: 25,
    });

    expect(result).toEqual({ status: "timeout", seq: 7, held: true });
    // Initial snapshot only; the timeout check does not re-run the card read.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("aborts a held request when the client disconnects", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    const controller = new AbortController();

    const pending = mocks.service.getBoardReady("b1", {
      userId: "u1",
      wait: 5_000,
      signal: controller.signal,
    });
    await waitFor(() => mocks.queryRaw.mock.calls.length === 1);
    expect(mocks.polls.active()).toBe(1);
    controller.abort();

    await expect(pending).resolves.toEqual({ status: "aborted" });
    expect(mocks.polls.active()).toBe(0);
    expect(mocks.subject.observed).toBe(false);
  });

  it("answers immediately when since predates the current seq", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([
      { boardId: "b1", _max: { seq: BigInt(8) } },
    ]);
    mocks.queryRaw.mockResolvedValue([]);

    const result = await mocks.service.getBoardReady("b1", {
      userId: "u1",
      wait: 5_000,
      since: 3,
    });

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.body).toMatchObject({ seq: 8, cards: [] });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("answers 404 when the board is deleted during the hold", async () => {
    const mocks = setup();
    mocks.boardFindFirst
      .mockResolvedValueOnce(board())
      .mockResolvedValueOnce(null);
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);

    const pending = mocks.service.getBoardReady("b1", {
      userId: "u1",
      wait: 5_000,
    });
    await waitFor(() => mocks.queryRaw.mock.calls.length === 1);
    mocks.subject.next(commandFrame("ADD_CARD", ["board:b1", "card:card-1"]));
    await expect(pending).rejects.toBeInstanceOf(NotFoundException);
  });

  it("answers 404 when the board is deleted before the timeout", async () => {
    const mocks = setup();
    mocks.boardFindFirst
      .mockResolvedValueOnce(board())
      .mockResolvedValueOnce(null);
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);

    await expect(
      mocks.service.getBoardReady("b1", { userId: "u1", wait: 15 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses a held poll when the admission cap is reached", async () => {
    const mocks = setup({ polls: new ReadyPollAdmission(0, 10) });
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);

    await expect(
      mocks.service.getBoardReady("b1", { userId: "u1", wait: 5_000 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mocks.polls.active()).toBe(0);
  });
});

describe("ReadyPollAdmission", () => {
  it("caps per user and per board and releases exactly once", () => {
    const polls = new ReadyPollAdmission(1, 2);
    const release = polls.acquire("u1", "b1");
    expect(release).not.toBeNull();
    expect(polls.acquire("u1", "b2")).toBeNull();
    const release2 = polls.acquire("u2", "b1");
    expect(release2).not.toBeNull();
    expect(polls.acquire("u3", "b1")).toBeNull();
    expect(polls.active()).toBe(2);
    release?.();
    release?.();
    expect(polls.active()).toBe(1);
    expect(polls.acquire("u1", "b2")).not.toBeNull();
  });
});

describe("ReadyService.listReadyForUser", () => {
  it("answers for every accessible board with constant-size SQL", async () => {
    const mocks = setup();
    mocks.boardFindMany.mockResolvedValue([
      board(),
      {
        id: "b2",
        title: "Beta",
        archivedAt: null,
        workflow: null,
        columns: [{ id: "col-3", title: "Next" }],
      },
      {
        id: "b3",
        title: "Archived",
        archivedAt: new Date("2026-01-01T00:00:00Z"),
        workflow: null,
        columns: [{ id: "col-4", title: "Old" }],
      },
    ]);
    mocks.groupBy.mockResolvedValue([
      { boardId: "b1", _max: { seq: BigInt(2) } },
      { boardId: "b2", _max: { seq: BigInt(5) } },
    ]);
    mocks.queryRaw.mockResolvedValue([
      {
        ...CARD_ROW,
        id: "card-9",
        columnId: "col-3",
        columnTitle: "Next",
        boardId: "b2",
      },
    ]);

    const result = await mocks.service.listReadyForUser("u1", undefined, 10);

    expect(mocks.boardFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.boardFindFirst).not.toHaveBeenCalled();
    expect(result.boards).toEqual([
      { id: "b1", title: "Alpha", archived: false, seq: 2 },
      { id: "b2", title: "Beta", archived: false, seq: 5 },
      {
        id: "b3",
        title: "Archived",
        archived: true,
        seq: 0,
      },
    ]);
    expect(result.cards).toEqual([
      expect.objectContaining({
        id: "card-9",
        boardId: "b2",
        boardTitle: "Beta",
        columnId: "col-3",
        columnTitle: "Next",
      }),
    ]);
    const query = sqlCall(mocks.queryRaw);
    expect(query.strings?.join("?")).not.toMatch(/c\."description"(?!Length)/);
    expect(query.strings?.join("?")).toMatch(
      /c\."descriptionLength"\s+AS\s+"descriptionChars"/,
    );
    expect(query.values).toContain("col-1");
    expect(query.values).toContain("col-3");
    // An archived board never contributes a column to the card query.
    expect(query.values).not.toContain("col-4");
  });

  it("skips the card query when no accessible board is active", async () => {
    const mocks = setup();
    mocks.boardFindMany.mockResolvedValue([
      {
        id: "b3",
        title: "Archived",
        archivedAt: new Date("2026-01-01T00:00:00Z"),
        workflow: null,
        columns: [{ id: "col-4", title: "Old" }],
      },
    ]);
    mocks.groupBy.mockResolvedValue([]);

    const result = await mocks.service.listReadyForUser("u1", "b3", 10);

    expect(result.cards).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});

describe("ready realtime filter", () => {
  it("wakes on readiness actions, not on every command that touches board:", () => {
    expect(
      isReadyFrame(commandFrame("ADD_CARD", ["board:b1", "card:c1"])),
    ).toBe(true);
    expect(
      isReadyFrame(commandFrame("MOVE_CARD", ["board:b1", "card:c1"])),
    ).toBe(true);
    expect(isReadyFrame(commandFrame("SET_BOARD_WORKFLOW", ["board:b1"]))).toBe(
      true,
    );
    expect(isReadyFrame(commandFrame("ARCHIVE_BOARD", ["board:b1"]))).toBe(
      true,
    );

    // Every command carries `board:`; label/checklist/rename frames must not
    // wake a waiter even though they touch a card or the board.
    expect(
      isReadyFrame(
        commandFrame("SET_CARD_LABEL", ["board:b1", "card:c1", "label:l1"]),
      ),
    ).toBe(false);
    expect(isReadyFrame(commandFrame("RENAME_BOARD", ["board:b1"]))).toBe(
      false,
    );
    expect(
      isReadyFrame(
        commandFrame("SET_CHECKLIST_ITEM_DONE", [
          "board:b1",
          "checklistItem:i1",
        ]),
      ),
    ).toBe(false);
    expect(
      isReadyFrame({
        type: "activity",
        id: "a1",
        boardId: "b1",
        at: 1,
        kind: "comment_added",
      }),
    ).toBe(false);
    expect(isReadyFrame({ type: "resync" })).toBe(true);
    expect(
      isReadyFrame({
        type: "presence",
        op: "leave",
        userId: "u1",
      } as BoardSseEvent),
    ).toBe(false);
  });

  it("gives every node-local resync frame the same shared wake key", () => {
    const frame = { type: "resync" } as BoardSseEvent;
    expect(wakeKeyOf(frame)).toBe(wakeKeyOf(frame));
  });
});

function commandFrame(type: string, touches: string[], seq = 8): BoardSseEvent {
  return {
    type: "command",
    seq,
    action: { type },
    actorId: "u1",
    touches,
  } as unknown as BoardSseEvent;
}
