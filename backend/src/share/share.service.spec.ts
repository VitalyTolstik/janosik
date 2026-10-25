import { GoneException, NotFoundException } from "@nestjs/common";
import type { Board } from "@janosik/shared";
import { ShareService } from "./share.service";

/**
 * Unit coverage for the pure logic of `ShareService` (TASK-58): token
 * minting, defaults, snapshot capture and resilience, expiry/revoke gating,
 * privacy filtering and the view counter. The e2e suite owns the HTTP
 * contour; here every dependency is a tiny in-memory fake.
 */

const BOARD: Board = {
  id: "b1",
  title: "Unit board",
  columns: [{ id: "c1", title: "Todo", cardIds: ["k1"], createdAt: 1 }],
  cards: {
    k1: {
      id: "k1",
      title: "Card",
      labelIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  },
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

interface ShareRow {
  id: string;
  token: string;
  board: { connect: { id: string } };
  boardId: string;
  mode: string;
  snapshot: unknown;
  snapshotVersion: number | null;
  title: string | null;
  includeComments: boolean;
  includeAttachments: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdBy: string;
  views: number;
  lastViewedAt: Date | null;
  createdAt: Date;
}

function makeHarness(options: { alive?: boolean } = {}) {
  let alive = options.alive ?? true;
  const shares: ShareRow[] = [];
  let counter = 0;

  const boardRow = {
    id: BOARD.id,
    title: BOARD.title,
    deletedAt: null,
    archivedAt: null,
  };

  const prisma = {
    board: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        alive && where.id === boardRow.id ? boardRow : null,
    },
    boardShare: {
      create: async ({
        data,
      }: {
        data: Omit<
          ShareRow,
          "id" | "views" | "revokedAt" | "createdAt" | "lastViewedAt"
        >;
      }) => {
        const row: ShareRow = {
          ...data,
          id: `s${(counter += 1)}`,
          boardId: data.board.connect.id,
          views: 0,
          revokedAt: null,
          lastViewedAt: null,
          createdAt: new Date(),
        };
        shares.push(row);
        return row;
      },
      findUnique: async ({
        where,
      }: {
        where: { id?: string; token?: string };
      }) =>
        shares.find((s) => s.id === where.id || s.token === where.token) ??
        null,
      findMany: async ({ where }: { where?: { boardId?: string } } = {}) =>
        shares.filter((s) => !where?.boardId || s.boardId === where.boardId),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown> & { views?: { increment: number } };
      }) => {
        const row = shares.find((s) => s.id === where.id);
        if (!row) throw new NotFoundException();
        if (data.views) row.views += data.views.increment;
        for (const key of [
          "includeComments",
          "includeAttachments",
          "title",
          "expiresAt",
          "revokedAt",
          "snapshot",
          "snapshotVersion",
          "lastViewedAt",
        ] as const) {
          if (key in data)
            (row as unknown as Record<string, unknown>)[key] = data[key];
        }
        return row;
      },
    },
    boardMember: {
      findMany: async () => [
        {
          userId: "u1",
          user: {
            id: "u1",
            displayName: "Ann",
            avatarColor: "blue",
            avatarPath: null,
            email: "ann@example.com",
          },
        },
      ],
    },
    card: { findFirst: async () => null },
  };

  const boards = {
    getAggregateWithSeq: async (boardId: string) => {
      if (!alive || boardId !== BOARD.id) throw new NotFoundException();
      return { board: BOARD, seq: 7 };
    },
    getAggregate: async (boardId: string) => {
      if (!alive || boardId !== BOARD.id) throw new NotFoundException();
      return BOARD;
    },
  };

  const comments = { list: async () => ({ items: [], nextCursor: null }) };
  const attachments = {
    list: async () => [],
    content: async () => {
      throw new NotFoundException();
    },
  };

  const service = new ShareService(
    prisma as never,
    boards as never,
    comments as never,
    attachments as never,
  );
  return {
    service,
    shares,
    prisma,
    setAlive: (next: boolean) => (alive = next),
  };
}

