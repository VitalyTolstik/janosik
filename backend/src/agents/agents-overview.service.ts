import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AgentRun,
  AgentSession,
  ApprovalRequest,
  Prisma,
} from "@prisma/client";
import { Role } from "@prisma/client";
import {
  AGENT_SESSION_STALE_MS,
  AGENT_RUN_KINDS,
  APPROVAL_KINDS,
  type AgentRunKind,
  type AgentsOverviewApprovalItem,
  type AgentsOverviewApprovalStatus,
  type AgentsOverviewCounts,
  type AgentsOverviewFacets,
  type AgentsOverviewResponse,
  type AgentsOverviewRunItem,
  type AgentsOverviewRunStatus,
  type AgentsOverviewScope,
  type AgentsOverviewSessionItem,
  type AgentsOverviewSessionStatus,
  type ApprovalKind,
  type ApprovalStatus,
  type BoardRole,
} from "@janosik/shared";
import { toAgentSessionDto } from "@/agent-sessions/agent-sessions.service";
import { activeMembershipWhere } from "@/common/membership";
import { PrismaService } from "@/common/prisma/prisma.service";
import { runToDto } from "@/runs/runs.service";
import type { AgentsOverviewQueryDto } from "./dto/agents-overview.dto";
import {
  decodeOverviewCursor,
  effectiveApprovalStatus,
  encodeOverviewCursor,
  escapeLikePattern,
  invalidCursor,
  invalidFilter,
  invalidRange,
  overviewBinding,
  parseApprovalStatusFilter,
  parseRunStatusFilter,
  parseSessionStatusFilter,
  type OverviewCursor,
} from "./agents-overview.model";

const TERMINAL_SESSION_STATUSES = ["completed", "failed", "cancelled"] as const;

const FACET_LIMIT = 200;

interface ScopeMembership {
  role: BoardRole;
  createdAt: Date;
  board: {
    id: string;
    title: string;
    agentsPausedAt: Date | null;
  };
}

interface OverviewContext {
  userId: string;
  now: Date;
  limit: number;
  q: string | undefined;
  boardId: string | null;
  /** Every accepted, non-expired, non-deleted, non-archived membership. */
  memberships: ScopeMembership[];
  /** The selected board, or every membership when `boardId` is absent. */
  scoped: ScopeMembership[];
  boardIds: string[];
  /** Admin boards inside the selected scope; empty for a member/viewer board. */
  adminBoardIds: string[];
  binding: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  facets: AgentsOverviewFacets;
}

/**
 * TASK-179.10 — read-only cross-board `/agents` aggregation.
 *
 * The endpoint is browser-session only (`SessionOnlyGuard` at the controller)
 * and resolves the caller's board scope from accepted, non-expired
 * memberships. It never calls `ApprovalsService.expireOverdue`, never deletes
 * an expired membership and never writes activity/notifications/SSE: every
 * effective expiry decision is computed from one `now` slice.
 */
