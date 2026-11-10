import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ApprovalRequest, Prisma, Role } from "@prisma/client";
import type {
  ApprovalKind,
  ApprovalOperationName,
  ApprovalPlan,
  ApprovalRequestDto,
  ApprovalStatus,
} from "@janosik/shared";
import { loadBoardAggregate } from "@/boards/board-aggregate";
import type { PreparedCommand } from "@/commands/command-validation";
import type { AuthPrincipal } from "@/auth/auth-principal";
import {
  effectiveTokenScope,
  LIFECYCLE_ACTIONS,
  readBoardAgentPolicy,
  SCOPE_RANK,
  type BoardAgentPolicy,
} from "@/auth/token-scope";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecurityAuditService } from "@/common/security-audit/security-audit.service";
import { AttentionService } from "@/notifications/attention.service";
import { RealtimeService } from "@/realtime/realtime.service";
import type {
  CreateApprovalDto,
  ApprovalDecisionDto,
} from "./dto/approval.dto";
import {
  approvalPlanHash,
  cardIdOfPlan,
  classifyPlan,
  normalizeApprovalPlan,
  planActionFingerprint,
  planFromOperation,
  riskOfPlan,
  summarizePlan,
  type PlanRequirement,
} from "./approval-plan";

/** TTL floor from ADR §10.2: no approval is shorter-lived than five minutes. */
export const APPROVAL_TTL_FLOOR_MINUTES = 5;

/** One row plus the plan detail flag the caller earned. */
interface ApprovalView {
  row: ApprovalRequest;
  includePlan: boolean;
}

