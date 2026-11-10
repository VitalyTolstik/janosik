import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { type BoardMember, Role } from "@prisma/client";
import type { PlanApplyResponse, PlanPreviewDto } from "@janosik/shared";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import { CurrentAgentSession, CurrentPrincipal } from "@/auth/auth-principal";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { TokenScope } from "@/auth/token-scope.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { CurrentMembership } from "@/common/current-membership.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { ApplyPlanDto, CreatePlanDto } from "./dto/create-plan.dto";
import { PlansService } from "./plans.service";

/**
 * TASK-166.8 plan transport (ADR §7.2):
 * - `POST /boards/:id/plans` is a dry-run: it validates and replays in memory,
 *   writes nothing and creates no run;
 * - `POST /boards/:id/plans/apply` is an atomic batch with a required
 *   `planHash`; an approved destructive plan is repeated with `X-Approval-Id`.
 *
 * Both routes are board writes, so a VIEWER and an observer-only PAT are
 * refused before the service runs.
 */
@Controller("boards/:id/plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @TokenScope("worker")
  @Post()
  @HttpCode(HttpStatus.OK)
  preview(
    @Param("id") boardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Body() dto: CreatePlanDto,
  ): Promise<PlanPreviewDto> {
    return this.plans.preview({
      boardId,
      actorId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      dto,
    });
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @TokenScope("worker")
  @Post("apply")
  @HttpCode(HttpStatus.OK)
  async apply(
    @Param("id") boardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: ApplyPlanDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<PlanApplyResponse> {
    const response = await this.plans.apply({
      boardId,
      actorId: user.id,
      role: membership.role,
      principal,
      agentSessionId: session?.id ?? null,
      ...(approvalId !== undefined ? { approvalId } : {}),
      dto,
    });
    // TASK-166.7/166.10: the request log and clients read the run id from the
    // same header the batch/command transports set.
    if (response.runId !== null && response.runId !== undefined) {
      res?.setHeader("X-Run-Id", response.runId);
    }
    return response;
  }
}