@Injectable()
export class AgentsOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(
    userId: string,
    query: AgentsOverviewQueryDto,
  ): Promise<AgentsOverviewResponse> {
    const now = new Date();
    const section = query.section ?? "approvals";
    const boardId = query.boardId ?? null;
    const q = normalizeSearch(query.q);
    const limit = query.limit ?? 50;
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      query.from > query.to
    ) {
      throw invalidRange();
    }

    const memberships = await this.loadScope(userId, now);
    const selected =
      boardId === null
        ? null
        : (memberships.find((row) => row.board.id === boardId) ?? null);
    // Unknown, deleted, archived, pending, expired and revoked boards answer
    // the same 404 — the endpoint must not become an existence oracle.
    if (boardId !== null && selected === null) throw this.boardNotFound();

    const scoped = selected === null ? memberships : [selected];
    const boardIds = scoped.map((row) => row.board.id);
    const adminBoardIds = scoped
      .filter((row) => row.role === Role.ADMIN)
      .map((row) => row.board.id);
    const canViewApprovals =
      selected === null
        ? adminBoardIds.length > 0
        : selected.role === Role.ADMIN;
    if (section === "approvals" && !canViewApprovals) {
      throw this.boardAdminOnly();
    }

    const context: OverviewContext = {
      userId,
      now,
      limit,
      q,
      boardId,
      memberships,
      scoped,
      boardIds,
      adminBoardIds,
      binding: overviewBinding({
        section,
        boardId,
        q,
        // Omitted and `status=all` are the same filter; normalize so a client
        // that adds the explicit default on page 2 keeps the same cursor.
        status: query.status?.trim() || "all",
        kind: query.kind?.trim() || undefined,
        tokenId: query.tokenId,
        sessionId: query.sessionId,
        from: query.from,
        to: query.to,
        scope: memberships.map((row) => `${row.board.id}:${row.role}`).sort(),
      }),
    };

    const counts = await this.loadCounts(context);
    const scope: AgentsOverviewScope = {
      boardId,
      boardTitle: selected?.board.title ?? null,
      role: selected?.role ?? null,
      canViewApprovals,
    };
    const refreshedAt = now.getTime();

    if (section === "approvals") {
      const page = await this.approvalPage(context, query);
      return {
        section,
        scope,
        items: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
        counts,
        facets: page.facets,
        refreshedAt,
      };
    }
    if (section === "sessions") {
      const page = await this.sessionPage(context, query);
      return {
        section,
        scope,
        items: page.items,
        nextCursor: page.nextCursor,
        total: page.total,
        counts,
        facets: page.facets,
        refreshedAt,
      };
    }
    const page = await this.runPage(context, query);
    return {
      section,
      scope,
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
      counts,
      facets: page.facets,
      refreshedAt,
    };
  }

  /**
   * The scope is deliberately read-only: expired VIEWER rows stay in the
   * table, pending invitations stay pending and a revoked (missing) row simply
   * confers nothing.
   */
  private async loadScope(
    userId: string,
    now: Date,
  ): Promise<ScopeMembership[]> {
    const rows = await this.prisma.boardMember.findMany({
      where: {
        userId,
        ...activeMembershipWhere(now),
        board: { deletedAt: null, archivedAt: null },
      },
      select: {
        role: true,
        createdAt: true,
        board: {
          select: { id: true, title: true, agentsPausedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      role: row.role as BoardRole,
      createdAt: row.createdAt,
      board: row.board,
    }));
  }

  private async loadCounts(
    context: OverviewContext,
  ): Promise<AgentsOverviewCounts> {
    const allAdminBoardIds = context.memberships
      .filter((row) => row.role === Role.ADMIN)
      .map((row) => row.board.id);
    const pausedTokenIds = await this.pausedSessionTokenIds(context.boardIds);

    const [
      boardPending,
      approvalPending,
      approvalTotal,
      sessionStatuses,
      sessionLive,
      sessionStale,
      sessionPaused,
      runStatuses,
    ] = await Promise.all([
      allAdminBoardIds.length === 0
        ? Promise.resolve([])
        : this.prisma.approvalRequest.groupBy({
            by: ["boardId"],
            where: {
              boardId: { in: allAdminBoardIds },
              status: "pending",
              expiresAt: { gt: context.now },
            },
            _count: { _all: true },
          }),
      context.adminBoardIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.approvalRequest.count({
            where: {
              boardId: { in: context.adminBoardIds },
              status: "pending",
              expiresAt: { gt: context.now },
            },
          }),
      context.adminBoardIds.length === 0
        ? Promise.resolve(0)
        : this.prisma.approvalRequest.count({
            where: { boardId: { in: context.adminBoardIds } },
          }),
      this.prisma.agentSession.groupBy({
        by: ["status"],
        where: { boardId: { in: context.boardIds } },
        _count: { _all: true },
      }),
      this.prisma.agentSession.count({
        where: {
          boardId: { in: context.boardIds },
          ...liveSessionWhere(),
        },
      }),
      this.prisma.agentSession.count({
        where: {
          boardId: { in: context.boardIds },
          ...staleSessionWhere(context.now),
        },
      }),
      this.prisma.agentSession.count({
        where: {
          boardId: { in: context.boardIds },
          ...this.pausedSessionWhere(context, pausedTokenIds),
        },
      }),
      this.prisma.agentRun.groupBy({
        by: ["status"],
        where: { boardId: { in: context.boardIds } },
        _count: { _all: true },
      }),
    ]);

    const pendingByBoard = new Map(
      boardPending.map((row) => [row.boardId, row._count._all]),
    );
    const sessionByStatus = new Map(
      sessionStatuses.map((row) => [row.status, row._count._all]),
    );
    const runByStatus = new Map(
      runStatuses.map((row) => [row.status, row._count._all]),
    );
    const totalSessions = [...sessionByStatus.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const totalRuns = [...runByStatus.values()].reduce(
      (sum, value) => sum + value,
      0,
    );

    return {
      boards: context.memberships.map((row) => ({
        id: row.board.id,
        title: row.board.title,
        role: row.role,
        pendingApprovals:
          row.role === Role.ADMIN
            ? (pendingByBoard.get(row.board.id) ?? 0)
            : null,
      })),
      approvals: {
        pending: approvalPending,
        decided: approvalTotal - approvalPending,
        total: approvalTotal,
      },
      sessions: {
        total: totalSessions,
        live: sessionLive,
        active: sessionByStatus.get("active") ?? 0,
        idle: sessionByStatus.get("idle") ?? 0,
        waiting: sessionByStatus.get("waiting_approval") ?? 0,
        stale: sessionStale,
        paused: sessionPaused,
      },
      runs: {
        total: totalRuns,
        applied: runByStatus.get("applied") ?? 0,
        reverted: runByStatus.get("reverted") ?? 0,
        failed: runByStatus.get("failed") ?? 0,
      },
    };
  }

  private async approvalPage(
    context: OverviewContext,
    query: AgentsOverviewQueryDto,
  ): Promise<Page<AgentsOverviewApprovalItem>> {
    const status = parseApprovalStatusFilter(query.status);
    const kind = parseKind(query.kind, APPROVAL_KINDS);
    const base = this.approvalBaseWhere(context, query, kind);
    const search = context.q
      ? await this.approvalSearchWhere(context, context.q)
      : undefined;
    const filter = approvalStatusWhere(status, context.now);
    const total = await this.prisma.approvalRequest.count({
      where: {
        AND: [base, ...(search ? [search] : []), ...(filter ? [filter] : [])],
      },
    });

    const cursor = query.cursor
      ? decodeOverviewCursor(query.cursor, context.binding)
      : null;
    if (cursor !== null) {
      const allowed =
        status === "pending"
          ? cursor.g === "approval_pending"
          : status === "all"
            ? cursor.g === "approval_pending" || cursor.g === "approval_decided"
            : cursor.g === "approval_decided";
      if (!allowed) throw invalidCursor();
    }

    const pageBase = {
      AND: [base, ...(search ? [search] : [])],
    };
    const pendingWhere: Prisma.ApprovalRequestWhereInput = {
      AND: [
        pageBase,
        { status: "pending", expiresAt: { gt: context.now } },
        ...(cursor?.g === "approval_pending"
          ? [approvalPendingAfter(cursor)]
          : []),
      ],
    };
    const decidedAfter =
      cursor?.g === "approval_decided"
        ? approvalDecidedAfter(cursor)
        : undefined;
    const decidedWhere: Prisma.ApprovalRequestWhereInput = {
      AND: [
        pageBase,
        { NOT: { status: "pending", expiresAt: { gt: context.now } } },
        ...(decidedAfter ? [decidedAfter] : []),
      ],
    };

    let rows: ApprovalRequest[] = [];
    let nextCursor: string | null = null;
    if (status === "pending") {
      const pending = await this.approvalPendingRows(
        pendingWhere,
        context.limit + 1,
      );
      rows = pending.slice(0, context.limit);
      if (pending.length > context.limit) {
        nextCursor = encodeApprovalCursor(
          "approval_pending",
          rows.at(-1)!,
          context.binding,
        );
      }
    } else if (status === "decided" || status !== "all") {
      const decided = await this.approvalDecidedRows(
        decidedWhere,
        context.limit + 1,
      );
      rows = decided.slice(0, context.limit);
      if (decided.length > context.limit) {
        nextCursor = encodeApprovalCursor(
          "approval_decided",
          rows.at(-1)!,
          context.binding,
        );
      }
    } else if (cursor?.g === "approval_decided") {
      const decided = await this.approvalDecidedRows(
        decidedWhere,
        context.limit + 1,
      );
      rows = decided.slice(0, context.limit);
      if (decided.length > context.limit) {
        nextCursor = encodeApprovalCursor(
          "approval_decided",
          rows.at(-1)!,
          context.binding,
        );
      }
    } else {
      const pending = await this.approvalPendingRows(
        pendingWhere,
        context.limit + 1,
      );
      if (pending.length > context.limit) {
        rows = pending.slice(0, context.limit);
        nextCursor = encodeApprovalCursor(
          "approval_pending",
          rows.at(-1)!,
          context.binding,
        );
      } else {
        rows = pending;
        const remaining = context.limit - rows.length;
        const decided = await this.approvalDecidedRows(
          decidedWhere,
          remaining + 1,
        );
        if (decided.length > remaining) {
          if (remaining === 0) {
            nextCursor = encodeOverviewCursor({
              v: 1,
              b: context.binding,
              g: "approval_decided",
              t: null,
              i: null,
            });
          } else {
            rows.push(...decided.slice(0, remaining));
            nextCursor = encodeApprovalCursor(
              "approval_decided",
              rows.at(-1)!,
              context.binding,
            );
          }
        } else {
          rows.push(...decided);
        }
      }
    }

    return {
      items: await this.mapApprovals(rows, context),
      nextCursor,
      total,
      facets: await this.approvalFacets(context),
    };
  }

  private approvalBaseWhere(
    context: OverviewContext,
    query: AgentsOverviewQueryDto,
    kind: ApprovalKind | undefined,
  ): Prisma.ApprovalRequestWhereInput {
    return {
      boardId: { in: context.adminBoardIds },
      ...(kind !== undefined ? { kind } : {}),
      ...(query.tokenId !== undefined
        ? { requestedByTokenId: query.tokenId }
        : {}),
      ...(query.sessionId !== undefined
        ? { agentSessionId: query.sessionId }
        : {}),
      ...timeRange("createdAt", query.from, query.to),
    };
  }

  private approvalPendingRows(
    where: Prisma.ApprovalRequestWhereInput,
    take: number,
  ): Promise<ApprovalRequest[]> {
    return this.prisma.approvalRequest.findMany({
      where,
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take,
    });
  }

  private approvalDecidedRows(
    where: Prisma.ApprovalRequestWhereInput,
    take: number,
  ): Promise<ApprovalRequest[]> {
    return this.prisma.approvalRequest.findMany({
      where,
      orderBy: [{ decidedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take,
    });
  }

  private async mapApprovals(
    rows: ApprovalRequest[],
    context: OverviewContext,
  ): Promise<AgentsOverviewApprovalItem[]> {
    if (rows.length === 0) return [];
    const boards = new Map(
      context.memberships.map((row) => [row.board.id, row]),
    );
    const cardIds = [
      ...new Set(
        rows.map((row) => row.cardId).filter((id): id is string => id !== null),
      ),
    ];
    const sessionIds = [
      ...new Set(
        rows
          .map((row) => row.agentSessionId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const tokenIds = [...new Set(rows.map((row) => row.requestedByTokenId))];
    const userIds = [
      ...new Set(
        rows.flatMap((row) =>
          [row.requestedBy, row.decidedBy].filter(
            (id): id is string => id !== null,
          ),
        ),
      ),
    ];

    const [cards, sessions, ownTokens, visibleMembers] = await Promise.all([
      cardIds.length === 0
        ? Promise.resolve([])
        : this.prisma.card.findMany({
            where: {
              id: { in: cardIds },
              deletedAt: null,
              column: { boardId: { in: context.adminBoardIds } },
            },
            select: { id: true, title: true },
          }),
      sessionIds.length === 0
        ? Promise.resolve([])
        : this.prisma.agentSession.findMany({
            where: {
              id: { in: sessionIds },
              boardId: { in: context.adminBoardIds },
            },
            select: { id: true, name: true, clientName: true },
          }),
      tokenIds.length === 0
        ? Promise.resolve([])
        : this.prisma.apiToken.findMany({
            where: { id: { in: tokenIds }, userId: context.userId },
            select: { id: true, name: true },
          }),
      this.visibleMembers(context.adminBoardIds, userIds, context.now),
    ]);
    const cardTitles = new Map(cards.map((row) => [row.id, row.title]));
    const sessionNames = new Map(
      sessions.map((row) => [row.id, row.name ?? row.clientName]),
    );
    const tokenNames = new Map(ownTokens.map((row) => [row.id, row.name]));

    return rows.flatMap((row) => {
      const board = boards.get(row.boardId);
      if (board === undefined) return [];
      const plan = planCounts(row.plan);
      const requestedBy = visibleMembers.get(
        memberKey(row.boardId, row.requestedBy),
      );
      const decidedBy =
        row.decidedBy === null
          ? undefined
          : visibleMembers.get(memberKey(row.boardId, row.decidedBy));
      const status = effectiveApprovalStatus(
        row.status as ApprovalStatus,
        row.expiresAt,
        context.now,
      );
      return [
        {
          id: row.id,
          boardId: row.boardId,
          cardId: row.cardId,
          requestedBy: row.requestedBy,
          requestedByTokenId: row.requestedByTokenId,
          agentSessionId: row.agentSessionId,
          kind: row.kind as ApprovalKind,
          actionType: row.actionType,
          summary: row.summary,
          risk: row.risk as "low" | "medium" | "high",
          planHash: row.planHash,
          status,
          storedStatus: row.status as ApprovalStatus,
          expiresAt: row.expiresAt.getTime(),
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt?.getTime() ?? null,
          decisionComment: row.decisionComment,
          runId: row.runId,
          consumedAt: row.consumedAt?.getTime() ?? null,
          createdAt: row.createdAt.getTime(),
          boardTitle: board.board.title,
          boardRole: board.role,
          cardTitle:
            row.cardId === null ? null : (cardTitles.get(row.cardId) ?? null),
          sessionName:
            row.agentSessionId === null
              ? null
              : (sessionNames.get(row.agentSessionId) ?? null),
          tokenName: tokenNames.get(row.requestedByTokenId) ?? null,
          requestedByName: requestedBy?.displayName ?? null,
          requestedByEmail: requestedBy?.email ?? null,
          decidedByName: decidedBy?.displayName ?? null,
          commandCount: plan.commands,
          operationCount: plan.operations,
        },
      ];
    });
  }

  private async approvalFacets(
    context: OverviewContext,
  ): Promise<AgentsOverviewFacets> {
    if (context.adminBoardIds.length === 0) return emptyFacets();
    const [tokens, sessions] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where: { boardId: { in: context.adminBoardIds } },
        distinct: ["requestedByTokenId"],
        select: { requestedByTokenId: true },
        take: FACET_LIMIT + 1,
      }),
      this.prisma.approvalRequest.findMany({
        where: {
          boardId: { in: context.adminBoardIds },
          agentSessionId: { not: null },
        },
        distinct: ["agentSessionId"],
        select: { agentSessionId: true },
        take: FACET_LIMIT + 1,
      }),
    ]);
    const tokenIds = tokens
      .slice(0, FACET_LIMIT)
      .map((row) => row.requestedByTokenId);
    const sessionIds = sessions
      .slice(0, FACET_LIMIT)
      .map((row) => row.agentSessionId)
      .filter((id): id is string => id !== null);
    return this.facets(
      context,
      tokenIds,
      tokens.length > FACET_LIMIT,
      sessionIds,
      sessions.length > FACET_LIMIT,
    );
  }

  private async sessionPage(
    context: OverviewContext,
    query: AgentsOverviewQueryDto,
  ): Promise<Page<AgentsOverviewSessionItem>> {
    const status = parseSessionStatusFilter(query.status);
    if ((query.kind?.trim() ?? "") !== "") throw invalidFilter("kind", []);
    const base = this.sessionBaseWhere(context, query);
    const search = context.q
      ? await this.sessionSearchWhere(context, context.q)
      : undefined;
    const filter = await this.sessionStatusWhere(status, context);
    const total = await this.prisma.agentSession.count({
      where: {
        AND: [base, ...(search ? [search] : []), ...(filter ? [filter] : [])],
      },
    });

    const cursor = query.cursor
      ? decodeOverviewCursor(query.cursor, context.binding)
      : null;
    if (cursor !== null && cursor.g !== "session") throw invalidCursor();
    const after =
      cursor === null ? undefined : sessionAfter(cursor, context.binding);
    const rows = await this.prisma.agentSession.findMany({
      where: {
        AND: [
          base,
          ...(search ? [search] : []),
          ...(filter ? [filter] : []),
          ...(after ? [after] : []),
        ],
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: context.limit + 1,
    });
    const items = rows.slice(0, context.limit);
    const nextCursor =
      rows.length > context.limit
        ? encodeOverviewCursor({
            v: 1,
            b: context.binding,
            g: "session",
            t: items.at(-1)!.startedAt.getTime(),
            i: items.at(-1)!.id,
          })
        : null;

    return {
      items: await this.mapSessions(items, context),
      nextCursor,
      total,
      facets: await this.sessionFacets(context),
    };
  }

  private sessionBaseWhere(
    context: OverviewContext,
    query: AgentsOverviewQueryDto,
  ): Prisma.AgentSessionWhereInput {
    return {
      boardId: { in: context.boardIds },
      ...(query.tokenId !== undefined ? { apiTokenId: query.tokenId } : {}),
      ...(query.sessionId !== undefined ? { id: query.sessionId } : {}),
      ...timeRange("startedAt", query.from, query.to),
    };
  }

  private async sessionStatusWhere(
    status: AgentsOverviewSessionStatus,
    context: OverviewContext,
  ): Promise<Prisma.AgentSessionWhereInput | undefined> {
    switch (status) {
      case "all":
        return undefined;
      case "live":
        return liveSessionWhere();
      case "stale":
        return staleSessionWhere(context.now);
      case "paused":
        return this.pausedSessionWhere(
          context,
          await this.pausedSessionTokenIds(context.boardIds),
        );
      default:
        return { status };
    }
  }

  private async mapSessions(
    rows: AgentSession[],
    context: OverviewContext,
  ): Promise<AgentsOverviewSessionItem[]> {
    if (rows.length === 0) return [];
    const boards = new Map(
      context.memberships.map((row) => [row.board.id, row]),
    );
    const cardIds = [
      ...new Set(
        rows
          .map((row) => row.currentCardId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const tokenIds = [...new Set(rows.map((row) => row.apiTokenId))];
    const [cards, tokens] = await Promise.all([
      cardIds.length === 0
        ? Promise.resolve([])
        : this.prisma.card.findMany({
            where: {
              id: { in: cardIds },
              deletedAt: null,
              column: { boardId: { in: context.boardIds } },
            },
            select: { id: true, title: true },
          }),
      tokenIds.length === 0
        ? Promise.resolve([])
        : this.prisma.apiToken.findMany({
            where: { id: { in: tokenIds } },
            select: {
              id: true,
              userId: true,
              name: true,
              individualPausedAt: true,
              stopAllPausedAt: true,
            },
          }),
    ]);
    const cardTitles = new Map(cards.map((row) => [row.id, row.title]));
    const tokenById = new Map(tokens.map((row) => [row.id, row]));

    return rows.flatMap((row) => {
      const board = boards.get(row.boardId);
      if (board === undefined) return [];
      const token = tokenById.get(row.apiTokenId);
      const dto = toAgentSessionDto(
        row,
        {
          tokenPaused:
            token !== undefined &&
            (token.individualPausedAt !== null ||
              token.stopAllPausedAt !== null),
          boardPausedAt: board.board.agentsPausedAt,
        },
        context.now.getTime(),
      );
      return [
        {
          ...dto,
          boardTitle: board.board.title,
          boardRole: board.role,
          tokenName:
            token !== undefined && token.userId === context.userId
              ? token.name
              : null,
          cardTitle:
            row.currentCardId === null
              ? null
              : (cardTitles.get(row.currentCardId) ?? null),
        },
      ];
    });
  }

  private async sessionFacets(
    context: OverviewContext,
  ): Promise<AgentsOverviewFacets> {
    if (context.boardIds.length === 0) return emptyFacets();
    const [tokens, sessions] = await Promise.all([
      this.prisma.agentSession.findMany({
        where: { boardId: { in: context.boardIds } },
        distinct: ["apiTokenId"],
        select: { apiTokenId: true },
        take: FACET_LIMIT + 1,
      }),
      this.prisma.agentSession.findMany({
        where: { boardId: { in: context.boardIds } },
        select: { id: true, name: true, clientName: true, boardId: true },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: FACET_LIMIT + 1,
      }),
    ]);
    return this.facets(
      context,
      tokens.slice(0, FACET_LIMIT).map((row) => row.apiTokenId),
      tokens.length > FACET_LIMIT,
      sessions.slice(0, FACET_LIMIT).map((row) => row.id),
      sessions.length > FACET_LIMIT,
      new Map(sessions.map((row) => [row.id, row.name ?? row.clientName])),
    );
  }

  private async runPage(
    context: OverviewContext,
    query: AgentsOverviewQueryDto,
  ): Promise<Page<AgentsOverviewRunItem>> {
    const status = parseRunStatusFilter(query.status);
    const kind = parseKind(query.kind, AGENT_RUN_KINDS);
    const base = this.runBaseWhere(context, query, status, kind);
    const search = context.q
      ? await this.runSearchWhere(context, context.q)
      : undefined;
    const total = await this.prisma.agentRun.count({
      where: { AND: [base, ...(search ? [search] : [])] },
    });

    const cursor = query.cursor
      ? decodeOverviewCursor(query.cursor, context.binding)
      : null;
    if (cursor !== null && cursor.g !== "run") throw invalidCursor();
    const after =
      cursor === null ? undefined : runAfter(cursor, context.binding);
    const rows = await this.prisma.agentRun.findMany({
      where: {
        AND: [base, ...(search ? [search] : []), ...(after ? [after] : [])],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: context.limit + 1,
    });
    const items = rows.slice(0, context.limit);
    const nextCursor =
      rows.length > context.limit
        ? encodeOverviewCursor({
            v: 1,
            b: context.binding,
            g: "run",
            t: items.at(-1)!.createdAt.getTime(),
            i: items.at(-1)!.id,
          })
        : null;

    return {
      items: await this.mapRuns(items, context),
      nextCursor,
      total,
      facets: await this.runFacets(context),
    };
  }

  private runBaseWhere(
    context: OverviewContext,
    query: AgentsOverviewQueryDto,
    status: AgentsOverviewRunStatus,
    kind: AgentRunKind | undefined,
  ): Prisma.AgentRunWhereInput {
    return {
      boardId: { in: context.boardIds },
      ...(status !== "all" ? { status } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(query.tokenId !== undefined ? { apiTokenId: query.tokenId } : {}),
      ...(query.sessionId !== undefined
        ? { agentSessionId: query.sessionId }
        : {}),
      ...timeRange("createdAt", query.from, query.to),
    };
  }

  private async mapRuns(
    rows: AgentRun[],
    context: OverviewContext,
  ): Promise<AgentsOverviewRunItem[]> {
    if (rows.length === 0) return [];
    const boards = new Map(
      context.memberships.map((row) => [row.board.id, row]),
    );
    const tokenIds = [
      ...new Set(
        rows
          .map((row) => row.apiTokenId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const sessionIds = [
      ...new Set(
        rows
          .map((row) => row.agentSessionId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const actorIds = [...new Set(rows.map((row) => row.actorId))];
    const [tokens, sessions, visibleMembers] = await Promise.all([
      tokenIds.length === 0
        ? Promise.resolve([])
        : this.prisma.apiToken.findMany({
            where: { id: { in: tokenIds }, userId: context.userId },
            select: { id: true, name: true },
          }),
      sessionIds.length === 0
        ? Promise.resolve([])
        : this.prisma.agentSession.findMany({
            where: {
              id: { in: sessionIds },
              boardId: { in: context.boardIds },
            },
            select: { id: true, name: true, clientName: true },
          }),
      this.visibleMembers(context.boardIds, actorIds, context.now),
    ]);
    const tokenNames = new Map(tokens.map((row) => [row.id, row.name]));
    const sessionNames = new Map(
      sessions.map((row) => [row.id, row.name ?? row.clientName]),
    );

    return rows.flatMap((row) => {
      const board = boards.get(row.boardId);
      if (board === undefined) return [];
      const actor = visibleMembers.get(memberKey(row.boardId, row.actorId));
      return [
        {
          ...runToDto(row),
          boardTitle: board.board.title,
          boardRole: board.role,
          tokenName:
            row.apiTokenId === null
              ? null
              : (tokenNames.get(row.apiTokenId) ?? null),
          sessionName:
            row.agentSessionId === null
              ? null
              : (sessionNames.get(row.agentSessionId) ?? null),
          actorName: actor?.displayName ?? null,
          durationMs: Math.max(
            0,
            row.appliedAt.getTime() - row.createdAt.getTime(),
          ),
        },
      ];
    });
  }

  private async runFacets(
    context: OverviewContext,
  ): Promise<AgentsOverviewFacets> {
    if (context.boardIds.length === 0) return emptyFacets();
    const [tokens, sessions] = await Promise.all([
      this.prisma.agentRun.findMany({
        where: {
          boardId: { in: context.boardIds },
          apiTokenId: { not: null },
        },
        distinct: ["apiTokenId"],
        select: { apiTokenId: true },
        take: FACET_LIMIT + 1,
      }),
      this.prisma.agentRun.findMany({
        where: {
          boardId: { in: context.boardIds },
          agentSessionId: { not: null },
        },
        distinct: ["agentSessionId"],
        select: { agentSessionId: true },
        take: FACET_LIMIT + 1,
      }),
    ]);
    return this.facets(
      context,
      tokens
        .slice(0, FACET_LIMIT)
        .map((row) => row.apiTokenId)
        .filter((id): id is string => id !== null),
      tokens.length > FACET_LIMIT,
      sessions
        .slice(0, FACET_LIMIT)
        .map((row) => row.agentSessionId)
        .filter((id): id is string => id !== null),
      sessions.length > FACET_LIMIT,
    );
  }

  /**
   * Build named filter options for the current section scope. Token names are
   * disclosed only for the caller's own tokens; session names only for
   * sessions on a board the caller can already read.
   */
  private async facets(
    context: OverviewContext,
    tokenIds: string[],
    tokensTruncated: boolean,
    sessionIds: string[],
    sessionsTruncated: boolean,
    knownSessionNames: Map<string, string | null> = new Map(),
  ): Promise<AgentsOverviewFacets> {
    const boards = new Map(
      context.memberships.map((row) => [row.board.id, row.board.title]),
    );
    const [ownTokens, sessions] = await Promise.all([
      tokenIds.length === 0
        ? Promise.resolve([])
        : this.prisma.apiToken.findMany({
            where: { id: { in: tokenIds }, userId: context.userId },
            select: { id: true, name: true },
          }),
      sessionIds.length === 0
        ? Promise.resolve([])
        : this.prisma.agentSession.findMany({
            where: {
              id: { in: sessionIds },
              boardId: { in: context.boardIds },
            },
            select: { id: true, name: true, clientName: true, boardId: true },
          }),
    ]);
    const ownNames = new Map(ownTokens.map((row) => [row.id, row.name]));
    return {
      tokens: tokenIds.map((id) => ({
        id,
        name: ownNames.get(id) ?? null,
        own: ownNames.has(id),
      })),
      sessions: sessions.flatMap((row) => {
        const boardTitle = boards.get(row.boardId);
        if (boardTitle === undefined) return [];
        return [
          {
            id: row.id,
            name:
              knownSessionNames.get(row.id) ??
              row.name ??
              row.clientName ??
              null,
            boardId: row.boardId,
            boardTitle,
          },
        ];
      }),
      tokensTruncated,
      sessionsTruncated,
    };
  }

  private async approvalSearchWhere(
    context: OverviewContext,
    q: string,
  ): Promise<Prisma.ApprovalRequestWhereInput> {
    const [cards, sessions, visibleMembers, ownTokenIds] = await Promise.all([
      this.cardsMatchingTitle(context.adminBoardIds, q),
      this.sessionsMatchingName(context.adminBoardIds, q),
      this.visibleMemberMatches(context.adminBoardIds, q, context.now),
      this.ownTokenIdsMatching(context.userId, q),
    ]);
    const boardIds = this.boardIdsMatchingTitle(
      context,
      context.adminBoardIds,
      q,
    );
    const or: Prisma.ApprovalRequestWhereInput[] = [
      { summary: this.text(q) },
      { actionType: this.text(q) },
      { kind: this.text(q) },
      { planHash: this.text(q) },
      { id: this.text(q) },
      { requestedByTokenId: this.text(q) },
      { agentSessionId: this.text(q) },
    ];
    if (boardIds.length > 0) or.push({ boardId: { in: boardIds } });
    if (cards.length > 0) or.push({ cardId: { in: cards } });
    if (sessions.length > 0) or.push({ agentSessionId: { in: sessions } });
    // Couple the name match to the same board: a member of A must not make a
    // board-B approval searchable by that member's name when B hides it.
    for (const member of visibleMembers) {
      or.push({ boardId: member.boardId, requestedBy: member.userId });
    }
    if (ownTokenIds.length > 0) {
      or.push({ requestedByTokenId: { in: ownTokenIds } });
    }
    return { OR: or };
  }

  private async sessionSearchWhere(
    context: OverviewContext,
    q: string,
  ): Promise<Prisma.AgentSessionWhereInput> {
    const [cards, visibleMembers, ownTokenIds] = await Promise.all([
      this.cardsMatchingTitle(context.boardIds, q),
      this.visibleMemberMatches(context.boardIds, q, context.now),
      this.ownTokenIdsMatching(context.userId, q),
    ]);
    const boardIds = this.boardIdsMatchingTitle(context, context.boardIds, q);
    const or: Prisma.AgentSessionWhereInput[] = [
      { name: this.text(q) },
      { clientName: this.text(q) },
      { model: this.text(q) },
      { id: this.text(q) },
      { apiTokenId: this.text(q) },
      { currentRunId: this.text(q) },
      { currentCardId: this.text(q) },
      { status: this.text(q) },
    ];
    if (boardIds.length > 0) or.push({ boardId: { in: boardIds } });
    if (cards.length > 0) or.push({ currentCardId: { in: cards } });
    for (const member of visibleMembers) {
      or.push({ boardId: member.boardId, userId: member.userId });
    }
    if (ownTokenIds.length > 0) {
      or.push({ apiTokenId: { in: ownTokenIds } });
    }
    return { OR: or };
  }

  private async runSearchWhere(
    context: OverviewContext,
    q: string,
  ): Promise<Prisma.AgentRunWhereInput> {
    const [sessions, visibleMembers, ownTokenIds] = await Promise.all([
      this.sessionsMatchingName(context.boardIds, q),
      this.visibleMemberMatches(context.boardIds, q, context.now),
      this.ownTokenIdsMatching(context.userId, q),
    ]);
    const boardIds = this.boardIdsMatchingTitle(context, context.boardIds, q);
    const or: Prisma.AgentRunWhereInput[] = [
      { id: this.text(q) },
      { kind: this.text(q) },
      { status: this.text(q) },
      { clientRunId: this.text(q) },
      { planHash: this.text(q) },
      { approvalId: this.text(q) },
      { apiTokenId: this.text(q) },
      { agentSessionId: this.text(q) },
      { actorId: this.text(q) },
    ];
    if (boardIds.length > 0) or.push({ boardId: { in: boardIds } });
    if (sessions.length > 0) or.push({ agentSessionId: { in: sessions } });
    for (const member of visibleMembers) {
      or.push({ boardId: member.boardId, actorId: member.userId });
    }
    if (ownTokenIds.length > 0) {
      or.push({ apiTokenId: { in: ownTokenIds } });
    }
    return { OR: or };
  }

  private text(value: string): Prisma.StringFilter {
    return { contains: escapeLikePattern(value), mode: "insensitive" };
  }

  private boardIdsMatchingTitle(
    context: OverviewContext,
    allowedBoardIds: string[],
    q: string,
  ): string[] {
    const needle = q.toLowerCase();
    const allowed = new Set(allowedBoardIds);
    return context.memberships
      .filter(
        (row) =>
          allowed.has(row.board.id) &&
          row.board.title.toLowerCase().includes(needle),
      )
      .map((row) => row.board.id);
  }

  private async cardsMatchingTitle(
    boardIds: string[],
    q: string,
  ): Promise<string[]> {
    if (boardIds.length === 0) return [];
    const rows = await this.prisma.card.findMany({
      where: {
        column: { boardId: { in: boardIds } },
        deletedAt: null,
        title: this.text(q),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async sessionsMatchingName(
    boardIds: string[],
    q: string,
  ): Promise<string[]> {
    if (boardIds.length === 0) return [];
    const rows = await this.prisma.agentSession.findMany({
      where: {
        boardId: { in: boardIds },
        OR: [
          { name: this.text(q) },
          { clientName: this.text(q) },
          { model: this.text(q) },
        ],
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async visibleMemberMatches(
    boardIds: string[],
    q: string,
    now: Date,
  ): Promise<Array<{ boardId: string; userId: string }>> {
    if (boardIds.length === 0) return [];
    const rows = await this.prisma.boardMember.findMany({
      where: {
        boardId: { in: boardIds },
        ...activeMembershipWhere(now),
        user: {
          OR: [{ displayName: this.text(q) }, { email: this.text(q) }],
        },
      },
      select: { boardId: true, userId: true },
    });
    const unique = new Map(
      rows.map((row) => [memberKey(row.boardId, row.userId), row]),
    );
    return [...unique.values()];
  }

  private async ownTokenIdsMatching(
    userId: string,
    q: string,
  ): Promise<string[]> {
    const rows = await this.prisma.apiToken.findMany({
      where: { userId, name: this.text(q) },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async visibleMembers(
    boardIds: string[],
    userIds: string[],
    now: Date,
  ): Promise<Map<string, { displayName: string | null; email: string }>> {
    if (boardIds.length === 0 || userIds.length === 0) return new Map();
    const rows = await this.prisma.boardMember.findMany({
      where: {
        boardId: { in: boardIds },
        userId: { in: userIds },
        ...activeMembershipWhere(now),
      },
      select: {
        boardId: true,
        userId: true,
        user: { select: { displayName: true, email: true } },
      },
    });
    return new Map(
      rows.map((row) => [memberKey(row.boardId, row.userId), row.user]),
    );
  }

  private async pausedSessionTokenIds(boardIds: string[]): Promise<string[]> {
    if (boardIds.length === 0) return [];
    const tokenRows = await this.prisma.agentSession.findMany({
      where: { boardId: { in: boardIds } },
      distinct: ["apiTokenId"],
      select: { apiTokenId: true },
    });
    if (tokenRows.length === 0) return [];
    const paused = await this.prisma.apiToken.findMany({
      where: {
        id: { in: tokenRows.map((row) => row.apiTokenId) },
        OR: [
          { individualPausedAt: { not: null } },
          { stopAllPausedAt: { not: null } },
        ],
      },
      select: { id: true },
    });
    return paused.map((row) => row.id);
  }

  private pausedSessionWhere(
    context: OverviewContext,
    pausedTokenIds: string[],
  ): Prisma.AgentSessionWhereInput {
    const pausedBoardIds = context.scoped
      .filter((row) => row.board.agentsPausedAt !== null)
      .map((row) => row.board.id);
    const parts: Prisma.AgentSessionWhereInput[] = [
      { pausedAt: { not: null } },
    ];
    if (pausedBoardIds.length > 0) {
      parts.push({ boardId: { in: pausedBoardIds } });
    }
    if (pausedTokenIds.length > 0) {
      parts.push({ apiTokenId: { in: pausedTokenIds } });
    }
    return { AND: [liveSessionWhere(), { OR: parts }] };
  }

  private boardNotFound(): NotFoundException {
    return new NotFoundException({
      message: "Board not found",
      code: "not_found",
      resource: "board",
      retryable: false,
    });
  }

  private boardAdminOnly(): ForbiddenException {
    return new ForbiddenException({
      message: "Only a board ADMIN can read approvals",
      code: "scope_denied",
      requiredRoles: ["ADMIN"],
      retryable: false,
    });
  }
}

function normalizeSearch(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  return value === "" ? undefined : value;
}

function parseKind<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | undefined {
  const value = raw?.trim() || undefined;
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw invalidFilter("kind", allowed);
  }
  return value as T;
}

function timeRange(
  field: "createdAt" | "startedAt",
  from: number | undefined,
  to: number | undefined,
): {
  createdAt?: Prisma.DateTimeFilter;
  startedAt?: Prisma.DateTimeFilter;
} {
  if (from === undefined && to === undefined) return {};
  return {
    [field]: {
      ...(from !== undefined ? { gte: new Date(from) } : {}),
      ...(to !== undefined ? { lte: new Date(to) } : {}),
    },
  };
}

function liveSessionWhere(): Prisma.AgentSessionWhereInput {
  return {
    endedAt: null,
    status: { notIn: [...TERMINAL_SESSION_STATUSES] },
  };
}

function staleSessionWhere(now: Date): Prisma.AgentSessionWhereInput {
  return {
    AND: [
      liveSessionWhere(),
      {
        lastHeartbeatAt: {
          lt: new Date(now.getTime() - AGENT_SESSION_STALE_MS),
        },
      },
    ],
  };
}

function approvalStatusWhere(
  status: AgentsOverviewApprovalStatus,
  now: Date,
): Prisma.ApprovalRequestWhereInput | undefined {
  switch (status) {
    case "all":
      return undefined;
    case "pending":
      return { status: "pending", expiresAt: { gt: now } };
    case "approved":
      return { status: "approved", expiresAt: { gt: now } };
    case "rejected":
      return { status: "rejected" };
    case "cancelled":
      return { status: "cancelled" };
    case "consumed":
      return { status: "consumed" };
    case "expired":
      return {
        OR: [
          { status: "expired" },
          { status: { in: ["pending", "approved"] }, expiresAt: { lte: now } },
        ],
      };
    case "decided":
      return { NOT: { status: "pending", expiresAt: { gt: now } } };
  }
}

function approvalPendingAfter(
  cursor: OverviewCursor,
): Prisma.ApprovalRequestWhereInput {
  if (cursor.t === null || cursor.i === null) throw invalidCursor();
  return {
    OR: [
      { expiresAt: { gt: new Date(cursor.t) } },
      { expiresAt: new Date(cursor.t), id: { gt: cursor.i } },
    ],
  };
}

function approvalDecidedAfter(
  cursor: OverviewCursor,
): Prisma.ApprovalRequestWhereInput | undefined {
  if (cursor.i === null) return undefined;
  if (cursor.t === null) {
    return { decidedAt: null, id: { lt: cursor.i } };
  }
  return {
    OR: [
      { decidedAt: { lt: new Date(cursor.t) } },
      { decidedAt: new Date(cursor.t), id: { lt: cursor.i } },
      { decidedAt: null },
    ],
  };
}

function encodeApprovalCursor(
  group: "approval_pending" | "approval_decided",
  row: ApprovalRequest,
  binding: string,
): string {
  return encodeOverviewCursor({
    v: 1,
    b: binding,
    g: group,
    t:
      group === "approval_pending"
        ? row.expiresAt.getTime()
        : (row.decidedAt?.getTime() ?? null),
    i: row.id,
  });
}

function sessionAfter(
  cursor: OverviewCursor,
  binding: string,
): Prisma.AgentSessionWhereInput {
  if (cursor.b !== binding || cursor.t === null || cursor.i === null) {
    throw invalidCursor();
  }
  return {
    OR: [
      { startedAt: { lt: new Date(cursor.t) } },
      { startedAt: new Date(cursor.t), id: { lt: cursor.i } },
    ],
  };
}

function runAfter(
  cursor: OverviewCursor,
  binding: string,
): Prisma.AgentRunWhereInput {
  if (cursor.b !== binding || cursor.t === null || cursor.i === null) {
    throw invalidCursor();
  }
  return {
    OR: [
      { createdAt: { lt: new Date(cursor.t) } },
      { createdAt: new Date(cursor.t), id: { lt: cursor.i } },
    ],
  };
}

function planCounts(plan: Prisma.JsonValue): {
  commands: number;
  operations: number;
} {
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) {
    return { commands: 0, operations: 0 };
  }
  const record = plan as Record<string, unknown>;
  return {
    commands: Array.isArray(record.commands) ? record.commands.length : 0,
    operations: Array.isArray(record.operations) ? record.operations.length : 0,
  };
}

function memberKey(boardId: string, userId: string): string {
  return `${boardId}:${userId}`;
}

function emptyFacets(): AgentsOverviewFacets {
  return {
    tokens: [],
    sessions: [],
    tokensTruncated: false,
    sessionsTruncated: false,
  };
}
