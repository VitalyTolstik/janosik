import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
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
import { MailQueueService } from "@/mailer/mail-queue.service";
import type { MailLocale } from "@/mailer/mail.types";
import { attentionEmail, type AttentionEmailVars } from "@/mailer/templates";
import { EmailTemplateService } from "@/ops/email-template.service";

/** Default/maximum page size of the in-app attention inbox. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
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
  /** Stable base key; the recipient id is appended by the service. */
  dedupKey: string;
  recipients: AttentionRecipient[];
  emailVars: (locale: MailLocale) => AttentionEmailVars;
  data?: Record<string, unknown>;
}

export interface CommentAttentionInput {
  boardId: string;
  cardId: string;
  commentId: string;
  kind: "blocker" | "handoff";
  agentName: string | null;
}

export interface ClaimExpiredInput {
  boardId: string;
  cardId: string;
  cardTitle: string;
  claimedBy: string | null;
  agentName: string | null;
  leaseUntil: Date;
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
 * blocker events, the requester/decision actor for a decision, the claimant
 * plus ADMINs for an expired claim, and the account itself for a quota
 * warning. Disabled accounts and expired memberships are dropped. A PAT is
 * never a recipient — the query always reads `User.email`, never a token.
 */
@Injectable()
export class AttentionService {
  private readonly logger = new Logger(AttentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailQueueService,
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
          { createdAt: { lt: new Date(cursor.at) } },
          { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
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
   * Insert one row per recipient and fire the letter. A duplicate key means
   * the event was already delivered: no second row, no second e-mail.
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
      const body = rest.join("\n").trim();
      const dedupKey = `${input.dedupKey}:${recipient.id}`;
      let row;
      try {
        row = await this.prisma.attentionNotification.create({
          data: {
            userId: recipient.id,
            boardId: input.boardId,
            type: input.type,
            dedupKey,
            title,
            body: body === "" ? null : body,
            data:
              input.data === undefined
                ? undefined
                : (input.data as Prisma.InputJsonValue),
          },
        });
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
      if (recipient.notifyAttention) {
        void this.sendEmail(row.id, recipient, input, locale);
      }
    }
    return created;
  }

  private async sendEmail(
    notificationId: string,
    recipient: AttentionRecipient,
    input: AttentionInput,
    locale: MailLocale,
  ): Promise<void> {
    try {
      const message = await this.templates.attentionEmail(
        input.type,
        input.emailVars(locale),
        locale,
      );
      await this.mail.enqueue({ to: recipient.email, ...message });
      await this.prisma.attentionNotification.updateMany({
        where: { id: notificationId, emailedAt: null },
        data: { emailedAt: new Date() },
      });
    } catch (error) {
      this.warn(`attention e-mail ${input.type}`, error);
    }
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

function parseLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_LIMIT);
}

interface AttentionCursor {
  at: number;
  id: string;
}

function parseCursor(raw: string): AttentionCursor {
  const match = /^(\d+):(.+)$/.exec(raw);
  if (match === null) {
    throw new BadRequestException("cursor is malformed");
  }
  const at = Number(match[1]);
  if (!Number.isSafeInteger(at) || at < 0) {
    throw new BadRequestException("cursor is malformed");
  }
  return { at, id: match[2]! };
}
