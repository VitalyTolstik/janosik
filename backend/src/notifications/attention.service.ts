import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { extractMentionUserIds } from "@janosik/shared";
import type {
  AttentionNotificationDto,
  AttentionNotificationListQuery,
  AttentionNotificationPage,
  AttentionNotificationType,
  NotificationSettingsDto,
  UpdateNotificationSettingsRequest,
} from "@janosik/shared";
import { activeMembershipWhere } from "@/common/membership";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  NotificationDeliveryService,
  notificationMailId,
} from "@/mailer/notification-delivery.service";
import type { MailLocale } from "@/mailer/mail.types";
import {
  attentionEmail,
  mentionInboxBody,
  type AttentionEmailVars,
} from "@/mailer/templates";
import { EmailTemplateService } from "@/ops/email-template.service";
import {
  deleteCommentMentionAttentionForUsers,
  escapeLikePrefix,
} from "./mention-attention";

/** Default/maximum page size of the in-app attention inbox. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** How many card titles an assignment body repeats before “and N more”. */
const ASSIGNMENT_TITLE_LIMIT = 3;
// Prisma transmits Date values as RFC 3339, whose year has four digits.
const MAX_CURSOR_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
/** How long a repeated quota warning stays deduplicated (one UTC day). */
const QUOTA_DEDUP_WINDOW_MS = 86_400_000;

const RECIPIENT_SELECT = {
  id: true,
  email: true,
  displayName: true,
  locale: true,
  notifyAttention: true,
  disabledAt: true,
} as const;

interface AttentionRecipient {
  id: string;
  email: string;
  displayName: string | null;
  locale: string | null;
  notifyAttention: boolean;
  disabledAt: Date | null;
}

/** One event fanned out to already-audited recipients. */
interface AttentionInput {
  type: AttentionNotificationType;
  boardId: string | null;
  /** Exact comment target for comment-scoped categories. */
  commentId?: string | null;
  /** Stable base key; the recipient id is appended by the service. */
  dedupKey: string;
  recipients: AttentionRecipient[];
  emailVars: (locale: MailLocale) => AttentionEmailVars;
  /** Localized in-app body when it must differ from the private e-mail body. */
  inboxBody?: (locale: MailLocale) => string;
  data?: Record<string, unknown>;
}

export interface CommentAttentionInput {
  boardId: string;
  cardId: string;
  commentId: string;
  kind: "blocker" | "handoff";
  agentName: string | null;
}

export interface CommentMentionInput {
  boardId: string;
  cardId: string;
  commentId: string;
  /** The comment author; never notified even when they mention themselves. */
  authorId: string;
  actorName: string | null;
  /** Already validated against the live roster by the comment service. */
  mentionedUserIds: string[];
  /** Short plain-text preview; safe as text, escaped by the mail layer. */
  excerpt: string;
}

export interface ClaimExpiredInput {
  boardId: string;
  cardId: string;
  cardTitle: string;
  claimedBy: string | null;
  agentName: string | null;
  leaseUntil: Date;
}

/** One committed assignment change; `assigneeId: null` is an unassign. */
export interface CardAssignmentChange {
  cardId: string;
  assigneeId: string | null;
  seq: number;
}

export interface CardsAssignedInput {
  boardId: string;
  actorId: string;
  /** Applied events in command order; the last change per card wins. */
  assignments: CardAssignmentChange[];
}

/**
 * TASK-166.9 — the attention inbox and its immediate e-mail fan-out.
 *
 * Every producer calls one of the `notify*` methods **after** its own write
 * has committed. A notification is best-effort: a failure is logged and never
 * turns a successful approval/decision/comment into a 5xx. The unique
 * `dedupKey` (type + object id + recipient) is the contract that makes retries,
 * concurrent tabs and repeated maintenance sweeps send exactly one row and one
 * letter. E-mail is fire-and-forget through the existing mail queue, so the
 * request path pays for the in-app insert only.
 *
 * Audiences are resolved here, not by callers: board ADMINs for approval and
 * blocker events, the requester/decision actor for a decision, cancellation
 * or consumption, the claimant plus ADMINs for an expired claim, the account
 * itself for a quota warning, and the owner alone for a revoked API token.
 * Disabled accounts and expired memberships are dropped. A PAT is never a
 * recipient — the query always reads `User.email`, never a token.
 */
