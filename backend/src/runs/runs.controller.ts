import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { BoardMember } from "@prisma/client";
import type {
  RevertPreviewDto,
  RunDetailDto,
  RunSummaryDto,
} from "@janosik/shared";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { CurrentPrincipal } from "@/auth/auth-principal";
import { CurrentUser } from "@/auth/current-user.decorator";
import type { AuthUser } from "@/auth/auth.types";
import { TokenScope } from "@/auth/token-scope.decorator";
import { CurrentMembership } from "@/common/current-membership.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { RunsService } from "./runs.service";
import { RevertRunDto, RunListQueryDto } from "./dto/run.dto";

/**
 * TASK-166.7 run API (ADR §7.2):
 * - list/detail are board reads (observer+; pre-images are ADMIN only);
 * - a dry-run preview is a board read;
 * - applying a revert is browser-session board ADMIN only (D17). The route
 *   accepts any board member at the guard so a PAT receives the specific
 *   `pat_forbidden` from the service rather than a generic scope refusal.
 */
@Controller("boards/:id/runs")
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @UseGuards(MembershipGuard)
  @Get()
  list(
    @Param("id") boardId: string,
    @Query() query: RunListQueryDto,
  ): Promise<RunSummaryDto[]> {
    return this.runs.list(boardId, query);
  }

  @UseGuards(MembershipGuard)
  @Get(":runId")
  get(
    @Param("id") boardId: string,
    @Param("runId") runId: string,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
  ): Promise<RunDetailDto> {
    return this.runs.get(boardId, runId, membership.role, principal);
  }

  @UseGuards(MembershipGuard)
  @Post(":runId/revert/preview")
  @HttpCode(HttpStatus.OK)
  @TokenScope("observer")
  preview(
    @Param("id") boardId: string,
    @Param("runId") runId: string,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
  ): Promise<RevertPreviewDto> {
    return this.runs.preview(boardId, runId, membership.role, principal);
  }

  @UseGuards(MembershipGuard)
  @Post(":runId/revert")
  @HttpCode(HttpStatus.OK)
  @TokenScope("observer")
  async revert(
    @Param("id") boardId: string,
    @Param("runId") runId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
    @Body() dto: RevertRunDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RunDetailDto | RevertPreviewDto> {
    // ADR §11.4 spells the preview as `revert` + `{dryRun: true}`; the
    // dedicated `/preview` route above is the friendlier alias. A preview
    // writes nothing and carries no run header.
    if (dto.dryRun === true) {
      return this.runs.preview(boardId, runId, membership.role, principal);
    }
    const detail = await this.runs.revert(
      boardId,
      runId,
      user.id,
      membership.role,
      principal,
      dto,
    );
    // TASK-166.7/166.10: attribute the audit run, not the reverted original.
    res.setHeader("X-Run-Id", detail.run.id);
    return detail;
  }
}
