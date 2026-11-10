import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Role } from "@prisma/client";
import type {
  ApprovalPlan,
  Board,
  PlanApplyResponse,
  PlanConflictCode,
  PlanConflictDto,
  PlanPreviewDto,
  PlanWarningDto,
} from "@janosik/shared";
import { boardReducer } from "@janosik/shared";
import { ApprovalsService } from "@/approvals/approvals.service";
import {
  approvalPlanHash,
  classifyPlan,
  normalizeApprovalPlan,
  planFromPreparedCommands,
  riskOfPlan,
  summarizePlan,
} from "@/approvals/approval-plan";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { actorTypeOf } from "@/auth/auth-principal";
import { requestAttribution } from "@/auth/request-attribution";
import {
  classifyCommandAction,
  effectiveTokenScope,
  evaluateAgentRule,
  readBoardAgentPolicy,
  SCOPE_RANK,
  type BoardAgentPolicy,
} from "@/auth/token-scope";
import { loadBoardAggregate } from "@/boards/board-aggregate";
import {
  actionFingerprint,
  prepareCommandDto,
  type PreparedCommand,
} from "@/commands/command-validation";
import { CommandsService } from "@/commands/commands.service";
import type { CreateCommandDto } from "@/commands/dto/create-command.dto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { boardsEqual, diffBoards } from "./plan-diff";
import type { ApplyPlanDto, CreatePlanDto } from "./dto/create-plan.dto";

/** A plan cannot exceed the transport's own sanity bound. */
const PLAN_COMMANDS_MAX = 1_000;

/** The effective per-plan caps from the board policy (ADR §7.4). */
function planLimits(policy: BoardAgentPolicy): {
  commands: number;
  cards: number;
} {
  return {
    commands: Math.min(100, policy.maxCommandsPerRun),
    cards: Math.min(50, policy.maxCardsPerRun),
  };
}

/** Count commands that create a card (`DUPLICATE_COLUMN` copies a column). */
function countCardCreates(plan: ApprovalPlan): number {
  return (plan.commands ?? []).filter((command) =>
    ["ADD_CARD", "DUPLICATE_CARD", "DUPLICATE_COLUMN"].includes(
      String(command.action.type),
    ),
  ).length;
}

/**
 * Map an apply-time guard exception onto a preview conflict. A preview is
 * advisory, so a guard the live transaction will enforce is reported instead
 * of aborting the whole plan; an unexpected error is rethrown so a product
 * bug is not hidden behind a friendly list.
 */
function planConflictOf(
  error: unknown,
  index?: number,
  commandId?: string,
): PlanConflictDto | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  const body =
    typeof response === "string"
      ? ({ message: response } as Record<string, unknown>)
      : (response as Record<string, unknown>);
  const conflict = body.conflict;
  const code = typeof body.code === "string" ? body.code : undefined;

  let mapped: PlanConflictCode | null = null;
  if (
    conflict === "version" ||
    conflict === "wip" ||
    conflict === "workflow" ||
    conflict === "id"
  ) {
    mapped = conflict;
  } else if (code === "destructive_denied") {
    mapped = "destructive_denied";
  } else if (error.getStatus() === 403) {
    mapped = "scope";
  } else {
    mapped = "invalid";
  }

  const message =
    typeof body.message === "string" ? body.message : error.message;
  return {
    ...(index !== undefined ? { index } : {}),
    ...(commandId !== undefined ? { commandId } : {}),
    code: mapped,
    message,
    ...(typeof body.currentVersion === "number"
      ? { currentVersion: body.currentVersion }
      : {}),
  };
}

interface PlanBuild {
  /** Canonical intent: no `at`, no action-level `boardId`. */
  plan: ApprovalPlan;
  /** The commands exactly as they are handed to the apply transport. */
  commands: CreateCommandDto[];
  prepared: PreparedCommand[];
}

interface PlanContext {
  board: Board;
  policy: BoardAgentPolicy;
}