@Injectable()
export class AttentionService {
  private readonly logger = new Logger(AttentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: NotificationDeliveryService,
    private readonly templates: EmailTemplateService,
  ) {}

  /** `approval_requested` → every active board ADMIN (ADR §10.5). */
  async notifyApprovalRequested(row: {
    id: string;
    boardId: string;
    actionType: string;
    summary: string;
    risk: string;
    expiresAt: Date;
  }): Promise<void> {
    try {
      const board = await this.boardTitle(row.boardId);
      if (board === null) return;
      const recipients = await this.boardAdmins(row.boardId);
      await this.notify({
        type: "approval.requested",
        boardId: row.boardId,
        dedupKey: `approval.requested:${row.id}`,
        recipients,
        emailVars: () => ({
          board,
          summary: row.summary,
          risk: row.risk,
          action: row.actionType,
          expiresAt: row.expiresAt.toISOString(),
        }),
        data: {
          approvalId: row.id,
          action: row.actionType,
          risk: row.risk,
          expiresAt: row.expiresAt.getTime(),
        },
      });
    } catch (error) {
      this.warn("approval requested", error);
    }
  }

  /** `approval_approved`/`rejected` → requester + decision actor. */
  async notifyApprovalDecided(
    row: {
      id: string;
      boardId: string;
      actionType: string;
      summary: string;
      requestedBy: string;
      decidedBy: string | null;
    },
    decision: "approve" | "reject",
    comment: string | null,
  ): Promise<void> {
    try {
      const board = await this.boardTitle(row.boardId);
      if (board === null) return;
      const recipients = await this.members(row.boardId, [
        row.requestedBy,
        ...(row.decidedBy === null ? [] : [row.decidedBy]),
      ]);
      await this.notify({
        type: "approval.decided",
        boardId: row.boardId,
        dedupKey: `approval.decided:${row.id}:${decision}`,
        recipients,
        emailVars: () => ({
          board,
          summary: row.summary,
          action: row.actionType,
          status: decision === "approve" ? "approved" : "rejected",
          ...(comment !== null ? { comment } : {}),
        }),
        data: {
          approvalId: row.id,
          decision: decision === "approve" ? "approved" : "rejected",
          action: row.actionType,
        },
      });
    } catch (error) {
      this.warn("approval decided", error);
    }
  }

  /** `approval_cancelled` → requester + the cancelling user. */
  async notifyApprovalCancelled(
    row: {
      id: string;
      boardId: string;
      actionType: string;
      summary: string;
      requestedBy: string;
    },
    actorId: string,
  ): Promise<void> {
    try {
      const board = await this.boardTitle(row.boardId);
      if (board === null) return;
      const recipients = await this.members(row.boardId, [
        row.requestedBy,
        actorId,
      ]);
      await this.notify({
        type: "approval.cancelled",
        boardId: row.boardId,
        dedupKey: `approval.cancelled:${row.id}`,
        recipients,
        emailVars: () => ({
          board,
          summary: row.summary,
          action: row.actionType,
        }),
        data: {
          approvalId: row.id,
          action: row.actionType,
        },
      });
    } catch (error) {
      this.warn("approval cancelled", error);
    }
  }

  /** `approval_consumed` → requester + decision actor, post-commit only. */
  async notifyApprovalConsumed(row: {
    id: string;
    boardId: string;
    actionType: string;
    summary: string;
    requestedBy: string;
    decidedBy: string | null;
    runId: string | null;
  }): Promise<void> {
    try {
      const board = await this.boardTitle(row.boardId);
      if (board === null) return;
      const recipients = await this.members(row.boardId, [
        row.requestedBy,
        ...(row.decidedBy === null ? [] : [row.decidedBy]),
      ]);
      await this.notify({
        type: "approval.consumed",
        boardId: row.boardId,
        dedupKey: `approval.consumed:${row.id}`,
        recipients,
        emailVars: () => ({
          board,
          summary: row.summary,
          action: row.actionType,
          ...(row.runId !== null ? { runId: row.runId } : {}),
        }),
        data: {
          approvalId: row.id,
          action: row.actionType,
          ...(row.runId !== null ? { runId: row.runId } : {}),
        },
      });
    } catch (error) {
      this.warn("approval consumed", error);
    }
  }

