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
  type CommentDto,
  type CommentKind,
  type CommentPage,
} from "@janosik/shared";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BoardWriteService } from "@/common/board-write.service";
import {
  type RequestAttribution,
  HUMAN_ATTRIBUTION,
} from "@/auth/request-attribution";
import { pauseGateFor } from "@/auth/agent-pause";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { touchAgentSessionAfterWrite } from "@/agent-sessions/agent-session-context";
import { RealtimeService } from "@/realtime/realtime.service";
import type { CreateCommentDto } from "./dto/create-comment.dto";
import { reconcileDescriptionAttachments } from "@/commands/command-writers";

/** Default page size of `GET /cards/:id/comments` (`?limit=`). */
const DEFAULT_LIMIT = 50;
/** Upper bound for `?limit=`. */
const MAX_LIMIT = 100;

/** Body-embedded attachment references (`…/attachments/<id>/content`). */
const INLINE_ATTACHMENT_URL =
  /\/api\/v1\/attachments\/([A-Za-z0-9-]+)\/content/g;

/**
 * Card comments (§7.4, TASK-28) — plain text, ordinary REST.
 *
 * Comments are not reducer actions, so each write also records an
 * `Activity` row (`comment_added` / `comment_deleted`) that the activity
 * feeds pick up. Deletion is soft (a purge job reclaims rows later) and
 * only the author may delete their own comment.
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
      throw new BadRequestException({
        message: "text must not be blank",
        field: "text",
      });
    }
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, deletedAt: null },
      select: { column: { select: { boardId: true } } },
    });
    if (!card) {
      throw new NotFoundException("Card not found");
    }
    const boardId = card.column.boardId;

    // Idempotency (TASK-99): the client key doubles as the comment id, so a
    // retried POST finds the first row instead of appending a duplicate.
    const id = dto.commandId;
    if (id !== undefined) {
      const existing = await this.prisma.comment.findUnique({ where: { id } });
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
          throw new ConflictException({
            message: "commandId already used",
            code: "idempotency_conflict",
            key: id,
            field: "commandId",
          });
        }
        return toCommentDto(existing);
      }
    }

    let created: { comment: Comment; activityId: string; boardId: string };
    try {
      created = await this.boardWrite.run(
        boardId,
        async (tx) => {
          const comment = await tx.comment.create({
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
    await touchAgentSessionAfterWrite(this.prisma, attribution.agentSessionId);
    return toCommentDto(created.comment);
  }

  /** Newest-first page with an opaque `at:id` cursor. */
  async list(
    cardId: string,
    cursorRaw?: string,
    limitRaw?: string,
    kindRaw?: string,
    createdUpTo?: Date,
  ): Promise<CommentPage> {
    const limit = parseLimit(limitRaw);
    const cursor = cursorRaw ? parseCursor(cursorRaw) : null;
    const kind = parseKind(kindRaw);
    const rows = await this.prisma.comment.findMany({
      where: {
        cardId,
        deletedAt: null,
        ...(kind ? { kind } : {}),
        // Snapshot shares freeze the conversation at capture time too.
        ...(createdUpTo ? { createdAt: { lte: createdUpTo } } : {}),
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
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null },
      select: {
        id: true,
        authorId: true,
        cardId: true,
        apiTokenId: true,
        // The text rides into the Activity snapshot, so the history feed
        // can render the deletion as a `text → null` diff (TASK-37).
        text: true,
        card: { select: { column: { select: { boardId: true } } } },
      },
    });
    if (!comment) {
      throw new NotFoundException("Comment not found");
    }
    // TASK-166 own-rule: for a PAT the row is owned by the same apiTokenId;
    // a legacy row without one falls back to the author. A browser session
    // keeps the historical author-only rule.
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
    const removed = await this.boardWrite.run(
      comment.card.column.boardId,
      async (tx) => {
        await tx.comment.update({
          where: { id: comment.id },
          data: { deletedAt: new Date() },
        });
        await reconcileDescriptionAttachments(
          tx,
          comment.card.column.boardId,
          comment.text,
          undefined,
        );
        const activity = await tx.activity.create({
          data: {
            boardId: comment.card.column.boardId,
            cardId: comment.cardId,
            type: "comment_deleted",
            actorId: userId,
            actorType: attribution.actorType,
            apiTokenId: attribution.apiTokenId,
            agentSessionId: attribution.agentSessionId,
            agentName: attribution.agentName,
            details: { commentId: comment.id, text: comment.text },
          },
        });
        return {
          activityId: activity.id,
          boardId: comment.card.column.boardId,
          at: activity.createdAt.getTime(),
        };
      },
      pauseGateFor(principal, attribution.agentSessionId),
    );
    this.publishActivity(
      removed.boardId,
      comment.cardId,
      removed.activityId,
      userId,
      removed.at,
      "comment_deleted",
      comment.id,
      attribution,
    );
    // Inline media pasted into the comment die with it — soft-deleted like
    // every attachment (the physical blob stays, matching the soft-delete
    // restore story; the purge job reclaims rows later). Runs under the same
    // board lock so it never races a concurrent command.
    await this.boardWrite.run(comment.card.column.boardId, (tx) =>
      this.unlinkInlineAttachments(
        tx,
        comment.card.column.boardId,
        comment.text,
      ),
    );
    await touchAgentSessionAfterWrite(this.prisma, attribution.agentSessionId);
  }

  /**
   * Soft-delete the inline attachments embedded in a deleted comment. Scoped
   * to the comment's board (TASK-81): the ids are parsed out of free text, so
   * without `boardId` a member could paste another board's attachment id
   * (leaked through public shares) and delete that board's media by removing
   * their own comment.
   */
  private async unlinkInlineAttachments(
    tx: Prisma.TransactionClient,
    boardId: string,
    text: string,
  ): Promise<void> {
    const ids = [...text.matchAll(INLINE_ATTACHMENT_URL)].map((m) => m[1]);
    if (ids.length === 0) return;
    await tx.attachment.updateMany({
      where: { id: { in: ids }, boardId, isInline: true, deletedAt: null },
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
    kind: "comment_added" | "comment_deleted",
    commentId: string,
    attribution: RequestAttribution,
  ): void {
    this.realtime.publish(boardId, {
      type: "activity",
      id: activityId,
      boardId,
      cardId,
      actorId,
      actorType: attribution.actorType,
      at,
      kind,
      detail: commentId,
      ...(attribution.apiTokenId ? { apiTokenId: attribution.apiTokenId } : {}),
      ...(attribution.agentSessionId
        ? { agentSessionId: attribution.agentSessionId }
        : {}),
      ...(attribution.agentName ? { agentName: attribution.agentName } : {}),
    });
  }
}

function toCommentDto(comment: Comment): CommentDto {
  return {
    id: comment.id,
    cardId: comment.cardId,
    authorId: comment.authorId,
    text: comment.text,
    kind: comment.kind as CommentKind,
    actorType: comment.actorType === "agent" ? "agent" : "human",
    apiTokenId: comment.apiTokenId,
    agentSessionId: comment.agentSessionId,
    agentName: comment.agentName,
    createdAt: comment.createdAt.getTime(),
  };
}

interface CommentCursor {
  at: number;
  id: string;
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