/**
 * TASK-166.8 — plan preview and atomic apply (ADR §7.4).
 *
 * `POST /plans` is a pure dry-run: it validates through the same command
 * validator as `/commands/batch`, classifies the plan exactly like the
 * approval seam, replays the reducer in memory and returns the canonical
 * `planHash`, a net diff, warnings and conflicts. It writes no rows, creates
 * no `AgentRun` and creates no `ApprovalRequest`.
 *
 * `POST /plans/apply` requires the hash of the exact commands and then reuses
 * the batch transport: one board lock, one transaction, all-or-nothing,
 * approval consumption and the `kind: "plan"` run. There is deliberately no
 * cross-plan atomicity — a caller over the limit splits the work.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: CommandsService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** `POST /boards/:id/plans` — dry-run only. */
  async preview(params: {
    boardId: string;
    actorId: string;
    role: Role;
    principal: AuthPrincipal | undefined;
    agentSessionId: string | null;
    dto: CreatePlanDto;
  }): Promise<PlanPreviewDto> {
    const { boardId, actorId, role, principal, agentSessionId } = params;
    this.assertTransportSize(params.dto.commands.length);
    const context = await this.loadContext(boardId);
    const build = this.buildPlan(boardId, actorId, params.dto.commands);
    // A dry run must not write an attention event either: the pure limit
    // check is enough to answer `409 limit_exceeded`. Applying the plan (and
    // creating an approval) uses the notifying variant.
    this.approvals.assertPlanLimits(build.plan, context.policy);
    const requirement = classifyPlan(
      build.plan,
      context.board,
      context.policy,
      principal?.tokenIdentity?.trustedCi === true,
    );
    const simulation = await this.simulate({
      boardId,
      actorId,
      role,
      principal,
      agentSessionId,
      policy: context.policy,
      prepared: build.prepared,
      board: context.board,
    });
    const warnings = [...simulation.warnings];
    const conflicts = [...simulation.conflicts];
    this.addPlanLevelChecks({
      role,
      principal,
      policy: context.policy,
      requirement,
      conflicts,
      warnings,
    });

    return {
      dryRun: true,
      schemaVersion: 1,
      boardId,
      planHash: approvalPlanHash(build.plan),
      plan: build.plan,
      commandCount: build.prepared.length,
      cardCreates: countCardCreates(build.plan),
      limits: planLimits(context.policy),
      requirement: {
        kind: requirement.kind,
        // A human apply does not consume an approval; only an agent plan is
        // gated by the approval policy (ADR §7.2).
        requiresApproval:
          principal?.via === "pat" ? requirement.requiresApproval : false,
        requiredScope: requirement.requiredScope,
        action: requirement.action,
        risk: riskOfPlan(build.plan),
        summary: summarizePlan(build.plan, requirement.action),
      },
      diff: diffBoards(context.board, simulation.board),
      warnings,
      conflicts,
      canApply: conflicts.length === 0,
    };
  }

  /**
   * `POST /boards/:id/plans/apply` — atomic batch with a required plan hash.
   * A PAT gets one `kind: "plan"` run; a browser plan keeps its local undo
   * and creates no run (ADR §11.1).
   */
  async apply(params: {
    boardId: string;
    actorId: string;
    role: Role;
    principal: AuthPrincipal | undefined;
    agentSessionId: string | null;
    approvalId?: string;
    dto: ApplyPlanDto;
  }): Promise<PlanApplyResponse> {
    const { boardId, actorId, role, principal, agentSessionId } = params;
    this.assertTransportSize(params.dto.commands.length);
    const context = await this.loadContext(boardId);
    const build = this.buildPlan(boardId, actorId, params.dto.commands);
    const planHash = approvalPlanHash(build.plan);
    const supplied = params.dto.planHash.toLowerCase();
    if (supplied !== planHash) {
      throw new ConflictException({
        message:
          "The planHash does not match the submitted commands; re-run the preview",
        code: "approval_mismatch",
        ...(params.approvalId !== undefined
          ? { approvalId: params.approvalId }
          : {}),
        expectedPlanHash: planHash.slice(0, 12),
        actualPlanHash: supplied.slice(0, 12),
        retryable: false,
      });
    }
    // The approval path enforces the caps too, but a browser apply and a
    // plan that would be refused by policy must answer here first.
    await this.approvals.assertPlanLimitsForUser(
      build.plan,
      context.policy,
      actorId,
      boardId,
    );

    const run =
      principal?.via === "pat"
        ? {
            kind: "plan" as const,
            planHash,
            ...(params.dto.clientRunId !== undefined
              ? { clientRunId: params.dto.clientRunId }
              : {}),
          }
        : undefined;

    const applied = await this.commands.applyBatch(
      boardId,
      actorId,
      build.commands,
      {
        actorType: actorTypeOf(principal),
        actorRole: role,
        attribution: requestAttribution(principal, agentSessionId),
        principal,
        allowMissingAt: true,
        ...(run !== undefined ? { run } : {}),
        ...(params.approvalId !== undefined
          ? { approvalId: params.approvalId }
          : {}),
      },
    );
    return { runId: applied.runId, results: applied.results, planHash };
  }

  /**
   * The plan module caps the body before validation; the real per-board cap
   * is enforced by `assertPlanLimits` and answers `409 limit_exceeded`.
   */
  private assertTransportSize(count: number): void {
    if (count > PLAN_COMMANDS_MAX) {
      throw new BadRequestException({
        message: `A plan accepts at most ${PLAN_COMMANDS_MAX} commands per request`,
        field: "commands",
      });
    }
  }

  private async loadContext(boardId: string): Promise<PlanContext> {
    const row = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { agentPolicy: true },
    });
    if (row === null) throw new NotFoundException("Board not found");
    const board = await loadBoardAggregate(this.prisma, boardId);
    if (board === null) throw new NotFoundException("Board not found");
    return { board, policy: readBoardAgentPolicy(row.agentPolicy) };
  }

  /**
   * Normalize through the approval-plan validator (duplicate command ids,
   * `ifMatch`/`ifMatchVersions` shape, supported action, no `at` needed),
   * then prepare the exact DTOs the apply transport will see.
   */
  private buildPlan(
    boardId: string,
    actorId: string,
    raw: CreateCommandDto[],
  ): PlanBuild {
    const normalized = normalizeApprovalPlan(
      { schemaVersion: 1, boardId, commands: raw },
      boardId,
    );
    const commands: CreateCommandDto[] = (normalized.commands ?? []).map(
      (command) => ({
        commandId: command.commandId,
        action: { ...command.action },
        ...(command.ifMatch !== undefined ? { ifMatch: command.ifMatch } : {}),
        ...(command.ifMatchVersions !== undefined
          ? { ifMatchVersions: command.ifMatchVersions }
          : {}),
      }),
    );
    const prepared = commands.map((dto) => {
      const entry = prepareCommandDto(dto, { boardId, allowMissingAt: true });
      // ADR D23: the claim holder is the authenticated actor. The approval
      // seam applies the same normalization, so the preview hash matches the
      // plan a human is asked to approve.
      if (
        entry.action.type === "CLAIM_CARD" &&
        entry.action.claimedBy !== null
      ) {
        entry.action = { ...entry.action, claimedBy: actorId };
        entry.fingerprint = actionFingerprint(entry.action, boardId);
      }
      return entry;
    });
    return {
      plan: planFromPreparedCommands(boardId, prepared),
      commands,
      prepared,
    };
  }

  /**
   * Replay the reducer and the database-backed guards command by command.
   * The running aggregate is what the next command sees, matching the apply
   * transaction; failed guards become conflicts while the replay continues so
   * one preview lists every problem it can find.
   */
  private async simulate(params: {
    boardId: string;
    actorId: string;
    role: Role;
    principal: AuthPrincipal | undefined;
    agentSessionId: string | null;
    policy: BoardAgentPolicy;
    prepared: PreparedCommand[];
    board: Board;
  }): Promise<{
    board: Board;
    conflicts: PlanConflictDto[];
    warnings: PlanWarningDto[];
  }> {
    let running = params.board;
    const conflicts: PlanConflictDto[] = [];
    const warnings: PlanWarningDto[] = [];
    const attribution = requestAttribution(
      params.principal,
      params.agentSessionId,
    );
    const failed = new Set<number>();

    for (let index = 0; index < params.prepared.length; index += 1) {
      const entry = params.prepared[index]!;
      const commandId = entry.dto.commandId;
      const rule = classifyCommandAction(entry.action, running);
      if (rule.destructive) {
        warnings.push({
          index,
          commandId,
          code: "destructive",
          message: `${rule.action} is destructive`,
        });
      }
      // The apply transaction refuses a preset the plan needs, and a PAT may
      // never send `RESTORE_*`; surface it here instead of surprising the
      // agent at apply time.
      const evaluation = evaluateAgentRule(
        params.principal,
        params.policy,
        rule,
      );
      if (evaluation.outcome === "scope") {
        conflicts.push({
          index,
          commandId,
          code: "scope",
          message: `This API token's scope does not allow ${rule.action} (requires ${rule.requiredScope}, token is ${evaluation.actual})`,
        });
        failed.add(index);
      } else if (evaluation.outcome === "denied") {
        conflicts.push({
          index,
          commandId,
          code: "destructive_denied",
          message: `This board's policy blocks destructive actions (${rule.action})`,
        });
        failed.add(index);
      }
      try {
        await this.commands.assertWouldApply({
          boardId: params.boardId,
          actorId: params.actorId,
          actorRole: params.role,
          attribution,
          entry,
          board: running,
          versionOffset: index,
        });
      } catch (error) {
        const conflict = planConflictOf(error, index, commandId);
        if (conflict === null) throw error;
        conflicts.push(conflict);
        failed.add(index);
      }

      const next =
        boardReducer([running], entry.action, {
          withActivity: false,
        })[0] ?? running;
      if (!failed.has(index) && boardsEqual(running, next)) {
        warnings.push({
          index,
          commandId,
          code: "no_op",
          message: `${entry.action.type} changes nothing`,
        });
      }
      running = next;
    }

    try {
      await this.commands.assertPlanIds(params.boardId, params.prepared);
    } catch (error) {
      const conflict = planConflictOf(error);
      if (conflict === null) throw error;
      conflicts.push(conflict);
    }
    return { board: running, conflicts, warnings };
  }

  /** Scope, destructive policy and approval warnings for the whole plan. */
  private addPlanLevelChecks(params: {
    role: Role;
    principal: AuthPrincipal | undefined;
    policy: BoardAgentPolicy;
    requirement: ReturnType<typeof classifyPlan>;
    conflicts: PlanConflictDto[];
    warnings: PlanWarningDto[];
  }): void {
    const { principal, role, policy, requirement } = params;
    if (requirement.requiredScope === "reviewer") {
      params.warnings.push({
        code: "reviewer_required",
        message: "This plan needs a reviewer-scoped token or a human decision",
      });
    }
    if (principal?.via !== "pat") return;

    const actual = effectiveTokenScope(principal);
    const already = (code: PlanConflictCode): boolean =>
      params.conflicts.some((conflict) => conflict.code === code);
    if (SCOPE_RANK[actual] < SCOPE_RANK[requirement.requiredScope]) {
      if (!already("scope")) {
        params.conflicts.push({
          code: "scope",
          message:
            `This API token's scope does not allow ${requirement.action} ` +
            `(requires ${requirement.requiredScope}, token is ${actual})`,
        });
      }
    } else if (requirement.requiredScope === "admin" && role !== "ADMIN") {
      if (!already("scope")) {
        params.conflicts.push({
          code: "scope",
          message: "Board administration requires a board ADMIN role",
        });
      }
    }
    if (
      requirement.kind === "destructive" &&
      policy.destructive === "deny" &&
      !already("destructive_denied")
    ) {
      params.conflicts.push({
        code: "destructive_denied",
        message: `This board's policy blocks destructive actions (${requirement.action})`,
      });
    }
    if (requirement.requiresApproval) {
      params.warnings.push({
        code: "approval_required",
        message:
          "A human board ADMIN must approve this exact plan before it can be applied",
      });
    }
  }
}