  /** `approval_expired` → requester and, when known, the decision actor. */
  async notifyApprovalExpired(row: {
    id: string;
    boardId: string;
    actionType: string;
    summary: string;
    requestedBy: string;
    decidedBy: string | null;
  }): Promise<void> {
    try {
      const board = await this.boardTitle(row.boardId);
      if (board === null) return;
      const recipients = await this.members(row.boardId, [
        row.requestedBy,
        ...(row.decidedBy === null ? [] : [row.decidedBy]),
      ]);
      await this.notify({
        type: "approval.expired",
        boardId: row.boardId,
        dedupKey: `approval.expired:${row.id}`,
        recipients,
        emailVars: () => ({
          board,
          summary: row.summary,
          action: row.actionType,
        }),
        data: {
          approvalId: row.id,
          action: row.actionType,
        },
      });
    } catch (error) {
      this.warn("approval expired", error);
    }
  }

  /**
   * A typed `blocker`/`handoff` comment from an agent → board ADMINs. A human
   * comment never triggers this path, so ordinary conversation stays quiet.
   */
  async notifyCommentAttention(input: CommentAttentionInput): Promise<void> {
    try {
      const [board, card] = await Promise.all([
        this.boardTitle(input.boardId),
        this.prisma.card.findFirst({
          where: {
            id: input.cardId,
            deletedAt: null,
            column: { boardId: input.boardId },
          },
          select: { title: true },
        }),
      ]);
      if (board === null || card === null) return;
      const type =
        input.kind === "blocker" ? "agent.blocked" : "agent.needs_human";
      const recipients = await this.boardAdmins(input.boardId);
      await this.notify({
        type,
        boardId: input.boardId,
        commentId: input.commentId,
        dedupKey: `${type}:${input.commentId}`,
        recipients,
        emailVars: () => ({
          board,
          card: card.title,
          agent: input.agentName ?? "agent",
        }),
        data: {
          cardId: input.cardId,
          commentId: input.commentId,
          kind: input.kind,
          agentName: input.agentName,
        },
      });
    } catch (error) {
      this.warn("agent blocker", error);
    }
  }

  /**
   * TASK-177.12 — one mention row per mentioned member, never the author.
   *
   * The comment id is the dedup base, so the same person mentioned twice in
   * one comment (or a later edit that keeps the token) gets exactly one row.
   * The live comment is re-checked here: a delete that raced the fan-out must
   * not create a row the service would then have to hide.
   */
  async notifyCommentMention(input: CommentMentionInput): Promise<void> {
    try {
      const [board, card, comment] = await Promise.all([
        this.boardTitle(input.boardId),
        this.prisma.card.findFirst({
          where: {
            id: input.cardId,
            deletedAt: null,
            column: { boardId: input.boardId, deletedAt: null },
          },
          select: { title: true },
        }),
        this.prisma.comment.findFirst({
          where: {
            id: input.commentId,
            deletedAt: null,
            cardId: input.cardId,
            card: {
              deletedAt: null,
              column: { boardId: input.boardId, deletedAt: null },
            },
          },
          select: { id: true },
        }),
      ]);
      if (board === null || card === null || comment === null) return;
      const recipients = (
        await this.members(input.boardId, input.mentionedUserIds)
      ).filter((recipient) => recipient.id !== input.authorId);
      if (recipients.length === 0) return;
      await this.notify({
        type: "comment.mention",
        boardId: input.boardId,
        commentId: input.commentId,
        dedupKey: `comment.mention:${input.commentId}`,
        recipients,
        emailVars: () => ({
          board,
          card: card.title,
          actor: input.actorName ?? "",
        }),
        inboxBody: (locale) =>
          mentionInboxBody(
            {
              board,
              card: card.title,
              actor: input.actorName,
              excerpt: input.excerpt,
            },
            locale,
          ),
        data: {
          cardId: input.cardId,
          commentId: input.commentId,
          authorId: input.authorId,
          ...(input.actorName !== null ? { authorName: input.actorName } : {}),
        },
      });
      // The fan-out is post-commit. A concurrent edit may have replaced the
      // text after our under-lock diff: re-read once and withdraw any row for
      // an id the committed text no longer carries.
      const live = await this.prisma.comment.findFirst({
        where: {
          id: input.commentId,
          deletedAt: null,
          cardId: input.cardId,
          card: {
            deletedAt: null,
            column: { boardId: input.boardId, deletedAt: null },
          },
        },
        select: { text: true },
      });
      const liveIds = new Set(extractMentionUserIds(live?.text ?? ""));
      const staleIds = input.mentionedUserIds.filter((id) => !liveIds.has(id));
      if (staleIds.length > 0) {
        await deleteCommentMentionAttentionForUsers(
          this.prisma,
          input.commentId,
          staleIds,
        );
      }
    } catch (error) {
      this.warn("comment mention", error);
    }
  }

