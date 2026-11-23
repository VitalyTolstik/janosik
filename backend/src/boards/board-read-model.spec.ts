import type { Board as BoardRow } from "@prisma/client";
import { BoardReadModelService } from "./board-read-model";

const boardRow = {
  id: "board-1",
  title: "Board",
  workflow: null,
  agentPolicy: null,
  columnStyle: null,
  agentsPausedAt: null,
  agentsPausedBy: null,
  agentsPauseReason: null,
  archivedAt: null,
  deletedAt: null,
  aggregateRevision: 2n,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
} as unknown as BoardRow;

/**
 * TASK-200.9 query budget: the summary is bounded by the column count (one
 * first page per column plus the active/archived id reads and one archived
 * page), and a 50-card preimage batch is one card query, not 50. This is the
 * documented per-request shape; it is not divided by card count.
 */
function fakePrisma() {
  const tx = {
    board: {
      findFirst: jest.fn().mockResolvedValue(boardRow),
      findUnique: jest.fn().mockResolvedValue({ aggregateRevision: 2n }),
    },
    column: {
      findMany: jest.fn().mockResolvedValue(
        Array.from({ length: 12 }, (_, index) => ({
          id: `col-${index}`,
          title: `Column ${index}`,
          wipLimit: null,
          accentType: null,
          accentValue: null,
          position: index,
          createdAt: new Date(),
        })),
      ),
    },
    label: { findMany: jest.fn().mockResolvedValue([]) },
    card: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    cardLink: { findMany: jest.fn().mockResolvedValue([]) },
    command: {
      aggregate: jest.fn().mockResolvedValue({ _max: { seq: 7n } }),
    },
    cardLabel: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    $transaction: jest.fn(async (run: (client: typeof tx) => unknown) =>
      run(tx),
    ),
  };
  return { tx, prisma };
}

const budget = { maxWaitMs: 1_000, timeoutMs: 5_000 };

describe("BoardReadModelService query budget", () => {
  it("loads the summary in one query per column, not one per card", async () => {
    const { tx, prisma } = fakePrisma();
    const service = new BoardReadModelService(prisma as never);

    await service.summary("board-1", "MEMBER", 50, budget);

    // active ids + archived ids + 12 first pages + archived first page
    expect(tx.card.findMany).toHaveBeenCalledTimes(15);
    expect(tx.column.findMany).toHaveBeenCalledTimes(1);
    expect(tx.label.findMany).toHaveBeenCalledTimes(1);
    expect(tx.board.findFirst).toHaveBeenCalledTimes(1);
  });

  it("loads a bounded full-card preimage batch in one card query", async () => {
    const { tx, prisma } = fakePrisma();
    const service = new BoardReadModelService(prisma as never);
    const ids = Array.from({ length: 50 }, (_, index) => `card-${index}`);
    const now = new Date("2026-01-01T00:00:00Z");
    tx.card.findMany.mockResolvedValue(
      ids.map((id, position) => ({
        id,
        title: id,
        description: null,
        columnId: "col-0",
        position,
        version: 0,
        dueDate: null,
        priority: null,
        assigneeId: null,
        claimedBy: null,
        claimedByTokenId: null,
        claimedBySessionId: null,
        leaseUntil: null,
        acceptanceCriteria: [],
        definitionOfDone: [],
        coverType: null,
        coverValue: null,
        lastActorId: null,
        attachmentCount: 0,
        archivedAt: null,
        archivedFromColumnId: null,
        createdAt: now,
        updatedAt: now,
        labels: [],
        checklists: [],
      })),
    );

    await service.detailsByIds("board-1", ids, budget);

    expect(tx.card.findMany).toHaveBeenCalledTimes(1);
    expect(tx.card.findFirst).not.toHaveBeenCalled();
    expect(tx.cardLink.findMany).toHaveBeenCalledTimes(3);
  });

  it("treats a partial detail batch as all-or-nothing", async () => {
    const { tx, prisma } = fakePrisma();
    const service = new BoardReadModelService(prisma as never);

    await expect(
      service.detailsByIds("board-1", ["card-0", "missing"], budget),
    ).rejects.toThrow("Card not found");
    expect(tx.card.findMany).toHaveBeenCalledTimes(1);
  });
});