describe("ShareService (unit)", () => {
  it("mints URL-safe, unique tokens", async () => {
    const { service } = makeHarness();
    const tokens = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const share = await service.create("b1", "u1", { mode: "live" });
      expect(share.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(share.token.length).toBeGreaterThanOrEqual(20);
      tokens.add(share.token);
    }
    expect(tokens.size).toBe(40);
  });

  it("defaults: live keeps comments, snapshot hides them; attachments off", async () => {
    const { service } = makeHarness();
    const live = await service.create("b1", "u1", { mode: "live" });
    expect(live.includeComments).toBe(true);
    expect(live.includeAttachments).toBe(false);
    const snap = await service.create("b1", "u1", { mode: "snapshot" });
    expect(snap.includeComments).toBe(false);
    expect(snap.includeAttachments).toBe(false);
  });

  it("freezes the aggregate and the sanitized roster into a snapshot", async () => {
    const { service } = makeHarness();
    const share = await service.create("b1", "u1", { mode: "snapshot" });
    const payload = await service.publicBoard(
      await service.requireShare(share.id),
    );
    expect(payload.mode).toBe("snapshot");
    expect(payload.seq).toBe(7);
    expect(payload.board.cards.k1).toBeDefined();
    expect(payload.members).toEqual([
      { id: "u1", displayName: "Ann", avatarColor: "blue", avatarPath: null },
    ]);
    // No email anywhere in the roster.
    for (const member of payload.members) {
      expect(member).not.toHaveProperty("email");
    }
  });

  it("a snapshot survives the source board being deleted", async () => {
    const { service, setAlive } = makeHarness();
    const share = await service.create("b1", "u1", { mode: "snapshot" });
    setAlive(false);
    const row = await service.requireShare(share.id);
    const payload = await service.publicBoard(row);
    expect(payload.board.cards.k1).toBeDefined();
  });

  it("rejects a past expiry and accepts a future one", async () => {
    const { service } = makeHarness();
    await expect(
      service.create("b1", "u1", {
        mode: "live",
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 400 });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const share = await service.create("b1", "u1", {
      mode: "live",
      expiresAt: future,
    });
    expect(share.expiresAt).toBeGreaterThan(Date.now());
  });

  it("gates on revoke and expiry with a bare 404", async () => {
    const { service } = makeHarness();
    const share = await service.create("b1", "u1", { mode: "live" });
    await service.revoke(share.id);
    await expect(service.resolveToken(share.token)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const share2 = await service.create("b1", "u1", { mode: "live" });
    const row = await service.requireShare(share2.id);
    (row as unknown as { expiresAt: Date }).expiresAt = new Date(
      Date.now() - 1000,
    );
    await expect(service.resolveToken(share2.token)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("counts a view per payload read", async () => {
    const { service } = makeHarness();
    const share = await service.create("b1", "u1", { mode: "snapshot" });
    const row = await service.requireShare(share.id);
    await service.publicBoard(row);
    await service.publicBoard(row);
    const after = await service.requireShare(share.id);
    expect(after.views).toBe(2);
    expect(after.lastViewedAt).not.toBeNull();
  });

  it("a live share of a deleted board answers 410 Gone", async () => {
    const { service, setAlive } = makeHarness();
    const share = await service.create("b1", "u1", { mode: "live" });
    setAlive(false);
    const row = await service.requireShare(share.id);
    await expect(service.publicBoard(row)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it("only snapshot shares can be refreshed", async () => {
    const { service } = makeHarness();
    const live = await service.create("b1", "u1", { mode: "live" });
    await expect(service.refreshSnapshot(live.id)).rejects.toMatchObject({
      status: 400,
    });
    const snap = await service.create("b1", "u1", { mode: "snapshot" });
    const refreshed = await service.refreshSnapshot(snap.id);
    expect(refreshed.mode).toBe("snapshot");
  });
});