  /**
   * TASK-177.11: has this comment already raised blocker/handoff attention?
   * The create path keys rows on `agent.blocked:<commentId>` or
   * `agent.needs_human:<commentId>` plus the recipient, so either prefix means
   * the event was delivered (or deliberately swallowed) before. A kind edit
   * uses this to avoid sending a second letter for the same comment.
   */
  async hasCommentAttention(commentId: string): Promise<boolean> {
    try {
      const escaped = escapeLikePrefix(commentId);
      const count = await this.prisma.attentionNotification.count({
        where: {
          OR: [
            {
              commentId,
              type: { in: ["agent.blocked", "agent.needs_human"] },
            },
            // Legacy rows written before the exact column existed.
            { dedupKey: { startsWith: `agent.blocked:${escaped}:` } },
            { dedupKey: { startsWith: `agent.needs_human:${escaped}:` } },
          ],
        },
      });
      return count > 0;
    } catch (error) {
      // Fail closed: an unreadable dedup store must not become a duplicate
      // letter. The write already committed, so this only skips the fan-out.
      this.warn("comment attention lookup", error);
      return true;
    }
  }

  /**
   * TASK-177.20 — the new assignee of one or more cards in a committed batch.
   *
   * The caller passes every applied `SET_CARD_ASSIGN` in command order. The
   * last change per card wins here too (A→B notifies only B; a trailing
   * unassign notifies nobody), then one coalesced row is written per assignee
   * for the whole batch. The board, cards and recipient are re-read live, so a
   * board/card deleted or archived between commit and fan-out, a removed member
   * or a disabled account produces nothing. Assigning a card to yourself is
   * skipped. The dedupe base is the batch's seq range, which is stable for a
   * retry and distinct for the next batch.
   */
  async notifyCardsAssigned(input: CardsAssignedInput): Promise<void> {
    try {
      const latest = new Map<string, CardAssignmentChange>();
      for (const change of input.assignments) {
        if (change.cardId === "") continue;
        if (!Number.isSafeInteger(change.seq) || change.seq < 0) continue;
        const assigneeId =
          change.assigneeId === null ? "" : change.assigneeId.trim();
        latest.set(change.cardId, {
          cardId: change.cardId,
          assigneeId: assigneeId === "" ? null : assigneeId,
          seq: change.seq,
        });
      }
      const byAssignee = new Map<string, CardAssignmentChange[]>();
      for (const change of latest.values()) {
        if (change.assigneeId === null) continue;
        if (change.assigneeId === input.actorId) continue;
        const list = byAssignee.get(change.assigneeId) ?? [];
        list.push(change);
        byAssignee.set(change.assigneeId, list);
      }
      if (byAssignee.size === 0) return;

      const [board, cards, actor] = await Promise.all([
        this.prisma.board.findFirst({
          where: {
            id: input.boardId,
            deletedAt: null,
            archivedAt: null,
          },
          select: { title: true },
        }),
        this.prisma.card.findMany({
          where: {
            id: { in: [...latest.keys()] },
            deletedAt: null,
            archivedAt: null,
            column: { boardId: input.boardId, deletedAt: null },
          },
          select: { id: true, title: true, assigneeId: true },
        }),
        this.prisma.user.findUnique({
          where: { id: input.actorId },
          select: { displayName: true },
        }),
      ]);
      if (board === null || cards.length === 0) return;
      const cardById = new Map(cards.map((card) => [card.id, card]));
      const actorName = actor?.displayName?.trim() || null;
      const recipients = await this.members(input.boardId, [
        ...byAssignee.keys(),
      ]);
      const recipientById = new Map(
        recipients.map((recipient) => [recipient.id, recipient]),
      );

      for (const [assigneeId, changes] of byAssignee) {
        const recipient = recipientById.get(assigneeId);
        if (recipient === undefined) continue;
        const live = changes
          .filter((change) => {
            const card = cardById.get(change.cardId);
            // A concurrent batch may have reassigned the card between our
            // commit and this read. Only the current assignee is notified.
            return card !== undefined && card.assigneeId === change.assigneeId;
          })
          .sort((left, right) => left.seq - right.seq);
        if (live.length === 0) continue;
        const titles = live.map((change) => cardById.get(change.cardId)!.title);
        const cardIds = live.map((change) => change.cardId);
        const minSeq = live[0]!.seq;
        const maxSeq = live[live.length - 1]!.seq;
        await this.notify({
          type: "card.assigned",
          boardId: input.boardId,
          dedupKey: `card.assigned:${minSeq}-${maxSeq}`,
          recipients: [recipient],
          emailVars: (locale) => ({
            board: board.title,
            cards: assignmentCardList(titles, locale),
            count: live.length,
            actor: actorName ?? "",
          }),
          inboxBody: (locale) =>
            assignmentInboxBody(
              {
                board: board.title,
                titles,
                count: live.length,
                actorName,
              },
              locale,
            ),
          data: {
            assigneeId,
            cardIds,
            ...(cardIds.length === 1 ? { cardId: cardIds[0] } : {}),
            ...(actorName !== null ? { actorName } : {}),
          },
        });
      }
    } catch (error) {
      this.warn("card assigned", error);
    }
  }

