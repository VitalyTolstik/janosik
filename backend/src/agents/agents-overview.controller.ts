import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { AgentsOverviewResponse } from "@janosik/shared";
import { SessionOnlyGuard } from "@/auth/auth-principal";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { AgentsOverviewService } from "./agents-overview.service";
import { AgentsOverviewQueryDto } from "./dto/agents-overview.dto";

/**
 * TASK-179.10 — the global `/agents` control room is a human surface.
 * `JwtAuthGuard` authenticates either principal; `SessionOnlyGuard` then
 * refuses every PAT with `403 pat_forbidden` before any board scope is read.
 * There is deliberately no PAT fan-out into this contract.
 */
@Controller("agents")
@UseGuards(JwtAuthGuard, SessionOnlyGuard)
export class AgentsOverviewController {
  constructor(private readonly overview: AgentsOverviewService) {}

  @Get("overview")
  getOverview(
    @CurrentUser() user: AuthUser,
    @Query() query: AgentsOverviewQueryDto,
  ): Promise<AgentsOverviewResponse> {
    return this.overview.overview(user.id, query);
  }
}
