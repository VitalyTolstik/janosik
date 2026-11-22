import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Comment } from "@prisma/client";
import {
  COMMENT_KINDS,
  DEFAULT_COMMENT_KIND,
  commentPlainExcerpt,
  extractMentionUserIds,
  type CommentDto,
  type CommentKind,
  type CommentPage,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import { activeMembershipWhere } from "@/common/membership";
import { assertBoardAcceptsWrites } from "@/common/archived-board";
import { beforeWrite, rollbackOnThrow } from "@/common/rollback-certainty";
import { AttentionService } from "@/notifications/attention.service";
import {
  deleteCommentMentionAttention,
  deleteCommentMentionAttentionForUsers,
} from "@/notifications/mention-attention";
import {
  type RequestAttribution,
  HUMAN_ATTRIBUTION,
} from "@/auth/request-attribution";
import { pauseGateFor } from "@/auth/agent-pause";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { touchAgentSessionAfterWrite } from "@/agent-sessions/agent-session-context";
import { RealtimeService } from "@/realtime/realtime.service";
import type { CreateCommentDto } from "./dto/create-comment.dto";
import type { UpdateCommentDto } from "./dto/update-comment.dto";
import { reconcileDescriptionAttachments } from "@/commands/command-writers";
import {
  commentHistoryGapException,
  writeCommentUpdate,
} from "./comment-history";

/** Default page size of `GET /cards/:id/comments` (`?limit=`). */
const DEFAULT_LIMIT = 50;
/** Upper bound for `?limit=`. */
const MAX_LIMIT = 100;

/** Body-embedded attachment references (`…/attachments/<id>/content`). */
const INLINE_ATTACHMENT_URL = /\/attachments\/([A-Za-z0-9-]+)\/content/g;

/**
 * Author display identity (TASK-177.2). A comment keeps its author's name
 * after that person leaves the board, when the roster no longer has them.
 */
const AUTHOR_INCLUDE = {
  author: { select: { displayName: true, email: true } },
} as const;

type CommentWithAuthor = Comment & {
  author?: { displayName: string | null; email: string } | null;
};

/**
 * Card comments (§7.4, TASK-28) — plain text, ordinary REST.
 *
 * Comments are not reducer actions, so each write also records an
 * `Activity` row (`comment_added` / `comment_deleted` / `comment_updated`)
 * that the activity feeds pick up. Deletion is soft (a purge job reclaims
 * rows later) and only the author may edit or delete their own comment.
 *
 * After the transaction commits each write is also published as a
 * `type: "activity"` SSE frame (TASK-37): open cards append the foreign
 * comment live instead of polling. The frame carries the comment id in
 * `detail` — recipients fetch the body through the ordinary list endpoint.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boardWrite: BoardWriteService,
    private readonly realtime: RealtimeService,
    private readonly attention: AttentionService,
  ) {}

  async create(
    cardId: string,
    authorId: string,
    dto: CreateCommentDto,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    principal?: AuthPrincipal,
  ): Promise<CommentDto> {
    const text = dto.text.trim();
    if (text.length === 0) {
      throw beforeWrite(
        new BadRequestException({
          message: "text must not be blank",
          field: "text",
        }),
      );
    }
    const card = await rollbackOnThrow(() =>
      this.prisma.card.findFirst({
        where: { id: cardId, deletedAt: null },
        select: { column: { select: { boardId: true } } },
      }),
    );
    if (!card) {
      throw beforeWrite(new NotFoundException("Card not found"));
    }
    const boardId = card.column.boardId;

    // Idempotency (TASK-99): the client key doubles as the comment id, so a
    // retried POST finds the first row instead of appending a duplicate.
    const id = dto.commandId;
    if (id !== undefined) {
      const existing = await rollbackOnThrow(() =>
        this.prisma.comment.findUnique({
          where: { id },
          include: AUTHOR_INCLUDE,
        }),
      );
      if (existing) {
        // TASK-153: the replay must belong to the caller. Without the author
        // check any member could probe another author's key and be handed
        // that comment back. TASK-166: two PATs of one account are distinct
        // writers, so a token-attributed row is bound to its apiTokenId.
        if (
          existing.cardId !== cardId ||
          existing.authorId !== authorId ||
          (existing.apiTokenId !== null &&
            existing.apiTokenId !== attribution.apiTokenId)
        ) {
          throw beforeWrite(
            new ConflictException({
              message: "commandId already used",
              code: "idempotency_conflict",
              key: id,
              field: "commandId",
            }),
          );
        }
        return toCommentDto(existing);
      }
    }

    // TASK-177.12: mentions are explicit `https://janosik.invalid/mention/<userId>` links.
    // Resolve and validate them before the write so a comment can never carry
    // a recipient outside the board's active roster.
    const mentionUserIds = await this.assertMentionMembers(boardId, text);

    let created: {
      comment: CommentWithAuthor;
      activityId: string;
      boardId: string;
    };
    try {
      created = await this.boardWrite.run(
        boardId,
        async (tx) => {
          await assertBoardAcceptsWrites(tx, boardId);
          const comment = await tx.comment.create({
            include: AUTHOR_INCLUDE,
            data: {
              ...(id !== undefined ? { id } : {}),
              cardId,
              authorId,
              text,
              kind: dto.kind ?? DEFAULT_COMMENT_KIND,
              actorType: attribution.actorType,
              apiTokenId: attribution.apiTokenId,
              agentSessionId: attribution.agentSessionId,
              agentName: attribution.agentName,
            },
          });
          await reconcileDescriptionAttachments(tx, boardId, undefined, text);
          // The comment changes the card face as well (TASK-36 attribution):
          // the commenter becomes `Card.lastActorId`, so a reload seeds the
          // same face the live SSE stamp just showed. `updatedAt` follows
          // automatically (`@updatedAt`).
          await tx.card.update({
            where: { id: cardId },
            data: { lastActorId: authorId },
          });
          const activity = await tx.activity.create({
            data: {
              boardId,
              cardId,
              type: "comment_added",
              commentId: comment.id,
              actorId: authorId,
              actorType: attribution.actorType,
              apiTokenId: attribution.apiTokenId,
              agentSessionId: attribution.agentSessionId,
              agentName: attribution.agentName,
              details: { commentId: comment.id, text },
            },
          });
          return {
            comment,
            activityId: activity.id,
            boardId,
          };
        },
        pauseGateFor(principal, attribution.agentSessionId),
      );
    } catch (error) {
      // A concurrent retry won the insert race: return its row.
      if (
        id !== undefined &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.comment.findUnique({
          where: { id },
          include: AUTHOR_INCLUDE,
        });
        if (existing && existing.cardId === cardId) {
          // Same idempotency key from a different author is a collision, not
          // a replay (TASK-156). TASK-166: a token-attributed comment is also
          // bound to its token.
          if (
            existing.authorId !== authorId ||
            (existing.apiTokenId !== null &&
              existing.apiTokenId !== attribution.apiTokenId)
          ) {
            throw new ConflictException({
              message: "Comment idempotency key is in use",
              code: "idempotency_conflict",
              key: id,
              field: "commandId",
            });
          }
          return toCommentDto(existing);
        }
        // The id exists but on another card: a collision, not a retry. A raw
        // P2002 here used to surface as a 500 (review follow-up).
        if (existing) {
          throw new ConflictException({
            message: "Comment idempotency key is in use",
            code: "idempotency_conflict",
            key: id,
            field: "commandId",
          });
        }
      }
      throw error;
    }
    this.publishActivity(
      created.boardId,
      cardId,
      created.activityId,
      authorId,
      created.comment.createdAt.getTime(),
      "comment_added",
      created.comment.id,
      attribution,
    );
    await touchAgentSessionAfterWrite(
      this.prisma,
      this.realtime,
      attribution.agentSessionId,
    );
    // TASK-166.9: only typed, agent-authored blocker/handoff comments raise
    // the human attention flag. The service is best-effort and never fails
    // the comment write.
    if (
      attribution.actorType === "agent" &&
      (created.comment.kind === "blocker" || created.comment.kind === "handoff")
    ) {
      await this.attention.notifyCommentAttention({
        boardId,
        cardId,
        commentId: created.comment.id,
        kind: created.comment.kind,
        agentName: attribution.agentName,
      });
    }
    // TASK-177.12: one attention row per mentioned active member, never for
    // the author. The service is best-effort and cannot fail the write.
    if (mentionUserIds.length > 0) {
      await this.attention.notifyCommentMention({
        boardId,
        cardId,
        commentId: created.comment.id,
        authorId,
        actorName: commentActorName(created.comment, attribution.agentName),
        mentionedUserIds: mentionUserIds,
        excerpt: commentPlainExcerpt(text),
      });
    }
    return toCommentDto(created.comment);
  }

  /**
   * Edit the caller's own comment (TASK-176.2, TASK-177.11, TASK-185.1).
   * Author-only, like delete. A text change moves `editedAt` and appends a
   * revision; a kind-only change does neither. Attribution and the original
   * `createdAt` stay untouched. Inline media removed from the text is
   * soft-deleted under the same board lock, and the change lands in the
   * activity feed / SSE stream as `comment_updated`.
   *
   * A kind change never re-sends blocker/handoff attention for a comment whose
   * notification was already delivered: the create path keys attention on
   * `agent.blocked:<commentId>` / `agent.needs_human:<commentId>`, so the
   * update path asks the same store before fanning out a first-time event.
   */
  async update(
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    principal?: AuthPrincipal,
  ): Promise<CommentDto> {
    const textProvided = dto.text !== undefined;
    const kindProvided = dto.kind !== undefined;
    if (!textProvided && !kindProvided) {
      throw beforeWrite(
        new BadRequestException({
          message: "text or kind is required",
          field: "text",
        }),
      );
    }
    if (
      kindProvided &&
      !(COMMENT_KINDS as readonly string[]).includes(dto.kind as string)
    ) {
      throw beforeWrite(
        new BadRequestException(
          `kind must be one of: ${COMMENT_KINDS.join(", ")}`,
        ),
      );
    }
    const text = textProvided ? dto.text?.trim() : undefined;
    if (textProvided && (text === undefined || text.length === 0)) {
      throw beforeWrite(
        new BadRequestException({
          message: "text must not be blank",
          field: "text",
        }),
      );
    }
    const comment = await rollbackOnThrow(() =>
      this.prisma.comment.findFirst({
        where: { id: commentId, deletedAt: null },
        select: {
          id: true,
          authorId: true,
          cardId: true,
          text: true,
          kind: true,
          actorType: true,
          agentName: true,
          card: { select: { column: { select: { boardId: true } } } },
        },
      }),
    );
    if (!comment) {
      throw beforeWrite(new NotFoundException("Comment not found"));
    }
    if (comment.authorId !== userId) {
      throw beforeWrite(
        new ForbiddenException({
          message: "Only the author can edit a comment",
          code: "scope_denied",
          requiredScope: "worker",
          action: "comment.update",
        }),
      );
    }
    const boardId = comment.card.column.boardId;
    // TASK-177.12: validate the new recipient set before the write. The
    // added/removed diff is computed again inside the board lock from the
    // actual before/after text, so a concurrent edit cannot leave stale rows.
    if (textProvided) {
      await this.assertMentionMembers(boardId, text ?? comment.text);
    }
    let addedMentionIds: string[] = [];

    const updated = await this.boardWrite.run(
      boardId,
      async (tx) => {
        await assertBoardAcceptsWrites(tx, boardId);
        // TASK-185.1: the common writer re-reads the live row under the lock,
        // reconciles the cutover chain before the no-op comparison and writes
        // one revision + Activity for a real text change.
        const written = await writeCommentUpdate(tx, {
          commentId: comment.id,
          boardId,
          ...(textProvided ? { text } : {}),
          ...(kindProvided ? { kind: dto.kind } : {}),
          editorId: userId,
          attribution,
          cause: "author_edit",
          authorize: (current) => {
            if (current.authorId !== userId) {
              throw new ForbiddenException({
                message: "Only the author can edit a comment",
                code: "scope_denied",
                requiredScope: "worker",
                action: "comment.update",
              });
            }
          },
          reconcileMedia: async (beforeText, afterText) => {
            await reconcileDescriptionAttachments(
              tx,
              boardId,
              beforeText,
              afterText,
            );
            // The under-lock texts are the source of truth for the mention
            // diff; the pre-read copy may already be stale.
            const beforeMentionIds = extractMentionUserIds(beforeText);
            const afterMentionIds = extractMentionUserIds(afterText);
            const beforeSet = new Set(beforeMentionIds);
            const afterSet = new Set(afterMentionIds);
            addedMentionIds = afterMentionIds.filter(
              (id) => !beforeSet.has(id),
            );
            const removedMentionIds = beforeMentionIds.filter(
              (id) => !afterSet.has(id),
            );
            await deleteCommentMentionAttentionForUsers(
              tx,
              comment.id,
              removedMentionIds,
            );
            // Inline pasted media lives outside
            // `reconcileDescriptionAttachments` (it tracks description embeds
            // only), so the URLs that disappeared from this comment are
            // unlinked explicitly — like a delete does for the whole body.
            const beforeIds = inlineAttachmentIds(beforeText);
            const afterIds = inlineAttachmentIds(afterText);
            const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));
            await this.unlinkInlineAttachmentIds(
              tx,
              boardId,
              removedIds,
              userId,
              attribution,
            );
          },
        });
        if (written.status === "gap") return { gap: true as const };
        if (written.status === "unchanged") {
          return {
            gap: false as const,
            changed: false as const,
            comment: written.comment,
          };
        }
        return {
          gap: false as const,
          changed: true as const,
          comment: written.comment,
          activityId: written.activityId,
          revisionId: written.revisionId,
          at: written.at,
        };
      },
      pauseGateFor(principal, attribution.agentSessionId),
    );

    // The mark is committed: reconciliation failures answer 409 only now.
    if (updated.gap) throw commentHistoryGapException();
    if (!updated.changed) return toCommentDto(updated.comment);

    this.publishActivity(
      boardId,
      comment.cardId,
      updated.activityId,
      userId,
      updated.at,
      "comment_updated",
      comment.id,
      attribution,
      updated.revisionId,
    );
    await touchAgentSessionAfterWrite(
      this.prisma,
      this.realtime,
      attribution.agentSessionId,
    );
    // TASK-166.9 + TASK-177.11: type changed to blocker/handoff on an
    // agent-authored comment. If the original comment already raised the flag,
    // the dedup store has it and nothing is re-sent; a previously quiet note
    // gets its first (and only) attention event.
    if (
      kindProvided &&
      (dto.kind === "blocker" || dto.kind === "handoff") &&
      dto.kind !== comment.kind &&
      comment.actorType === "agent" &&
      !(await this.attention.hasCommentAttention(comment.id))
    ) {
      await this.attention.notifyCommentAttention({
        boardId,
        cardId: comment.cardId,
        commentId: comment.id,
        kind: dto.kind,
        agentName: comment.agentName,
      });
    }
    // TASK-177.12: only newly added mentions raise a row; unchanged mentions
    // are already in the store, and removed ones were withdrawn in the same
    // transaction as the edit.
    if (textProvided && addedMentionIds.length > 0) {
      await this.attention.notifyCommentMention({
        boardId,
        cardId: comment.cardId,
        commentId: comment.id,
        authorId: userId,
        actorName: commentActorName(updated.comment, comment.agentName),
        mentionedUserIds: addedMentionIds,
        excerpt: commentPlainExcerpt(updated.comment.text),
      });
    }
    return toCommentDto(updated.comment);
  }

  /** Newest-first page with an opaque `at:id` cursor. */
  async list(
    cardId: string,
    cursorRaw?: string,
    limitRaw?: string,
    kindRaw?: string,
    createdBefore?: Date,
  ): Promise<CommentPage> {
    const { cursor, limit } = parseCommentPage(cursorRaw, limitRaw);
    const kind = parseKind(kindRaw);
    const rows = await this.prisma.comment.findMany({
      where: {
        cardId,
        deletedAt: null,
        ...(createdBefore ? { createdAt: { lte: createdBefore } } : {}),
        ...(kind ? { kind } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.at) } },
                { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: AUTHOR_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(toCommentDto),
      nextCursor:
        hasMore && last ? `${last.createdAt.getTime()}:${last.id}` : null,
    };
  }

  /** Soft-delete the caller's own comment (ADMIN/MEMBER enforced by guard). */
  async remove(
    commentId: string,
    userId: string,
    attribution: RequestAttribution = HUMAN_ATTRIBUTION,
    principal?: AuthPrincipal,
  ): Promise<void> {
    const preRead = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null },
      select: {
        id: true,
        cardId: true,
        card: { select: { column: { select: { boardId: true } } } },
      },
    });
    if (!preRead) {
      throw new NotFoundException("Comment not found");
    }
    const removed = await this.boardWrite.run(
      preRead.card.column.boardId,
      async (tx) => {
        await assertBoardAcceptsWrites(tx, preRead.card.column.boardId);
        // TASK-185.1: re-read under the board lock. A concurrent edit may have
        // moved the text; the tombstone snapshot and media reconcile must use
        // the committed body, never the pre-lock copy.
        const comment = await tx.comment.findFirst({
          where: {
            id: commentId,
            deletedAt: null,
            card: {
              deletedAt: null,
              column: {
                boardId: preRead.card.column.boardId,
                deletedAt: null,
              },
            },
          },
          select: {
            id: true,
            authorId: true,
            cardId: true,
            apiTokenId: true,
            text: true,
            card: { select: { column: { select: { boardId: true } } } },
          },
        });
        if (!comment) {
          throw new NotFoundException("Comment not found");
        }
        if (comment.authorId !== userId) {
          throw new ForbiddenException({
            message: "Only the author can delete a comment",
            code: "scope_denied",
            requiredScope: "worker",
            action: "comment.delete",
          });
        }
        if (
          attribution.actorType === "agent" &&
          comment.apiTokenId !== null &&
          comment.apiTokenId !== attribution.apiTokenId
        ) {
          throw new ForbiddenException({
            message: "Only the author token can delete a comment",
            code: "scope_denied",
            requiredScope: "worker",
            action: "comment.delete",
          });
        }
        await tx.comment.update({
          where: { id: comment.id },
          data: { deletedAt: new Date() },
        });
        await reconcileDescriptionAttachments(
          tx,
          preRead.card.column.boardId,
          comment.text,
          undefined,
        );
        await this.unlinkInlineAttachments(
          tx,
          preRead.card.column.boardId,
          comment.text,
          userId,
          attribution,
        );
        const activity = await tx.activity.create({
          data: {
            boardId: preRead.card.column.boardId,
            cardId: comment.cardId,
            type: "comment_deleted",
            commentId: comment.id,
            actorId: userId,
            actorType: attribution.actorType,
            apiTokenId: attribution.apiTokenId,
            agentSessionId: attribution.agentSessionId,
            agentName: attribution.agentName,
            // TASK-185.2: deletion is a tombstone — no text snapshot.
            details: { commentId: comment.id },
          },
        });
        // TASK-177.12: mention rows and their queued letters go with the
        // tombstone in the same transaction.
        await deleteCommentMentionAttention(tx, comment.id);
        return {
          activityId: activity.id,
          boardId: preRead.card.column.boardId,
          cardId: comment.cardId,
          at: activity.createdAt.getTime(),
        };
      },
      pauseGateFor(principal, attribution.agentSessionId),
    );
    this.publishActivity(
      removed.boardId,
      removed.cardId,
      removed.activityId,
      userId,
      removed.at,
      "comment_deleted",
      commentId,
      attribution,
    );
    await touchAgentSessionAfterWrite(
      this.prisma,
      this.realtime,
      attribution.agentSessionId,
    );
  }

  /**
   * TASK-177.12 — every mentioned id must be an accepted, unexpired member
   * of this board. The answer keeps first-mention order and uniqueness; an
   * unknown or foreign id is a 400 with the offending ids (never a silent
   * drop, which would lose the author's intent).
   */
  private async assertMentionMembers(
    boardId: string,
    text: string,
  ): Promise<string[]> {
    const ids = extractMentionUserIds(text);
    if (ids.length === 0) return [];
    const rows = await this.prisma.boardMember.findMany({
      where: {
        boardId,
        userId: { in: ids },
        ...activeMembershipWhere(),
      },
      select: { userId: true },
    });
    const allowed = new Set(rows.map((row) => row.userId));
    const rejected = ids.filter((id) => !allowed.has(id));
    if (rejected.length > 0) {
      throw beforeWrite(
        new BadRequestException({
          message: "Mentioned users must be active board members",
          code: "mention_not_member",
          field: "text",
          userIds: rejected,
        }),
      );
    }
    return ids;
  }

  /** Delete only the author's inline files that no remaining content uses. */
  private async unlinkInlineAttachments(
    tx: Prisma.TransactionClient,
    boardId: string,
    text: string,
    userId: string,
    attribution: RequestAttribution,
  ): Promise<void> {
    await this.unlinkInlineAttachmentIds(
      tx,
      boardId,
      [...inlineAttachmentIds(text)],
      userId,
      attribution,
    );
  }

  /** Soft-delete the given inline blobs, board- and uploader-scoped (TASK-81). */
  private async unlinkInlineAttachmentIds(
    tx: Prisma.TransactionClient,
    boardId: string,
    ids: readonly string[],
    userId: string,
    attribution: RequestAttribution,
  ): Promise<void> {
    if (ids.length === 0) return;
    const candidates = await tx.attachment.findMany({
      where: {
        id: { in: [...ids] },
        boardId,
        isInline: true,
        deletedAt: null,
        uploadedById: userId,
        ...(attribution.actorType === "agent"
          ? {
              OR: [
                { uploadedByTokenId: attribution.apiTokenId },
                { uploadedByTokenId: null },
              ],
            }
          : {}),
      },
      select: { id: true },
    });
    if (candidates.length === 0) return;
    const urls = candidates.map(({ id }) => `/attachments/${id}/content`);
    const [cards, comments] = await Promise.all([
      tx.card.findMany({
        where: {
          column: { boardId },
          deletedAt: null,
          OR: urls.map((url) => ({ description: { contains: url } })),
        },
        select: { description: true },
      }),
      tx.comment.findMany({
        where: {
          card: { column: { boardId }, deletedAt: null },
          deletedAt: null,
          OR: urls.map((url) => ({ text: { contains: url } })),
        },
        select: { text: true },
      }),
    ]);
    const used = new Set<string>();
    for (const body of [
      ...cards.map((card) => card.description ?? ""),
      ...comments.map((comment) => comment.text),
    ]) {
      for (const match of body.matchAll(INLINE_ATTACHMENT_URL))
        used.add(match[1]);
    }
    const unused = candidates.map(({ id }) => id).filter((id) => !used.has(id));
    if (unused.length === 0) return;
    await tx.attachment.updateMany({
      where: { id: { in: unused }, boardId, isInline: true, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /** Fan a comment write out to every open stream of the board (TASK-37). */
  private publishActivity(
    boardId: string,
    cardId: string,
    activityId: string,
    actorId: string,
    at: number,
    kind: "comment_added" | "comment_deleted" | "comment_updated",
    commentId: string,
    attribution: RequestAttribution,
    revisionId?: string | null,
  ): void {
    // TASK-185.2: the frame is a refetch signal, never a body. The typed
    // `commentId` is the new contract; `detail = commentId` stays for open
    // tabs that only read the transitional field.
    this.realtime.publish(boardId, {
      type: "activity",
      id: activityId,
      boardId,
      cardId,
      actorId,
      actorType: attribution.actorType,
      at,
      kind,
      commentId,
      detail: commentId,
      ...(revisionId ? { revisionId } : {}),
      ...(attribution.apiTokenId ? { apiTokenId: attribution.apiTokenId } : {}),
      ...(attribution.agentSessionId
        ? { agentSessionId: attribution.agentSessionId }
        : {}),
      ...(attribution.agentName ? { agentName: attribution.agentName } : {}),
    });
  }
}

export function toCommentDto(comment: CommentWithAuthor): CommentDto {
  return {
    id: comment.id,
    cardId: comment.cardId,
    authorId: comment.authorId,
    authorName: comment.author?.displayName ?? null,
    authorEmail: comment.author?.email ?? null,
    text: comment.text,
    kind: comment.kind as CommentKind,
    actorType: comment.actorType === "agent" ? "agent" : "human",
    apiTokenId: comment.apiTokenId,
    agentSessionId: comment.agentSessionId,
    agentName: comment.agentName,
    mentionedUserIds: extractMentionUserIds(comment.text),
    createdAt: comment.createdAt.getTime(),
    ...(comment.editedAt ? { editedAt: comment.editedAt.getTime() } : {}),
  };
}

/** Human-readable actor for a mention letter (agent label when attributed). */
function commentActorName(
  comment: CommentWithAuthor,
  agentName: string | null,
): string | null {
  return (
    agentName ?? comment.author?.displayName ?? comment.author?.email ?? null
  );
}

/** Attachment ids embedded as `…/attachments/<id>/content` in free text. */
function inlineAttachmentIds(text: string): Set<string> {
  return new Set([...text.matchAll(INLINE_ATTACHMENT_URL)].map((m) => m[1]));
}

interface CommentCursor {
  at: number;
  id: string;
}

export function parseCommentPage(cursorRaw?: string, limitRaw?: string) {
  return {
    limit: parseLimit(limitRaw),
    cursor: cursorRaw ? parseCursor(cursorRaw) : null,
  };
}

function parseCursor(raw: string): CommentCursor {
  const match = /^(\d+):(.+)$/.exec(raw);
  if (!match) {
    throw new BadRequestException("cursor is malformed");
  }
  const at = Number(match[1]);
  if (!Number.isSafeInteger(at) || at < 0 || at > 8.64e15) {
    throw new BadRequestException("cursor is malformed");
  }
  return { at, id: match[2] };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(`limit must be an integer 1…${MAX_LIMIT}`);
  }
  return limit;
}

/** Validate the `?kind=` filter; an unknown kind is a 400, not a silent no-op. */
function parseKind(raw: string | undefined): CommentKind | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!(COMMENT_KINDS as readonly string[]).includes(raw)) {
    throw new BadRequestException(
      `kind must be one of: ${COMMENT_KINDS.join(", ")}`,
    );
  }
  return raw as CommentKind;
}
