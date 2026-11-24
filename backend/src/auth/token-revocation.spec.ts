import type { Prisma } from "@prisma/client";
import { revokeApiTokens } from "./token-revocation";

type Tx = Prisma.TransactionClient;

function claim(boardId: string) {
  return { column: { boardId } };
}

function txDouble(options: {
  tokens: Array<{ id: string; userId: string; boardId: string | null }>;
  memberships?: Array<{ boardId: string }>;
  claimBatches?: Array<Array<ReturnType<typeof claim>>>;
  userClaimBoards?: string[];
}) {
  let claimsRead = 0;
  const batches = options.claimBatches ?? [[]];
  const tx = {
    apiToken: {
      findMany: jest.fn().mockResolvedValue(options.tokens),
      updateMany: jest.fn().mockResolvedValue({ count: options.tokens.length }),
    },
    boardMember: {
      findMany: jest.fn().mockResolvedValue(options.memberships ?? []),
    },
    card: {
      findMany: jest.fn().mockImplementation((args: unknown) => {
        // `releaseUserClaims` reads `{ claimedBy: { in: userIds } }`.
        const where = (args as { where?: { claimedBy?: unknown } }).where ?? {};
        if (where.claimedBy !== undefined) {
          return Promise.resolve(
            (options.userClaimBoards ?? []).map((boardId) => claim(boardId)),
          );
        }
        const batch = batches[Math.min(claimsRead, batches.length - 1)] ?? [];
        claimsRead += 1;
        return Promise.resolve(batch);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    agentSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    approvalRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  return tx as unknown as Tx & {
    card: { findMany: jest.Mock; updateMany: jest.Mock };
    $executeRaw: jest.Mock;
  };
}

function lockKeys(tx: ReturnType<typeof txDouble>): string[] {
  return tx.$executeRaw.mock.calls.map((call) => call[1] as string);
}

function boardLocks(tx: ReturnType<typeof txDouble>): string[] {
  return lockKeys(tx).filter((key) => !key.startsWith("user-memberships:"));
}

describe("revokeApiTokens board locks", () => {
  it("takes the user lock before one sorted static board-lock set", async () => {
    const tx = txDouble({
      tokens: [{ id: "token-1", userId: "user-1", boardId: null }],
      memberships: [{ boardId: "board-b" }, { boardId: "board-a" }],
      claimBatches: [[claim("board-c")], [claim("board-c")]],
    });

    await revokeApiTokens(tx, { id: "token-1" });

    expect(lockKeys(tx)[0]).toBe("user-memberships:user-1");
    expect(boardLocks(tx)).toEqual(["board-a", "board-b", "board-c"]);
    expect(tx.boardMember.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ["user-1"] }, acceptedAt: { not: null } },
      select: { boardId: true },
    });
    const lastLock = Math.max(...tx.$executeRaw.mock.invocationCallOrder);
    expect(tx.card.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      lastLock,
    );
  });

  it("includes a scoped token board and its current claim board once", async () => {
    const tx = txDouble({
      tokens: [{ id: "token-1", userId: "user-1", boardId: "board-a" }],
      claimBatches: [[claim("board-z")], [claim("board-z")]],
    });

    await revokeApiTokens(tx, { id: "token-1" });

    expect(lockKeys(tx)).toEqual([
      "user-memberships:user-1",
      "board-a",
      "board-z",
    ]);
  });

  it("locks every token owner's user key before one board set", async () => {
    const tx = txDouble({
      tokens: [
        { id: "token-a", userId: "user-b", boardId: "board-1" },
        { id: "token-b", userId: "user-a", boardId: "board-2" },
      ],
    });

    await revokeApiTokens(tx, { id: { in: ["token-a", "token-b"] } });

    expect(lockKeys(tx)).toEqual([
      "user-memberships:user-a",
      "user-memberships:user-b",
      "board-1",
      "board-2",
    ]);
  });

  it("fails closed with a retryable code if a claim board appears late", async () => {
    const tx = txDouble({
      tokens: [{ id: "token-1", userId: "user-1", boardId: "board-a" }],
      claimBatches: [[], [claim("board-z")]],
    });

    await expect(revokeApiTokens(tx, { id: "token-1" })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "board_lock_set_incomplete",
        retryable: true,
      }),
    });
    expect(tx.card.updateMany).not.toHaveBeenCalled();
  });

  it("releases browser claims with no active token rows when asked", async () => {
    const tx = txDouble({
      tokens: [],
      memberships: [{ boardId: "board-a" }],
      userClaimBoards: ["board-a"],
    });

    await revokeApiTokens(tx, { userId: "user-1" }, new Date(), {
      releaseUserClaims: true,
      userIds: ["user-1"],
    });

    expect(lockKeys(tx)).toEqual(["user-memberships:user-1", "board-a"]);
    expect(tx.card.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ claimedBy: { in: ["user-1"] } }] },
      data: {
        claimedBy: null,
        claimedByTokenId: null,
        claimedBySessionId: null,
        leaseUntil: null,
      },
    });
  });
});