/**
 * Approval lifecycle (TASK-166.5, ADR §10).
 *
 * A PAT asks for a human decision on one exact plan; a browser board ADMIN
 * decides; the same PAT repeats the plan with `X-Approval-Id` and consumes it
 * once. The row is the boundary between intent and execution: creation never
 * applies anything, decision never applies anything, and consumption happens
 * in the same board transaction as the write.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly securityAudit: SecurityAuditService,
    private readonly attention: AttentionService,
  ) {}

  /** `POST /boards/:id/approvals` — PAT-only. */
  async create(
    boardId: string,
    userId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
    dto: CreateApprovalDto,
  ): Promise<ApprovalRequestDto> {
    this.requirePat(principal, "create");
    const board = await this.board(boardId);
    const policy = readBoardAgentPolicy(board.agentPolicy);
    const aggregate = await loadBoardAggregate(this.prisma, boardId);
    if (aggregate === null) throw this.boardNotFound();

    const plan = normalizeApprovalPlan(dto.plan, boardId);
    await this.assertPlanLimitsForUser(plan, policy, userId, boardId);
    const requirement = classifyPlan(
      plan,
      aggregate,
      policy,
      principal.tokenIdentity?.trustedCi === true,
    );
    this.assertScope(principal, role, requirement);
    this.assertPolicyAllows(requirement, policy);
    this.assertKind(dto.kind, requirement);

    await this.expireOverdue(boardId);

    const existing = await this.findByIdempotentPlan(
      boardId,
      principal.apiTokenId!,
      plan,
    );
    if (existing !== null) {
      if (existing.status === "pending" || existing.status === "approved") {
        return this.toDto({ row: existing, includePlan: true });
      }
      if (existing.status === "consumed") {
        if (await this.consumedPlanApplied(existing)) {
          return this.toDto({ row: existing, includePlan: true });
        }
        throw this.consumed(existing);
      }
    }

    const cardId = await this.resolveCardId(
      boardId,
      dto.cardId ?? cardIdOfPlan(plan),
      dto.cardId !== undefined,
    );
    const row = await this.createRow({
      boardId,
      userId,
      principal,
      agentSessionId: principal.agentSessionId ?? null,
      kind: requirement.kind,
      actionType: requirement.action,
      summary: summarizePlan(plan, requirement.action),
      risk: riskOfPlan(plan),
      plan,
      cardId,
      ttlMinutes: dto.ttlMinutes,
      policy,
    });
    return this.toDto({ row, includePlan: true });
  }

  /** `GET /boards/:id/approvals`. */
  async list(
    boardId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
    filters: {
      status?: string;
      kind?: string;
      cardId?: string;
      limit?: number;
    },
  ): Promise<ApprovalRequestDto[]> {
    await this.expireOverdue(boardId);
    const admin = role === "ADMIN";
    if (!admin && principal?.via !== "pat") {
      throw this.boardAdminOnly();
    }
    const rows = await this.prisma.approvalRequest.findMany({
      where: {
        boardId,
        ...(admin ? {} : { requestedByTokenId: principal?.apiTokenId ?? "" }),
        ...(filters.status !== undefined
          ? { status: filters.status as ApprovalStatus }
          : {}),
        ...(filters.kind !== undefined
          ? { kind: filters.kind as ApprovalKind }
          : {}),
        ...(filters.cardId !== undefined ? { cardId: filters.cardId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit ?? 50,
    });
    return rows.map((row) => this.toDto({ row, includePlan: false }));
  }

  /** `GET /boards/:id/approvals/:approvalId`. */
  async get(
    boardId: string,
    approvalId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
  ): Promise<ApprovalRequestDto> {
    await this.expireOverdue(boardId);
    const row = await this.load(boardId, approvalId);
    const admin = role === "ADMIN";
    const owner =
      principal?.via === "pat" &&
      principal.apiTokenId !== undefined &&
      principal.apiTokenId === row.requestedByTokenId;
    if (!admin && !owner) {
      throw this.ownerMismatch(row);
    }
    return this.toDto({ row, includePlan: true });
  }

  /**
   * `POST /boards/:id/approvals/:approvalId/decision` — session-only board
   * ADMIN. The controller's guards enforce both; this method still checks the
   * role so a misplaced route cannot leak a decision.
   */
  async decide(
    boardId: string,
    approvalId: string,
    userId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
    dto: ApprovalDecisionDto,
  ): Promise<ApprovalRequestDto> {
    if (role !== "ADMIN" || principal?.via !== "jwt") {
      throw this.boardAdminOnly();
    }
    let row = await this.load(boardId, approvalId);
    row = await this.expireOne(row);
    if (row.status === "expired") throw this.expired(row);
    this.assertHash(row, dto.planHash);

    if (row.status === "approved") {
      if (dto.decision === "approve") {
        return this.toDto({ row, includePlan: true });
      }
      throw this.notPending(row);
    }
    if (row.status !== "pending") throw this.notPending(row);

    const now = new Date();
    const status = dto.decision === "approve" ? "approved" : "rejected";
    const changed = await this.prisma.approvalRequest.updateMany({
      where: { id: row.id, status: "pending", expiresAt: { gt: now } },
      data: {
        status,
        decidedBy: userId,
        decidedAt: now,
        ...(dto.comment !== undefined ? { decisionComment: dto.comment } : {}),
      },
    });
    if (changed.count === 0) {
      const fresh = await this.load(boardId, approvalId);
      if (fresh.status === "approved" && dto.decision === "approve") {
        return this.toDto({ row: fresh, includePlan: true });
      }
      if (fresh.status === "expired") throw this.expired(fresh);
      throw this.notPending(fresh);
    }

    const updated: ApprovalRequest = {
      ...row,
      status,
      decidedBy: userId,
      decidedAt: now,
      decisionComment: dto.comment ?? row.decisionComment,
    };
    await this.activity(
      updated,
      dto.decision === "approve" ? "approval_approved" : "approval_rejected",
      userId,
      principal,
      {
        decision: dto.decision,
        comment: dto.comment ?? null,
      },
    );
    await this.securityAudit.record({
      userId: row.requestedBy,
      actorId: userId,
      actorType: "human",
      action: "approval.decided",
      targetType: "approval",
      targetId: row.id,
      details: {
        boardId,
        decision: dto.decision,
        status,
        planHash: row.planHash,
        risk: row.risk,
      },
    });
    await this.attention.notifyApprovalDecided(
      updated,
      dto.decision,
      dto.comment ?? null,
    );
    this.publish(updated);
    return this.toDto({ row: updated, includePlan: true });
  }

  /** `POST /boards/:id/approvals/:approvalId/cancel`. */
  async cancel(
    boardId: string,
    approvalId: string,
    userId: string,
    role: Role,
    principal: AuthPrincipal | undefined,
  ): Promise<ApprovalRequestDto> {
    let row = await this.load(boardId, approvalId);
    row = await this.expireOne(row);
    if (row.status === "expired") throw this.expired(row);

    const byToken =
      principal?.via === "pat" &&
      principal.apiTokenId === row.requestedByTokenId &&
      userId === row.requestedBy;
    const byAdmin = principal?.via === "jwt" && role === "ADMIN";
    if (!byToken && !byAdmin) throw this.ownerMismatch(row);
    if (row.status !== "pending") throw this.notPending(row);

    const now = new Date();
    const changed = await this.prisma.approvalRequest.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "cancelled", decidedAt: now },
    });
    if (changed.count === 0) {
      const fresh = await this.load(boardId, approvalId);
      if (fresh.status === "expired") throw this.expired(fresh);
      throw this.notPending(fresh);
    }
    const updated: ApprovalRequest = {
      ...row,
      status: "cancelled",
      decidedAt: now,
    };
    await this.activity(updated, "approval_cancelled", userId, principal, {
      by: byToken ? "requester" : "admin",
    });
    this.publish(updated);
    return this.toDto({ row: updated, includePlan: true });
  }

  /**
   * Called by the command transport before applying a batch: if policy
   * requires approval and the caller sent no `X-Approval-Id`, create the
   * request for this exact plan and refuse with `409 approval_required`.
   */
  async ensureCommandApproval(params: {
    boardId: string;
    userId: string;
    role: Role;
    principal: AuthPrincipal | undefined;
    agentSessionId: string | null;
    plan: ApprovalPlan;
    requirement: PlanRequirement;
    policy: BoardAgentPolicy;
    prepared: PreparedCommand[];
  }): Promise<void> {
    const { boardId, principal, plan, requirement, policy } = params;
    if (principal?.via !== "pat") return;
    const actual = effectiveTokenScope(principal);
    if (
      SCOPE_RANK[actual] < SCOPE_RANK[requirement.requiredScope] ||
      (requirement.requiredScope === "admin" && params.role !== "ADMIN")
    ) {
      throw new ForbiddenException({
        message:
          `This API token's scope does not allow ${requirement.action} ` +
          `(requires ${requirement.requiredScope}, token is ${actual})`,
        code: "scope_denied",
        requiredScope: requirement.requiredScope,
        effectiveTokenScope: actual,
        action: requirement.action,
        retryable: false,
      });
    }
    if (policy.destructive === "deny" && requirement.kind === "destructive") {
      throw new ForbiddenException({
        message: `This board's policy blocks destructive actions (${requirement.action})`,
        code: "destructive_denied",
        action: requirement.action,
        reason: "board_policy",
        retryable: false,
      });
    }
    if (!requirement.requiresApproval) return;

    // A board policy may cap the plan even when the caller reaches this path
    // automatically (without an explicit `POST /approvals`).
    await this.assertPlanLimitsForUser(plan, policy, params.userId, boardId);
    await this.expireOverdue(boardId);

    const existing = await this.findByIdempotentPlan(
      boardId,
      principal.apiTokenId ?? "",
      plan,
    );
    if (existing !== null) {
      if (existing.status === "consumed") {
        if (await this.consumedPlanApplied(existing, params.prepared)) return;
        throw this.consumed(existing);
      }
      if (existing.status === "pending" || existing.status === "approved") {
        throw this.approvalRequired(existing);
      }
    }
    const row = await this.createRow({
      boardId,
      userId: params.userId,
      principal,
      agentSessionId: params.agentSessionId,
      kind: requirement.kind,
      actionType: requirement.action,
      summary: summarizePlan(plan, requirement.action),
      risk: riskOfPlan(plan),
      plan,
      cardId: cardIdOfPlan(plan),
      policy,
    });
    throw this.approvalRequired(row);
  }

  /**
   * Validate an `X-Approval-Id` inside the caller's board transaction. A
   * consumed approval whose commands are all present is an idempotent replay.
   */
  async authorizeCommandApply(
    tx: Prisma.TransactionClient,
    params: {
      boardId: string;
      approvalId: string;
      plan: ApprovalPlan;
      planHash: string;
      requirement: PlanRequirement;
      principal: AuthPrincipal | undefined;
      agentSessionId: string | null;
    },
  ): Promise<{ row: ApprovalRequest; replay: boolean }> {
    const { principal } = params;
    if (principal?.via !== "pat" || principal.apiTokenId === undefined) {
      throw new ForbiddenException({
        message: "An approval can only be consumed by the requesting API token",
        code: "approval_owner_mismatch",
        approvalId: params.approvalId,
        requestedByTokenId: null,
        retryable: false,
      });
    }
    let row = await tx.approvalRequest.findFirst({
      where: { id: params.approvalId, boardId: params.boardId },
    });
    if (row === null) throw this.approvalNotFound(params.approvalId);
    if (row.requestedByTokenId !== principal.apiTokenId) {
      throw this.ownerMismatch(row);
    }
    if (
      row.agentSessionId !== null &&
      row.agentSessionId !== params.agentSessionId
    ) {
      throw this.ownerMismatch(row);
    }
    this.assertHash(row, params.planHash);

    if (
      (row.status === "pending" || row.status === "approved") &&
      row.expiresAt.getTime() <= Date.now()
    ) {
      // The apply transaction is about to roll back its 409; the lazy
      // expired transition must survive it, so it uses its own connection.
      row = await this.expireOne(row);
      throw this.expired(row);
    }

    switch (row.status) {
      case "consumed": {
        if (await this.consumedPlanApplied(row, undefined, tx)) {
          return { row, replay: true };
        }
        throw this.consumed(row);
      }
      case "approved": {
        // An approval authorizes only work policy still gates. A `custom`
        // approval is an explicit human decision for a non-destructive plan,
        // so it may authorize a plan the policy does not automatically gate;
        // it can never authorize a destructive plan.
        const customOverride =
          row.kind === "custom" && params.requirement.kind !== "destructive";
        if (
          (row.kind !== params.requirement.kind && !customOverride) ||
          (!params.requirement.requiresApproval && row.kind !== "custom")
        ) {
          throw this.mismatch(row, params.planHash);
        }
        return { row, replay: false };
      }
      case "pending":
        throw this.notPending(row);
      case "rejected":
        throw this.rejected(row);
      case "cancelled":
        throw this.cancelled(row);
      case "expired":
        throw this.expired(row);
      default:
        throw this.notPending(row);
    }
  }

  /** Mark an approved command approval consumed in the apply transaction. */
  async consumeCommandApproval(
    tx: Prisma.TransactionClient,
    row: ApprovalRequest,
    runId: string,
    actorId: string,
    principal: AuthPrincipal | undefined,
  ): Promise<ApprovalRequest> {
    const consumedAt = new Date();
    const changed = await tx.approvalRequest.updateMany({
      where: { id: row.id, status: "approved" },
      data: { status: "consumed", runId, consumedAt },
    });
    if (changed.count === 0) throw this.consumed(row);
    const updated: ApprovalRequest = {
      ...row,
      status: "consumed",
      runId,
      consumedAt,
    };
    await tx.activity.create({
      data: {
        boardId: row.boardId,
        cardId: row.cardId,
        type: "approval_consumed",
        actorId,
        actorType: "agent",
        apiTokenId: principal?.apiTokenId ?? row.requestedByTokenId,
        agentSessionId: row.agentSessionId,
        runId,
        agentName: principal?.apiTokenName ?? null,
        details: {
          approvalId: row.id,
          planHash: row.planHash,
          risk: row.risk,
          runId,
        },
      },
    });
    return updated;
  }

  /** Publish the consumed state after the apply transaction committed. */
  publishState(row: ApprovalRequest): void {
    this.publish(row);
  }

  /**
   * Lifecycle-operation gate (board.delete, member.*, share.*, attachment
   * delete). Returns the approval that authorizes this exact operation, or
   * null for a human/trusted caller. With no header it creates the request
   * and throws `409 approval_required`; with a header it validates ownership,
   * plan hash, status and expiry.
   */
  async authorizeOperation(params: {
    boardId: string;
    userId: string;
    role: Role;
    principal: AuthPrincipal | undefined;
    agentSessionId: string | null;
    op: ApprovalOperationName;
    target: Record<string, unknown>;
    body: Record<string, unknown>;
    approvalId?: string;
  }): Promise<ApprovalRequest | null> {
    const { principal, boardId, op } = params;
    if (principal?.via !== "pat") return null;
    const board = await this.board(boardId);
    const policy = readBoardAgentPolicy(board.agentPolicy);
    if (policy.destructive === "deny") {
      throw new ForbiddenException({
        message: `This board's policy blocks destructive actions (${op})`,
        code: "destructive_denied",
        action: op,
        reason: "board_policy",
        retryable: false,
      });
    }
    const rule = LIFECYCLE_ACTIONS[op];
    const actual = effectiveTokenScope(principal);
    if (
      SCOPE_RANK[actual] < SCOPE_RANK[rule.requiredScope] ||
      (rule.requiredScope === "admin" && params.role !== "ADMIN")
    ) {
      throw new ForbiddenException({
        message: `This API token's scope does not allow ${op}`,
        code: "scope_denied",
        requiredScope: rule.requiredScope,
        effectiveTokenScope: actual,
        action: op,
        retryable: false,
      });
    }
    if (principal.tokenIdentity?.trustedCi === true) return null;

    const plan = planFromOperation(boardId, op, params.target, params.body);
    const planHash = approvalPlanHash(plan);
    if (params.approvalId === undefined) {
      await this.expireOverdue(boardId);
      const existing = await this.findByIdempotentPlan(
        boardId,
        principal.apiTokenId ?? "",
        plan,
      );
      if (existing !== null && existing.status === "consumed") {
        throw this.consumed(existing);
      }
      const row =
        existing !== null &&
        (existing.status === "pending" || existing.status === "approved")
          ? existing
          : await this.createRow({
              boardId,
              userId: params.userId,
              principal,
              agentSessionId: params.agentSessionId,
              kind: "destructive",
              actionType: op,
              summary: summarizePlan(plan, op),
              risk: riskOfPlan(plan),
              plan,
              cardId: null,
              policy,
            });
      throw this.approvalRequired(row);
    }

    let row = await this.load(boardId, params.approvalId);
    row = await this.expireOne(row);
    if (row.status === "expired") throw this.expired(row);
    if (row.requestedByTokenId !== principal.apiTokenId) {
      throw this.ownerMismatch(row);
    }
    if (
      row.agentSessionId !== null &&
      row.agentSessionId !== params.agentSessionId
    ) {
      throw this.ownerMismatch(row);
    }
    this.assertHash(row, planHash);
    if (row.kind !== "destructive") throw this.mismatch(row, planHash);
    if (row.status === "consumed") throw this.consumed(row);
    if (row.status !== "approved") throw this.notPending(row);
    // Reserve the approval before the lifecycle operation runs. Two
    // concurrent requests with the same approvalId race on this conditional
    // update; exactly one wins. A crash after the claim loses the operation
    // rather than duplicating it (the approval is one-time).
    return this.claimOperation(row);
  }

  /**
   * Atomically reserve an approved lifecycle approval. The operation itself
   * runs outside this method; `consumeOperation` records the result.
   */
  private async claimOperation(row: ApprovalRequest): Promise<ApprovalRequest> {
    const consumedAt = new Date();
    const changed = await this.prisma.approvalRequest.updateMany({
      where: {
        id: row.id,
        status: "approved",
        expiresAt: { gt: consumedAt },
      },
      data: { status: "consumed", consumedAt },
    });
    if (changed.count === 0) {
      const fresh = await this.load(row.boardId, row.id);
      if (fresh.expiresAt.getTime() <= Date.now()) throw this.expired(fresh);
      throw this.consumed(fresh);
    }
    return { ...row, status: "consumed", consumedAt };
  }

  /** Record a claimed lifecycle approval after its endpoint succeeded. */
  async consumeOperation(
    row: ApprovalRequest,
    actorId: string,
    principal: AuthPrincipal | undefined,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.activity(row, "approval_consumed", actorId, principal, {
      ...details,
      planHash: row.planHash,
      risk: row.risk,
    });
    this.publish(row);
  }

  /** Release a claimed lifecycle approval when the operation failed. */
  async releaseOperation(row: ApprovalRequest): Promise<void> {
    await this.prisma.approvalRequest.updateMany({
      where: {
        id: row.id,
        status: "consumed",
        consumedAt: row.consumedAt,
        runId: null,
      },
      data: { status: "approved", consumedAt: null },
    });
  }

  /** Lazily mark overdue rows expired and publish one activity per row. */
  async expireOverdue(boardId: string): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.approvalRequest.findMany({
      where: {
        boardId,
        status: { in: ["pending", "approved"] },
        expiresAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      await this.expireOne(row, now);
    }
  }

  private async expireOne(
    row: ApprovalRequest,
    now: Date = new Date(),
  ): Promise<ApprovalRequest> {
    if (
      (row.status !== "pending" && row.status !== "approved") ||
      row.expiresAt.getTime() > now.getTime()
    ) {
      return row;
    }
    const changed = await this.prisma.approvalRequest.updateMany({
      where: { id: row.id, status: { in: ["pending", "approved"] } },
      data: { status: "expired" },
    });
    if (changed.count === 0) {
      return this.load(row.boardId, row.id);
    }
    const updated: ApprovalRequest = { ...row, status: "expired" };
    await this.activity(
      updated,
      "approval_expired",
      row.requestedBy,
      undefined,
      {
        expiresAt: row.expiresAt.getTime(),
      },
    );
    await this.attention.notifyApprovalExpired(updated);
    this.publish(updated);
    return updated;
  }

  private async createRow(params: {
    boardId: string;
    userId: string;
    principal: AuthPrincipal;
    agentSessionId: string | null;
    kind: ApprovalKind;
    actionType: string;
    summary: string;
    risk: "low" | "medium" | "high";
    plan: ApprovalPlan;
    cardId: string | null;
    ttlMinutes?: number;
    policy: BoardAgentPolicy;
  }): Promise<ApprovalRequest> {
    const ttl = effectiveTtlMinutes(params.ttlMinutes, params.policy);
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    const planHash = approvalPlanHash(params.plan);
    const row = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent create/auto-409 requests for the same token and
      // plan. Without this, two `find -> create` races could leave two
      // pending approvals for one plan. Re-check inside the lock.
      const lockKey = `${params.boardId}:${params.principal.apiTokenId}:${planHash}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const existing = await tx.approvalRequest.findFirst({
        where: {
          boardId: params.boardId,
          requestedByTokenId: params.principal.apiTokenId!,
          planHash,
          status: { in: ["pending", "approved"] },
        },
        orderBy: { createdAt: "asc" },
      });
      if (existing !== null) return existing;

      const created = await tx.approvalRequest.create({
        data: {
          boardId: params.boardId,
          cardId: params.cardId,
          requestedBy: params.userId,
          requestedByTokenId: params.principal.apiTokenId!,
          agentSessionId: params.agentSessionId,
          kind: params.kind,
          actionType: params.actionType,
          summary: params.summary,
          risk: params.risk,
          plan: params.plan as unknown as Prisma.InputJsonValue,
          planHash: approvalPlanHash(params.plan),
          status: "pending",
          expiresAt,
        },
      });
      await tx.activity.create({
        data: {
          boardId: created.boardId,
          cardId: created.cardId,
          type: "approval_requested",
          actorId: params.userId,
          actorType: "agent",
          apiTokenId: params.principal.apiTokenId ?? null,
          agentSessionId: params.agentSessionId,
          agentName: params.principal.apiTokenName ?? null,
          details: {
            approvalId: created.id,
            kind: created.kind,
            actionType: created.actionType,
            summary: created.summary,
            risk: created.risk,
            planHash: created.planHash,
            expiresAt: created.expiresAt.getTime(),
          },
        },
      });
      return created;
    });
    this.publish(row);
    await this.attention.notifyApprovalRequested(row);
    return row;
  }

  /**
   * A card id is display context for the approval queue, not part of the
   * hash. An explicit id must belong to this board; an inferred one is kept
   * only when it resolves, so a plan that deletes a nonexistent card still
   * produces a clean request instead of an FK error.
   */
  private async resolveCardId(
    boardId: string,
    cardId: string | null,
    explicit: boolean,
  ): Promise<string | null> {
    if (cardId === null) return null;
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, column: { boardId }, deletedAt: null },
      select: { id: true },
    });
    if (card === null) {
      if (!explicit) return null;
      throw new NotFoundException({
        message: "Card not found on this board",
        code: "not_found",
        resource: "card",
        retryable: false,
      });
    }
    return card.id;
  }

  private async findByIdempotentPlan(
    boardId: string,
    tokenId: string,
    plan: ApprovalPlan,
  ): Promise<ApprovalRequest | null> {
    const planHash = approvalPlanHash(plan);
    const rows = await this.prisma.approvalRequest.findMany({
      where: {
        boardId,
        requestedByTokenId: tokenId,
        planHash,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    // A live request wins even when a newer decision (reject/cancel) exists:
    // it still authorizes this exact plan. Otherwise the newest row carries
    // the state an idempotent retry should report.
    return (
      rows.find(
        (row) => row.status === "pending" || row.status === "approved",
      ) ??
      rows[0] ??
      null
    );
  }

  /** True when a consumed command plan's commands are all already applied. */
  private async consumedPlanApplied(
    row: ApprovalRequest,
    prepared?: PreparedCommand[],
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (row.runId === null) return false;
    const plan = row.plan as unknown as ApprovalPlan;
    const commands = plan.commands;
    if (commands === undefined || commands.length === 0) return false;
    const client = tx ?? this.prisma;
    const rows = await client.command.findMany({
      where: {
        id: { in: commands.map((command) => command.commandId) },
        boardId: row.boardId,
      },
      select: { id: true, payload: true, runId: true },
    });
    if (rows.length !== commands.length) return false;
    const byId = new Map(rows.map((command) => [command.id, command]));
    const expectedById = new Map(
      (prepared ?? []).map((command) => [command.dto.commandId, command]),
    );
    for (const command of commands) {
      const stored = byId.get(command.commandId);
      if (
        stored === undefined ||
        stored.runId !== row.runId ||
        planActionFingerprint(stored.payload) !==
          planActionFingerprint(command.action)
      ) {
        return false;
      }
      const live = expectedById.get(command.commandId);
      if (
        live !== undefined &&
        planActionFingerprint(live.action) !==
          planActionFingerprint(command.action)
      ) {
        return false;
      }
    }
    return true;
  }

  private async activity(
    row: ApprovalRequest,
    type: string,
    actorId: string,
    principal: AuthPrincipal | undefined,
    details: Record<string, unknown>,
  ): Promise<void> {
    let id: string | null = null;
    try {
      const activity = await this.prisma.activity.create({
        data: {
          boardId: row.boardId,
          cardId: row.cardId,
          type,
          actorId,
          actorType: principal?.via === "pat" ? "agent" : "human",
          apiTokenId:
            principal?.via === "pat" ? (principal.apiTokenId ?? null) : null,
          agentSessionId: principal?.via === "pat" ? row.agentSessionId : null,
          runId: row.runId,
          agentName:
            principal?.via === "pat" ? (principal.apiTokenName ?? null) : null,
          details: {
            approvalId: row.id,
            planHash: row.planHash,
            risk: row.risk,
            kind: row.kind,
            status: row.status,
            ...details,
          } as Prisma.InputJsonValue,
        },
      });
      id = activity.id;
    } catch {
      // A notification/audit row must never turn a completed decision into
      // a 500, exactly like `SecurityAuditService.record`.
      return;
    }
    this.realtime.publish(row.boardId, {
      type: "activity",
      id: id ?? row.id,
      boardId: row.boardId,
      ...(row.cardId !== null ? { cardId: row.cardId } : {}),
      actorId,
      actorType: principal?.via === "pat" ? "agent" : "human",
      at: Date.now(),
      kind: type,
      ...(row.cardId !== null ? { detail: row.cardId } : {}),
    });
  }

  private publish(row: ApprovalRequest): void {
    this.realtime.publish(row.boardId, {
      type: "approval",
      approvalId: row.id,
      status: row.status as ApprovalStatus,
      ...(row.cardId !== null ? { cardId: row.cardId } : {}),
      at: Date.now(),
    });
  }

  private async load(
    boardId: string,
    approvalId: string,
  ): Promise<ApprovalRequest> {
    const row = await this.prisma.approvalRequest.findFirst({
      where: { id: approvalId, boardId },
    });
    if (row === null) throw this.approvalNotFound(approvalId);
    return row;
  }

  private async board(boardId: string): Promise<{
    id: string;
    agentPolicy: Prisma.JsonValue | null;
  }> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { id: true, agentPolicy: true },
    });
    if (board === null) throw this.boardNotFound();
    return board;
  }

  /**
   * Enforce the run limits and record one attention event when a plan is
   * refused. The original `409 limit_exceeded` is always rethrown; the
   * notification is best-effort and never masks the validation error.
   */
  async assertPlanLimitsForUser(
    plan: ApprovalPlan,
    policy: BoardAgentPolicy,
    userId: string,
    boardId: string,
  ): Promise<void> {
    try {
      this.assertPlanLimits(plan, policy);
    } catch (error) {
      await this.attention.notifyLimitExceeded(userId, error, {
        boardId,
        resource: "plan",
      });
      throw error;
    }
  }

  /**
   * Enforce the board's run limits on every plan path, including the
   * automatic 409 seam. `DUPLICATE_CARD` and `DUPLICATE_COLUMN` also create
   * cards; the latter may create a whole copied column, so it is counted as
   * at least one card here and the apply transaction still enforces the
   * per-column hard cap.
   */
  assertPlanLimits(plan: ApprovalPlan, policy: BoardAgentPolicy): void {
    const commands = plan.commands;
    if (commands !== undefined) {
      const maxCommands = Math.min(100, policy.maxCommandsPerRun);
      if (commands.length > maxCommands) {
        throw new ConflictException({
          message: `Plan has ${commands.length} commands; this board allows ${maxCommands}`,
          code: "limit_exceeded",
          limit: maxCommands,
          current: commands.length,
          retryable: false,
        });
      }
      const creates = commands.filter((command) =>
        ["ADD_CARD", "DUPLICATE_CARD", "DUPLICATE_COLUMN"].includes(
          command.action.type,
        ),
      ).length;
      const maxCards = Math.min(50, policy.maxCardsPerRun);
      if (creates > maxCards) {
        throw new ConflictException({
          message: `Plan creates ${creates} cards; this board allows ${maxCards}`,
          code: "limit_exceeded",
          limit: maxCards,
          current: creates,
          retryable: false,
        });
      }
    }
  }

  private assertScope(
    principal: AuthPrincipal,
    role: Role,
    requirement: PlanRequirement,
  ): void {
    const actual = effectiveTokenScope(principal);
    if (SCOPE_RANK[actual] < SCOPE_RANK[requirement.requiredScope]) {
      throw new ForbiddenException({
        message:
          `This API token's scope does not allow ${requirement.action} ` +
          `(requires ${requirement.requiredScope}, token is ${actual})`,
        code: "scope_denied",
        requiredScope: requirement.requiredScope,
        effectiveTokenScope: actual,
        action: requirement.action,
        retryable: false,
      });
    }
    if (requirement.requiredScope === "admin" && role !== "ADMIN") {
      throw new ForbiddenException({
        message: `Board administration requires a board ADMIN role`,
        code: "scope_denied",
        requiredScope: "admin",
        effectiveTokenScope: actual,
        action: requirement.action,
        retryable: false,
      });
    }
  }

  private assertKind(kind: ApprovalKind, requirement: PlanRequirement): void {
    if (kind === requirement.kind) return;
    throw new ConflictException({
      message: `Approval kind ${kind} does not match this plan (expected ${requirement.kind})`,
      code: "approval_mismatch",
      expectedKind: requirement.kind,
      actualKind: kind,
      retryable: false,
    });
  }

  private assertPolicyAllows(
    requirement: PlanRequirement,
    policy: BoardAgentPolicy,
  ): void {
    if (requirement.kind === "destructive" && policy.destructive === "deny") {
      throw new ForbiddenException({
        message: `This board's policy blocks destructive actions (${requirement.action})`,
        code: "destructive_denied",
        action: requirement.action,
        reason: "board_policy",
        retryable: false,
      });
    }
  }

  private assertHash(row: ApprovalRequest, actualHash: string): void {
    if (row.planHash === actualHash) return;
    throw this.mismatch(row, actualHash);
  }

  private toDto(view: ApprovalView): ApprovalRequestDto {
    const row = view.row;
    return {
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
      status: row.status as ApprovalStatus,
      expiresAt: row.expiresAt.getTime(),
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt?.getTime() ?? null,
      decisionComment: row.decisionComment,
      runId: row.runId,
      consumedAt: row.consumedAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      ...(view.includePlan
        ? { plan: row.plan as unknown as ApprovalPlan }
        : {}),
    };
  }

  private requirePat(
    principal: AuthPrincipal | undefined,
    endpoint: string,
  ): asserts principal is AuthPrincipal & { apiTokenId: string } {
    if (principal?.via !== "pat" || principal.apiTokenId === undefined) {
      throw new ForbiddenException({
        message:
          "Approvals are created by a personal API token; a browser session cannot create one",
        code: "pat_required",
        endpoint,
        retryable: false,
      });
    }
  }

  private approvalRequired(row: ApprovalRequest): ConflictException {
    return new ConflictException({
      message:
        "This action needs human approval; the request was created and nothing was applied",
      code: "approval_required",
      approvalId: row.id,
      planHash: row.planHash,
      expiresAt: row.expiresAt.getTime(),
      action: row.actionType,
      retryable: false,
    });
  }

  private approvalNotFound(approvalId: string): NotFoundException {
    return new NotFoundException({
      message: "Approval not found",
      code: "not_found",
      resource: "approval",
      approvalId,
      retryable: false,
    });
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
      message: "Only a board ADMIN can do that",
      code: "scope_denied",
      requiredRoles: ["ADMIN"],
      retryable: false,
    });
  }

  private ownerMismatch(row: ApprovalRequest): ForbiddenException {
    return new ForbiddenException({
      message: "This approval belongs to another API token or agent session",
      code: "approval_owner_mismatch",
      approvalId: row.id,
      requestedByTokenId: row.requestedByTokenId,
      retryable: false,
    });
  }

  private mismatch(
    row: ApprovalRequest,
    actualHash: string,
  ): ConflictException {
    return new ConflictException({
      message: "The plan does not match the approved planHash",
      code: "approval_mismatch",
      approvalId: row.id,
      expectedPlanHash: row.planHash.slice(0, 12),
      actualPlanHash: actualHash.slice(0, 12),
      retryable: false,
    });
  }

  private expired(row: ApprovalRequest): ConflictException {
    return new ConflictException({
      message: "The approval expired; create a new request",
      code: "approval_expired",
      approvalId: row.id,
      expiresAt: row.expiresAt.getTime(),
      retryable: false,
    });
  }

  private notPending(row: ApprovalRequest): ConflictException {
    return new ConflictException({
      message: `Approval is ${row.status}, not pending`,
      code: "approval_not_pending",
      approvalId: row.id,
      status: row.status,
      retryable: false,
    });
  }

  private rejected(row: ApprovalRequest): ConflictException {
    return new ConflictException({
      message: "The approval was rejected",
      code: "approval_rejected",
      approvalId: row.id,
      decidedAt: row.decidedAt?.getTime() ?? null,
      retryable: false,
    });
  }

  private cancelled(row: ApprovalRequest): ConflictException {
    return new ConflictException({
      message: "The approval was cancelled",
      code: "approval_cancelled",
      approvalId: row.id,
      retryable: false,
    });
  }

  private consumed(row: ApprovalRequest): ConflictException {
    return new ConflictException({
      message: "The approval was already applied",
      code: "approval_consumed",
      approvalId: row.id,
      runId: row.runId,
      retryable: false,
    });
  }
}

/** `min(request ?? policy, policy)`, floored at five minutes (ADR §10.2). */
export function effectiveTtlMinutes(
  requested: number | undefined,
  policy: BoardAgentPolicy,
): number {
  const value = requested ?? policy.approvalTtlMinutes;
  return Math.min(
    Math.max(value, APPROVAL_TTL_FLOOR_MINUTES),
    policy.approvalTtlMinutes,
  );
}