  /** A lapsed lease → board ADMINs plus the claimant when still a member. */
  async notifyClaimExpired(input: ClaimExpiredInput): Promise<void> {
    try {
      const board = await this.boardTitle(input.boardId);
      if (board === null) return;
      const admins = await this.boardAdmins(input.boardId);
      const claimant =
        input.claimedBy === null
          ? null
          : await this.activeMember(input.boardId, input.claimedBy);
      await this.notify({
        type: "claim.expired",
        boardId: input.boardId,
        dedupKey: `claim.expired:${input.cardId}:${input.leaseUntil.getTime()}`,
        recipients: [...admins, ...(claimant === null ? [] : [claimant])],
        emailVars: () => ({
          board,
          card: input.cardTitle,
          agent: input.agentName ?? "agent",
        }),
        data: {
          cardId: input.cardId,
          claimedBy: input.claimedBy,
          agentName: input.agentName,
          leaseUntil: input.leaseUntil.getTime(),
        },
      });
    } catch (error) {
      this.warn("claim expired", error);
    }
  }

  /**
   * A board/plan limit was refused. Account-level (no board) and board-scoped
   * plan limits share one event; the UTC-day bucket keeps a retry loop from
   * turning one operator cap into a mailbox full of letters.
   */
  async notifyQuotaExceeded(input: {
    userId: string;
    limit: number;
    current: number;
    resource: "board" | "plan";
    boardId?: string | null;
  }): Promise<void> {
    try {
      const recipient = await this.prisma.user.findFirst({
        where: { id: input.userId, disabledAt: null },
        select: RECIPIENT_SELECT,
      });
      if (recipient === null) return;
      const bucket = Math.floor(Date.now() / QUOTA_DEDUP_WINDOW_MS);
      await this.notify({
        type: "quota.exceeded",
        boardId: input.boardId ?? null,
        dedupKey: `quota.exceeded:${input.userId}:${input.resource}:${input.limit}:${bucket}`,
        recipients: [recipient],
        emailVars: () => ({
          limit: input.limit,
          current: input.current,
          resource: input.resource,
        }),
        data: {
          resource: input.resource,
          limit: input.limit,
          current: input.current,
          ...(input.boardId ? { boardId: input.boardId } : {}),
        },
      });
    } catch (error) {
      this.warn("quota exceeded", error);
    }
  }

