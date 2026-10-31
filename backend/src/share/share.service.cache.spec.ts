import { ShareAggregateCache } from "./share-aggregate-cache";
import { ShareService } from "./share.service";

type ShareArg = Parameters<ShareService["publicBoard"]>[0];

/** A minimal `BoardShare` row for the live branch. */
function shareRow(boardId: string): ShareArg {
  return {
    id: "s1",
    boardId,
    mode: "live",
    title: null,
    includeComments: false,
    includeAttachments: false,
    snapshot: null,
    snapshotVersion: null,
    revokedAt: null,
    expiresAt: null,
    views: 0,
    lastViewedAt: null,
    createdAt: new Date(),
    createdBy: "u1",
    token: "t1",
  } as unknown as ShareArg;
}

/**
 * TASK-141: the live public-share read is served from a short-TTL cache keyed
 * by the board's command `seq`. The cache is disabled in the test env, so this
 * spec installs an enabled one on the service directly.
 */
describe("ShareService live aggregate cache", () => {
  function make(seq: { value: number }) {
    const boards = {
      getAggregateWithSeq: jest.fn(async () => ({
        board: { id: "b1" },
        seq: seq.value,
      })),
    };
    const prisma = {
      command: {
        aggregate: jest.fn(async () => ({ _max: { seq: seq.value } })),
      },
      board: { findFirst: jest.fn(async () => ({ id: "b1" })) },
      boardMember: { findMany: jest.fn(async () => []) },
      boardShare: { update: jest.fn(async () => ({})) },
    };
    const deps = [
      prisma,
      boards,
      {},
      {},
      { isEnabled: async () => true },
    ] as unknown as ConstructorParameters<typeof ShareService>;
    const service = new ShareService(...deps);
    // Enable the cache for this spec (the test env sets the window to 0).
    (
      service as unknown as { aggregateCache: ShareAggregateCache }
    ).aggregateCache = new ShareAggregateCache(2000);
    return { service, boards };
  }

  it("rebuilds the aggregate only once while the seq is unchanged", async () => {
    const seq = { value: 7 };
    const { service, boards } = make(seq);
    const share = shareRow("b1");

    await service.publicBoard(share);
    await service.publicBoard(share);

    expect(boards.getAggregateWithSeq).toHaveBeenCalledTimes(1);
  });

  it("rebuilds again once a command bumps the seq", async () => {
    const seq = { value: 7 };
    const { service, boards } = make(seq);
    const share = shareRow("b1");

    await service.publicBoard(share);
    seq.value = 8;
    await service.publicBoard(share);

    expect(boards.getAggregateWithSeq).toHaveBeenCalledTimes(2);
  });
});
