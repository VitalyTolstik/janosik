import { BadRequestException } from "@nestjs/common";
import { Subject } from "rxjs";
import type { BoardSseEvent } from "@janosik/shared";
import type { PrismaService } from "@/common/prisma/prisma.service";
import type { RealtimeService } from "@/realtime/realtime.service";
import {
  ReadyService,
  firstWorkColumn,
  isReadyFrame,
  normalizeLimit,
  normalizeSince,
  normalizeWait,
} from "./ready.service";

/**
 * TASK-200.2 — the ready/work summary must stay a few small indexed reads,
 * never a board aggregate. These tests pin the column choice, the summary
 * shape, the query count (including the cross-board path) and every
 * long-poll exit: card, timeout, abort and a relevant realtime frame.
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

function setup(options: { watch?: Subject<BoardSseEvent> } = {}) {
  const subject = options.watch ?? new Subject<BoardSseEvent>();
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
  const service = new ReadyService(prisma, realtime);
  const boardFindFirst = prisma.board.findFirst as unknown as jest.Mock;
  const boardFindMany = prisma.board.findMany as unknown as jest.Mock;
  const groupBy = prisma.command.groupBy as unknown as jest.Mock;
  const queryRaw = prisma.$queryRaw as unknown as jest.Mock;
  const cardFindMany = prisma.card.findMany as unknown as jest.Mock;
  const columnFindMany = prisma.column.findMany as unknown as jest.Mock;
  return {
    service,
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

    const result = await mocks.service.getBoardReady("b1");

    expect(result).toMatchObject({
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
    });
    expect(result?.cards[0]).not.toHaveProperty("description");

    // The card query is scoped to the first column and carries a LIMIT.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const query = sqlCall(mocks.queryRaw);
    expect(query.strings?.join("?")).toContain('c."columnId" = ?');
    expect(query.strings?.join("?")).toContain("LIMIT ?");
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

    await mocks.service.getBoardReady("b1");

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

    const result = await mocks.service.getBoardReady("b1", { limit: 5 });
    expect(result?.cards).toEqual([]);
    expect(result?.limit).toBe(5);
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

    const result = await mocks.service.getBoardReady("b1");

    expect(result).toMatchObject({
      archived: true,
      seq: 9,
      cards: [],
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("long-polls until a relevant command wakes it", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([
      { boardId: "b1", _max: { seq: BigInt(7) } },
    ]);
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([CARD_ROW]);

    const pending = mocks.service.getBoardReady("b1", { wait: 5_000 });
    await waitFor(() => mocks.queryRaw.mock.calls.length === 1);
    mocks.subject.next(commandFrame(["card:card-1"]));
    const result = await pending;

    expect(result?.cards.map((card) => card.id)).toEqual(["card-1"]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("ignores a frame that cannot change readiness and times out with 204 semantics", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);

    const pending = mocks.service.getBoardReady("b1", {
      wait: 25,
      since: 0,
    });
    // The first empty snapshot has seq 0 === since, so the hold starts.
    await waitFor(() => mocks.queryRaw.mock.calls.length === 1);
    mocks.subject.next({
      type: "presence",
      op: "join",
      user: { id: "u1", displayName: "A", avatarColor: null, avatarPath: null },
    } as BoardSseEvent);
    expect(await pending).toBeUndefined();
  });

  it("aborts a held request when the client disconnects", async () => {
    const mocks = setup();
    mocks.boardFindFirst.mockResolvedValue(board());
    mocks.groupBy.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    const controller = new AbortController();

    const pending = mocks.service.getBoardReady("b1", {
      wait: 5_000,
      signal: controller.signal,
    });
    await waitFor(() => mocks.queryRaw.mock.calls.length === 1);
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
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
      wait: 5_000,
      since: 3,
    });

    expect(result).toMatchObject({ seq: 8, cards: [] });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
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
  it("wakes on card/column/board commands and resync, not on presence", () => {
    expect(isReadyFrame(commandFrame(["card:c1"]))).toBe(true);
    expect(isReadyFrame(commandFrame(["column:col-1"]))).toBe(true);
    expect(isReadyFrame(commandFrame(["board:b1"]))).toBe(true);
    expect(isReadyFrame(commandFrame(["label:l1"]))).toBe(false);
    expect(isReadyFrame({ type: "resync" })).toBe(true);
    expect(
      isReadyFrame({
        type: "presence",
        op: "leave",
        userId: "u1",
      } as BoardSseEvent),
    ).toBe(false);
  });
});

function commandFrame(touches: string[]): BoardSseEvent {
  return {
    type: "command",
    seq: 8,
    action: { type: "ADD_CARD" },
    actorId: "u1",
    touches,
  } as unknown as BoardSseEvent;
}