  /**
   * `token.revoked` — the owner is the only recipient. The revoked key's
   * agent sessions are already cancelled by `revokeApiTokens`; a PAT can never
   * read this inbox or receive this letter. The dedup key is the token id, so
   * a repeated DELETE or a retry does not produce a second letter.
   */
  async notifyTokenRevoked(input: {
    userId: string;
    tokenId: string;
    tokenName: string;
    reason?: string;
  }): Promise<void> {
    try {
      const recipient = await this.prisma.user.findFirst({
        where: { id: input.userId, disabledAt: null },
        select: RECIPIENT_SELECT,
      });
      if (recipient === null) return;
      await this.notify({
        type: "token.revoked",
        boardId: null,
        dedupKey: `token.revoked:${input.tokenId}`,
        recipients: [recipient],
        emailVars: () => ({ token: input.tokenName }),
        data: {
          tokenId: input.tokenId,
          tokenName: input.tokenName,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
      });
    } catch (error) {
      this.warn("token revoked", error);
    }
  }

  /**
   * Parse `409 limit_exceeded` from the shared error envelope and record the
   * attention event without changing the original error the caller throws.
   */
  async notifyLimitExceeded(
    userId: string,
    error: unknown,
    options: { boardId?: string | null; resource?: "board" | "plan" } = {},
  ): Promise<void> {
    const response =
      typeof error === "object" && error !== null
        ? (error as { getResponse?: () => unknown }).getResponse?.()
        : undefined;
    if (
      typeof response !== "object" ||
      response === null ||
      (response as { code?: unknown }).code !== "limit_exceeded"
    ) {
      return;
    }
    const limit = Number((response as { limit?: unknown }).limit);
    const current = Number((response as { current?: unknown }).current);
    if (!Number.isFinite(limit) || !Number.isFinite(current)) return;
    await this.notifyQuotaExceeded({
      userId,
      limit,
      current,
      resource: options.resource ?? "board",
      boardId: options.boardId ?? null,
    });
  }

  /* ------------------------------------------------------------------ *
   * In-app surface (session-only; mounted under /users/me)
   * ------------------------------------------------------------------ */

  async list(
    userId: string,
    query: AttentionNotificationListQuery,
  ): Promise<AttentionNotificationPage> {
    const limit = parseLimit(query.limit);
    const cursor =
      query.cursor === undefined ? null : parseCursor(query.cursor);
    const boardIds = await this.accessibleBoardIds(userId);
    if (
      query.boardId !== undefined &&
      query.boardId !== "" &&
      !boardIds.has(query.boardId)
    ) {
      throw new ForbiddenException({
        message: "You are not a member of this board",
        code: "scope_denied",
        requiredRoles: ["ADMIN", "MEMBER", "VIEWER"],
        retryable: false,
      });
    }
    const boardFilter =
      query.boardId !== undefined && query.boardId !== ""
        ? { boardId: query.boardId }
        : { OR: [{ boardId: null }, { boardId: { in: [...boardIds] } }] };
    const filters: Prisma.AttentionNotificationWhereInput[] = [boardFilter];
    if (cursor !== null) {
      filters.push({
        OR: [
          { createdAt: { lt: cursor.at } },
          { createdAt: cursor.at, id: { lt: cursor.id } },
        ],
      });
    }
    const where: Prisma.AttentionNotificationWhereInput = {
      userId,
      AND: filters,
      ...(query.unreadOnly === true ? { readAt: null } : {}),
    };
    const [rows, unreadCount] = await Promise.all([
      this.prisma.attentionNotification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
      this.prisma.attentionNotification.count({
        where: {
          userId,
          ...boardFilter,
          readAt: null,
        },
      }),
    ]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(toAttentionDto),
      nextCursor:
        hasMore && last !== undefined
          ? `${last.createdAt.getTime()}:${last.id}`
          : null,
      unreadCount,
    };
  }

  async markRead(
    userId: string,
    id: string,
  ): Promise<AttentionNotificationDto> {
    const existing = await this.prisma.attentionNotification.findFirst({
      where: { id, userId },
    });
    if (existing === null) throw this.notFound(id);
    if (
      existing.boardId !== null &&
      !(await this.accessibleBoardIds(userId)).has(existing.boardId)
    ) {
      // A board the user left must not resurface through a read-by-id call.
      throw this.notFound(id);
    }
    if (existing.readAt === null) {
      await this.prisma.attentionNotification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return toAttentionDto(
      existing.readAt === null ? { ...existing, readAt: new Date() } : existing,
    );
  }

  async markAllRead(
    userId: string,
    boardId?: string,
  ): Promise<{ updated: number }> {
    const explicit = boardId !== undefined && boardId !== "";
    const accessible = await this.accessibleBoardIds(userId);
    if (explicit && !accessible.has(boardId)) {
      throw new ForbiddenException({
        message: "You are not a member of this board",
        code: "scope_denied",
        requiredRoles: ["ADMIN", "MEMBER", "VIEWER"],
        retryable: false,
      });
    }
    const result = await this.prisma.attentionNotification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(explicit
          ? { boardId }
          : {
              OR: [{ boardId: null }, { boardId: { in: [...accessible] } }],
            }),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async settings(userId: string): Promise<NotificationSettingsDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notifyDigest: true, notifyAttention: true },
    });
    if (user === null) throw new NotFoundException("User not found");
    return user;
  }

  async updateSettings(
    userId: string,
    dto: UpdateNotificationSettingsRequest,
  ): Promise<NotificationSettingsDto> {
    const data: Prisma.UserUpdateInput = {};
    if (typeof dto.notifyDigest === "boolean") {
      data.notifyDigest = dto.notifyDigest;
    }
    if (typeof dto.notifyAttention === "boolean") {
      data.notifyAttention = dto.notifyAttention;
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { notifyDigest: true, notifyAttention: true },
    });
    return user;
  }

  /* ------------------------------------------------------------------ *
   * Fan-out primitives
   * ------------------------------------------------------------------ */

  /**
   * Insert the inbox row and its optional email atomically. The dedup key
   * keeps repeat events from staging a second letter.
   */
  private async notify(input: AttentionInput): Promise<number> {
    const seen = new Set<string>();
    let created = 0;
    for (const recipient of input.recipients) {
      if (seen.has(recipient.id) || recipient.disabledAt !== null) continue;
      seen.add(recipient.id);
      const locale: MailLocale = recipient.locale === "ru" ? "ru" : "en";
      const letter = attentionEmail(
        input.type,
        input.emailVars(locale),
        locale,
      );
      const [title = "Attention", ...rest] = letter.text.split("\n");
      const body = (input.inboxBody?.(locale) ?? rest.join("\n")).trim();
      const dedupKey = `${input.dedupKey}:${recipient.id}`;
      const attentionMailId = recipient.notifyAttention
        ? notificationMailId("attention", dedupKey)
        : null;
      const data = {
        userId: recipient.id,
        boardId: input.boardId,
        type: input.type,
        commentId: input.commentId ?? null,
        dedupKey,
        title,
        body: body === "" ? null : body,
        data: input.data as Prisma.InputJsonValue | undefined,
        attentionMailId,
      };
      try {
        if (attentionMailId === null) {
          await this.prisma.attentionNotification.create({ data });
        } else {
          const message = await this.templates
            .attentionEmail(input.type, input.emailVars(locale), locale)
            .catch((error: unknown) => {
              this.warn(`attention template ${input.type}`, error);
              return letter;
            });
          await this.prisma.$transaction(async (tx) => {
            await tx.attentionNotification.create({ data });
            await tx.notificationMail.create({
              data: {
                id: attentionMailId,
                kind: "attention",
                userId: recipient.id,
                boardIds: input.boardId === null ? [] : [input.boardId],
                message: { to: recipient.email, ...message },
              },
            });
          });
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        this.warn(`attention ${input.type}`, error);
        continue;
      }
      created += 1;
      if (attentionMailId !== null) void this.delivery.kick();
    }
    return created;
  }

  private async boardTitle(boardId: string): Promise<string | null> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { title: true },
    });
    return board?.title ?? null;
  }

  private async boardAdmins(boardId: string): Promise<AttentionRecipient[]> {
    const now = new Date();
    const rows = await this.prisma.boardMember.findMany({
      where: {
        boardId,
        role: Role.ADMIN,
        ...activeMembershipWhere(now),
      },
      select: { user: { select: RECIPIENT_SELECT } },
    });
    return rows
      .map((row) => row.user)
      .filter((user) => user.disabledAt === null);
  }

  private async members(
    boardId: string,
    userIds: string[],
  ): Promise<AttentionRecipient[]> {
    if (userIds.length === 0) return [];
    const now = new Date();
    const rows = await this.prisma.boardMember.findMany({
      where: {
        boardId,
        userId: { in: [...new Set(userIds)] },
        ...activeMembershipWhere(now),
      },
      select: { user: { select: RECIPIENT_SELECT } },
    });
    return rows
      .map((row) => row.user)
      .filter((user) => user.disabledAt === null);
  }

  private async activeMember(
    boardId: string,
    userId: string,
  ): Promise<AttentionRecipient | null> {
    const rows = await this.members(boardId, [userId]);
    return rows[0] ?? null;
  }

  private async accessibleBoardIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.boardMember.findMany({
      where: {
        userId,
        board: { deletedAt: null },
        ...activeMembershipWhere(new Date()),
      },
      select: { boardId: true },
    });
    return new Set(rows.map((row) => row.boardId));
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      message: "Notification not found",
      code: "not_found",
      resource: "notification",
      notificationId: id,
      retryable: false,
    });
  }

  private warn(scope: string, error: unknown): void {
    this.logger.warn(
      `${scope} attention failed (ignored): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function toAttentionDto(row: {
  id: string;
  type: string;
  boardId: string | null;
  title: string;
  body: string | null;
  data: Prisma.JsonValue | null;
  readAt: Date | null;
  createdAt: Date;
}): AttentionNotificationDto {
  return {
    id: row.id,
    type: row.type as AttentionNotificationType,
    boardId: row.boardId,
    title: row.title,
    body: row.body,
    data:
      typeof row.data === "object" && row.data !== null
        ? (row.data as Record<string, unknown>)
        : null,
    readAt: row.readAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
  };
}

/** A bounded, human card list: three titles then “and N more”. */
function assignmentCardList(titles: string[], locale: MailLocale): string {
  const shown = titles.slice(0, ASSIGNMENT_TITLE_LIMIT);
  const more = titles.length - shown.length;
  if (more === 0) return shown.join(", ");
  return locale === "ru"
    ? `${shown.join(", ")} и ещё ${more}`
    : `${shown.join(", ")}, and ${more} more`;
}

/** Authenticated in-app body; the attention letter uses `emailVars` instead. */
function assignmentInboxBody(
  input: {
    board: string;
    titles: string[];
    count: number;
    actorName: string | null;
  },
  locale: MailLocale,
): string {
  const ru = locale === "ru";
  const who =
    input.actorName?.trim() || (ru ? "Участник доски" : "A board member");
  const list = assignmentCardList(input.titles, locale);
  if (input.count === 1) {
    return ru
      ? `${who} назначил(а) вам карточку «${list}» на доске «${input.board}». Откройте карточку, чтобы посмотреть детали.`
      : `${who} assigned you a card “${list}” on board “${input.board}”. Open the card to see the details.`;
  }
  // Neutral count wording: “новые карточки (21)” stays grammatical for every
  // Russian plural form instead of producing “21 карточек”.
  return ru
    ? `${who} назначил(а) вам новые карточки (${input.count}) на доске «${input.board}»: ${list}. Откройте доску с фильтром по вашим карточкам.`
    : `${who} assigned you ${input.count} cards on board “${input.board}”: ${list}. Open the board filtered to your cards.`;
}

function parseLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_LIMIT);
}

interface AttentionCursor {
  at: Date;
  id: string;
}

function parseCursor(raw: string): AttentionCursor {
  const match = /^(\d+):(.+)$/.exec(raw);
  if (match === null) {
    throw new BadRequestException("cursor is malformed");
  }
  const at = Number(match[1]);
  if (!Number.isSafeInteger(at) || at > MAX_CURSOR_MS) {
    throw new BadRequestException("cursor is malformed");
  }
  return { at: new Date(at), id: match[2]! };
}
