import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ActorType } from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CARD_ATTACHMENT_WHERE } from "@/attachments/card-attachments";
import { StorageService } from "@/attachments/storage.service";
import { BoardsService } from "@/boards/boards.service";
import {
  deleteCommentActivitySnapshots,
  lockBoardWrites,
  verifyCommentHistory,
} from "@/comments/comment-history";

/** TASK-166 D22/§12.5: the self-service deletion window. */
export const ACCOUNT_DELETE_GRACE_DAYS = 7;
export const ACCOUNT_DELETE_SCHEDULED_ACTION = "account.delete_scheduled";
export const ACCOUNT_DELETE_CANCELLED_ACTION = "account.delete_cancelled";
export const BOARD_CLEANUP_FAILED_ACTION = "board.cleanup_failed";
export const BOARD_CLEANUP_RECOVERED_ACTION = "board.cleanup_recovered";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountDeletionSummary {
  userId: string;
  email: string;
  exports: number;
  blobs: number;
}

/**
 * One implementation of "erase this account" (TASK-166 §12.5), shared by the
 * master panel and the self-service schedule so both follow identical rules.
 *
 * The schema has no `deleteAfter` column (frozen by 166.1), so the schedule is
 * an append-only `SecurityAuditLog` row: `disabledAt` blocks every login at
 * once, and the maintenance sweep hard-deletes the account only after the
 * seven-day window. Re-enabling the account from the panel sets
 * `disabledAt = NULL`; the sweep then skips it, which is the intended
 * cancellation path.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly boards: BoardsService,
  ) {}

  /** Disable the account now and record the seven-day hard-delete date. */
  async schedule(
    userId: string,
    actorId: string,
    attribution: {
      actorType?: ActorType;
      apiTokenId?: string | null;
      agentSessionId?: string | null;
    } = {},
  ): Promise<{ deleteAfter: Date }> {
    return this.prisma.$transaction((tx) =>
      this.scheduleInTransaction(tx, userId, actorId, attribution),
    );
  }

  /**
   * The transaction half of `schedule`. Callers that must verify a
   * credential under the same lock (self-service deletion) pass their own
   * `tx`; the lock is taken here, and re-taking it in the same transaction
   * is harmless.
   */
  async scheduleInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    actorId: string,
    attribution: {
      actorType?: ActorType;
      apiTokenId?: string | null;
      agentSessionId?: string | null;
    } = {},
  ): Promise<{ deleteAfter: Date }> {
    const now = new Date();
    const deleteAfter = new Date(
      now.getTime() + ACCOUNT_DELETE_GRACE_DAYS * DAY_MS,
    );
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    const tokenIds = (
      await tx.apiToken.findMany({
        where: { userId },
        select: { id: true },
      })
    ).map((token) => token.id);

    await tx.user.update({
      where: { id: userId },
      data: { disabledAt: now },
    });
    await tx.apiToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.agentSession.updateMany({
      where: {
        userId,
        status: { notIn: ["completed", "failed", "cancelled"] },
      },
      data: {
        status: "cancelled",
        endedAt: now,
        endReason: "account_delete",
      },
    });
    await this.releaseClaims(tx, userId, tokenIds, now);
    await tx.securityAuditLog.create({
      data: {
        userId,
        actorId,
        actorType: attribution.actorType ?? "human",
        apiTokenId: attribution.apiTokenId ?? null,
        agentSessionId: attribution.agentSessionId ?? null,
        action: ACCOUNT_DELETE_SCHEDULED_ACTION,
        targetType: "user",
        targetId: userId,
        details: { deleteAfter: deleteAfter.toISOString() },
        createdAt: now,
      },
    });
    return { deleteAfter };
  }

  /**
   * User ids whose grace window has elapsed and whose account is still
   * disabled. A panel re-enable clears `disabledAt` and therefore cancels.
   */
  async usersDueForDeletion(cutoff: Date): Promise<string[]> {
    // The latest schedule per user is the source of truth. A re-enabled
    // account that was scheduled again must wait its full seven days from
    // the *new* request; an older marker must not shorten the window.
    const grouped = await this.prisma.securityAuditLog.groupBy({
      by: ["userId"],
      where: { action: ACCOUNT_DELETE_SCHEDULED_ACTION },
      _max: { createdAt: true },
    });
    const latest = new Map<string, Date>();
    for (const row of grouped) {
      if (row._max.createdAt !== null) {
        latest.set(row.userId, row._max.createdAt);
      }
    }
    const ids = [...latest.entries()]
      .filter(([, at]) => at <= cutoff)
      .map(([id]) => id);
    if (ids.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, disabledAt: { not: null } },
      select: { id: true, disabledAt: true },
    });
    // A later admin disable must not borrow an older schedule. Only a
    // `disabledAt` at or before the latest schedule marker is a valid
    // self-service deletion window.
    return users
      .filter((user) => {
        const scheduledAt = latest.get(user.id);
        return (
          scheduledAt !== undefined &&
          user.disabledAt !== null &&
          user.disabledAt <= scheduledAt
        );
      })
      .map((user) => user.id);
  }

  /**
   * Best-effort board cleanup; failed boards are queued for the durable
   * reaper via `board.cleanup_failed`.
   */
  async cleanupOrphanBoards(
    userId: string,
    boardIds: string[],
  ): Promise<number> {
    let cleaned = 0;
    for (const boardId of boardIds) {
      const remaining = await this.prisma.boardMember.count({
        where: { boardId, acceptedAt: { not: null } },
      });
      if (remaining !== 0) continue;
      let deleted = false;
      let lastError = "unknown";
      for (let attempt = 0; attempt < 2 && !deleted; attempt += 1) {
        try {
          await this.boards.deleteBoard(
            boardId,
            userId,
            {
              actorType: "human",
              apiTokenId: null,
              agentSessionId: null,
              runId: null,
              agentName: null,
            },
            undefined,
            false,
            true,
          );
          deleted = true;
          cleaned += 1;
        } catch (error) {
          if (error instanceof ConflictException) {
            deleted = true;
            break;
          }
          lastError = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Account deletion could not remove empty board ${boardId} (attempt ${
              attempt + 1
            }): ${lastError}`,
          );
        }
      }
      if (!deleted) {
        await this.prisma.securityAuditLog
          .create({
            data: {
              userId,
              actorId: userId,
              actorType: "human",
              action: BOARD_CLEANUP_FAILED_ACTION,
              targetType: "board",
              targetId: boardId,
              details: { reason: lastError },
            },
          })
          .catch(() => undefined);
      }
    }
    return cleaned;
  }

  /**
   * Durable retry for boards left behind by an account erasure (TASK-166.6).
   * Called by `sweep-orphan-boards`; a failed marker is kept for the next run.
   */
  async reapOrphanBoards(
    cutoff: Date = new Date(Date.now() - 60 * 60 * 1000),
  ): Promise<number> {
    const rows = await this.prisma.securityAuditLog.findMany({
      where: {
        action: BOARD_CLEANUP_FAILED_ACTION,
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { id: true, userId: true, targetId: true },
    });
    const byBoard = new Map<string, { userId: string; markerIds: string[] }>();
    for (const row of rows) {
      if (!row.targetId) continue;
      const entry = byBoard.get(row.targetId) ?? {
        userId: row.userId,
        markerIds: [],
      };
      entry.markerIds.push(row.id);
      byBoard.set(row.targetId, entry);
    }

    let removed = 0;
    for (const [boardId, entry] of byBoard) {
      const board = await this.prisma.board.findUnique({
        where: { id: boardId },
        select: { deletedAt: true },
      });
      if (board === null || board.deletedAt !== null) {
        await this.prisma.securityAuditLog.deleteMany({
          where: { id: { in: entry.markerIds } },
        });
        continue;
      }
      const remaining = await this.prisma.boardMember.count({
        where: { boardId, acceptedAt: { not: null } },
      });
      if (remaining > 0) {
        // The board is no longer an orphan (someone joined/re-enabled it).
        await this.prisma.securityAuditLog.deleteMany({
          where: { id: { in: entry.markerIds } },
        });
        continue;
      }
      try {
        await this.boards.deleteBoard(
          boardId,
          entry.userId,
          {
            actorType: "human",
            apiTokenId: null,
            agentSessionId: null,
            runId: null,
            agentName: null,
          },
          undefined,
          false,
          true,
        );
        await this.prisma.securityAuditLog.deleteMany({
          where: { id: { in: entry.markerIds } },
        });
        await this.prisma.securityAuditLog.create({
          data: {
            userId: entry.userId,
            actorId: entry.userId,
            actorType: "human",
            action: BOARD_CLEANUP_RECOVERED_ACTION,
            targetType: "board",
            targetId: boardId,
            details: { reason: "sweep_orphan_boards" },
          },
        });
        removed += 1;
      } catch (error) {
        if (error instanceof ConflictException) {
          await this.prisma.securityAuditLog.deleteMany({
            where: { id: { in: entry.markerIds } },
          });
          continue;
        }
        this.logger.warn(
          `Orphan-board reaper could not delete ${boardId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return removed;
  }

  /**
   * Hard-delete one account and its personal rows, then clean blobs. Board
   * rows it authored stay where the master-panel delete leaves them; only
   * the user's own records and memberships go.
   */
  async deleteAccount(
    userId: string,
    actor: { actorId?: string; actorType?: ActorType } = {},
    dueCutoff?: Date,
    unverifiedBefore?: Date,
  ): Promise<AccountDeletionSummary | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const [blobs, exports, tokens, memberships] = await Promise.all([
      this.prisma.attachment.findMany({
        where: { uploadedById: userId },
        select: {
          storedName: true,
          thumbnailName: true,
          posterName: true,
          cardId: true,
        },
      }),
      this.prisma.dataExport.findMany({
        where: { userId },
        select: { storedName: true },
      }),
      this.prisma.apiToken.findMany({
        where: { userId },
        select: { id: true },
      }),
      this.prisma.boardMember.findMany({
        where: { userId, acceptedAt: { not: null } },
        select: { boardId: true },
      }),
    ]);
    const affectedCards = [...new Set(blobs.map((blob) => blob.cardId))];
    const tokenKeys = tokens.map((token) => `token:${token.id}`);
    const boardIds = [...new Set(memberships.map((row) => row.boardId))];
    const now = new Date();

    const deleted = await this.prisma.$transaction(async (tx) => {
      // `FOR NO KEY UPDATE` still serializes two erasures of the same user,
      // but it is compatible with the KEY SHARE a concurrent revision insert
      // takes on `User` through `CommentRevision.editorId`. A plain
      // `FOR UPDATE` here deadlocked with that writer (40P01).
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
      if (dueCutoff !== undefined) {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { disabledAt: true },
        });
        const latest = await tx.securityAuditLog.findFirst({
          where: { userId, action: ACCOUNT_DELETE_SCHEDULED_ACTION },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (
          !current?.disabledAt ||
          !latest ||
          latest.createdAt > dueCutoff ||
          current.disabledAt > latest.createdAt
        )
          return false;
      }
      // M3 guard: a user who verified the address or acquired protection
      // between the sweep's read and this lock must survive. The scale of the
      // check lives in this transaction on purpose: the outer counts are only
      // a cheap prefilter, and a membership/comment/command/attachment can
      // commit between them and this point. A self-created board always has
      // an accepted ADMIN membership, so the membership count also protects
      // that case; the FK on the content tables is the final backstop if a
      // writer still slips in after these reads.
      if (unverifiedBefore !== undefined) {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { emailVerifiedAt: true, createdAt: true },
        });
        if (
          !current ||
          current.emailVerifiedAt !== null ||
          current.createdAt >= unverifiedBefore
        )
          return false;
        const [memberships, comments, commands, attachments] =
          await Promise.all([
            tx.boardMember.count({
              where: { userId, acceptedAt: { not: null } },
            }),
            tx.comment.count({ where: { authorId: userId } }),
            tx.command.count({ where: { actorId: userId } }),
            tx.attachment.count({ where: { uploadedById: userId } }),
          ]);
        if (
          memberships > 0 ||
          comments > 0 ||
          commands > 0 ||
          attachments > 0
        ) {
          return false;
        }
      }
      await tx.agentSession.deleteMany({ where: { userId } });
      await tx.approvalRequest.deleteMany({ where: { requestedBy: userId } });
      await tx.idempotencyRecord.deleteMany({
        where: {
          OR: [{ actorKey: `user:${userId}` }, { actorKey: { in: tokenKeys } }],
        },
      });
      await tx.emailVerificationCode.deleteMany({ where: { userId } });
      await tx.emailChangeCode.deleteMany({ where: { userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.apiToken.deleteMany({ where: { userId } });
      await tx.attentionNotification.deleteMany({ where: { userId } });
      await tx.notificationMail.deleteMany({ where: { userId } });
      await tx.dataExport.deleteMany({ where: { userId } });
      await tx.attachment.deleteMany({ where: { uploadedById: userId } });
      // TASK-185.1: history cleanup must happen before the user row (the
      // editor FK is RESTRICT) and before comments/Activity disappear.
      // Lock every accepted-member board BEFORE reading candidates: a writer
      // that already holds a board lock can no longer append a revision in
      // the window between the candidate query and the cleanup.
      const lockedBoardIds = new Set(boardIds);
      await lockBoardWrites(tx, lockedBoardIds);
      let authoredComments: Array<{
        id: string;
        card: { column: { boardId: string } };
      }> = [];
      let editedComments: Array<{
        id: string;
        card: { column: { boardId: string } };
      }> = [];
      for (;;) {
        authoredComments = await tx.comment.findMany({
          where: { authorId: userId },
          select: {
            id: true,
            card: { select: { column: { select: { boardId: true } } } },
          },
        });
        const authoredIds = authoredComments.map((row) => row.id);
        const editedCommentIds = await this.commentIdsEditedBy(
          tx,
          userId,
          authoredIds,
        );
        editedComments = await tx.comment.findMany({
          where: { id: { in: editedCommentIds } },
          select: {
            id: true,
            card: { select: { column: { select: { boardId: true } } } },
          },
        });
        // A membership created after the outer read can expose another board.
        // Lock it and re-query; the next pass sees every writer blocked.
        const discovered = [
          ...authoredComments.map((row) => row.card.column.boardId),
          ...editedComments.map((row) => row.card.column.boardId),
        ].filter((boardId) => !lockedBoardIds.has(boardId));
        if (discovered.length === 0) break;
        await lockBoardWrites(tx, discovered);
        for (const boardId of discovered) lockedBoardIds.add(boardId);
      }
      const authoredIds = authoredComments.map((row) => row.id);

      if (authoredIds.length > 0) {
        await deleteCommentActivitySnapshots(tx, authoredIds);
        await tx.commentRevision.deleteMany({
          where: { commentId: { in: authoredIds } },
        });
      }
      for (const { id: commentId } of editedComments) {
        // Re-read after the locks: a writer that committed earlier may have
        // changed the text or the verified pair.
        const comment = await tx.comment.findUnique({
          where: { id: commentId },
          select: {
            id: true,
            cardId: true,
            kind: true,
            text: true,
            editedAt: true,
            lastRevisionNumber: true,
            historyCutoverAt: true,
            historyVerifiedEditedAt: true,
            historyVerifiedRevisionNumber: true,
            historyIncompleteReason: true,
          },
        });
        if (comment === null) continue;
        // A confirmed chain loses its number after the cleanup; an
        // unconfirmed one keeps the mismatch so the next sweep finds it.
        const verified = await verifyCommentHistory(tx, comment);
        // The reason merge is a SQL CASE so a concurrent trim cannot
        // downgrade gdpr_erase back to revision_limit.
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Comment"
          SET "historyIncompleteReason" = CASE
                WHEN "historyIncompleteReason" = 'writer_gap'::"CommentHistoryIncompleteReason"
                  THEN "historyIncompleteReason"
                ELSE 'gdpr_erase'::"CommentHistoryIncompleteReason"
              END,
              "historyVerifiedRevisionNumber" = CASE
                WHEN ${verified} THEN NULL
                ELSE "historyVerifiedRevisionNumber"
              END
          WHERE "id" = ${commentId}
        `);
        await tx.commentRevision.deleteMany({ where: { commentId } });
        await deleteCommentActivitySnapshots(tx, [commentId], {
          onlyUpdates: true,
        });
      }
      await tx.comment.deleteMany({ where: { authorId: userId } });
      await tx.activity.deleteMany({ where: { actorId: userId } });
      // ADR §6.14 purge order: preimages → commands → runs. The preimage
      // table has no actor column, so resolve the user's commands in SQL
      // before the command rows disappear.
      await tx.$executeRaw`
        DELETE FROM "CommandPreimage"
        WHERE "commandId" IN (
          SELECT "id" FROM "Command" WHERE "actorId" = ${userId}
        )
      `;
      await tx.command.deleteMany({ where: { actorId: userId } });
      await tx.agentRun.deleteMany({ where: { actorId: userId } });
      await tx.boardMember.deleteMany({ where: { userId } });
      await tx.boardMember.updateMany({
        where: { invitedById: userId },
        data: { invitedById: null },
      });
      await tx.card.updateMany({
        where: { assigneeId: userId },
        data: { assigneeId: null },
      });
      // A self-service erasure must not leave a live public link created by
      // the account behind. Snapshot shares are frozen content and survive.
      await tx.boardShare.updateMany({
        where: { createdBy: userId, mode: "live", revokedAt: null },
        data: { revokedAt: now },
      });
      await this.releaseClaims(
        tx,
        userId,
        tokens.map((token) => token.id),
        now,
      );
      await tx.user.delete({ where: { id: userId } });
      return true;
    });
    if (!deleted) return null;

    // Boards with no accepted members left are unusable; soft-delete them
    // through the same path as a normal board delete. Pending invitations do
    // not keep a board alive. A board that still has accepted members but no
    // ADMIN is left to the operator: silently promoting a MEMBER or deleting
    // shared content would be a worse surprise.
    await this.cleanupOrphanBoards(userId, boardIds);

    if (user.avatarPath) {
      await this.storage
        .remove(this.storage.avatarPath(user.avatarPath))
        .catch(() => undefined);
    }

    for (const cardId of affectedCards) {
      const live = await this.prisma.attachment.count({
        where: { cardId, ...CARD_ATTACHMENT_WHERE },
      });
      await this.prisma.card.updateMany({
        where: { id: cardId },
        data: { attachmentCount: live },
      });
    }
    for (const blob of blobs) {
      for (const name of [
        blob.storedName,
        blob.thumbnailName,
        blob.posterName,
      ]) {
        if (name) {
          await this.storage
            .remove(this.storage.attachmentPath(name))
            .catch(() => undefined);
        }
      }
    }
    for (const row of exports) {
      if (row.storedName) {
        await this.storage
          .remove(this.storage.attachmentPath(row.storedName))
          .catch(() => undefined);
      }
    }

    try {
      await this.prisma.securityAuditLog.create({
        data: {
          userId,
          actorId: actor.actorId ?? userId,
          actorType: actor.actorType ?? "admin",
          action: "account.deleted",
          targetType: "user",
          targetId: userId,
          details: { exports: exports.length, blobs: blobs.length },
        },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to write account.deleted for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      userId,
      email: user.email,
      exports: exports.length,
      blobs: blobs.length,
    };
  }

  /**
   * TASK-185.1: comments by another author that the erased user edited,
   * detected through immutable revisions or `comment_updated` Activity. The
   * Activity rows are still present here; they are deleted after this step.
   */
  private async commentIdsEditedBy(
    tx: Prisma.TransactionClient,
    userId: string,
    excluded: readonly string[],
  ): Promise<string[]> {
    const excludedIds = new Set(excluded);
    const [revisions, activities] = await Promise.all([
      tx.commentRevision.findMany({
        where: { editorId: userId },
        select: { commentId: true },
      }),
      tx.activity.findMany({
        where: { actorId: userId, type: "comment_updated" },
        select: { details: true },
      }),
    ]);
    const ids = new Set<string>();
    for (const revision of revisions) ids.add(revision.commentId);
    for (const activity of activities) {
      const details = activity.details;
      if (details === null || typeof details !== "object") continue;
      if (Array.isArray(details)) continue;
      const commentId = (details as Record<string, unknown>).commentId;
      if (typeof commentId === "string") ids.add(commentId);
    }
    return [...ids].filter((id) => !excludedIds.has(id));
  }

  private async releaseClaims(
    tx: Prisma.TransactionClient,
    userId: string,
    tokenIds: string[],
    at: Date,
  ): Promise<void> {
    const owners: Prisma.CardWhereInput[] = [{ claimedBy: userId }];
    if (tokenIds.length > 0) {
      owners.push({ claimedByTokenId: { in: tokenIds } });
    }
    const holders = await tx.card.findMany({
      where: { OR: owners, leaseUntil: { not: null } },
      select: { id: true, claimedBySessionId: true },
    });
    if (holders.length === 0) return;
    const sessionIds = holders
      .map((card) => card.claimedBySessionId)
      .filter((id): id is string => id !== null);
    await tx.card.updateMany({
      where: { id: { in: holders.map((card) => card.id) } },
      data: {
        claimedBy: null,
        claimedByTokenId: null,
        claimedBySessionId: null,
        leaseUntil: null,
      },
    });
    if (sessionIds.length > 0) {
      await tx.agentSession.updateMany({
        where: { id: { in: sessionIds }, endedAt: null },
        data: { endedAt: at, status: "cancelled", endReason: "claim_released" },
      });
    }
  }
}
