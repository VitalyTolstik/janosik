import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import type { AgentStopAllPauseDto, BoardAgentPauseDto } from "@janosik/shared";
import { ApiTokenService } from "@/auth/api-token.service";
import { SessionOnlyGuard } from "@/auth/auth-principal";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { BoardRoles } from "@/common/board-roles.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { AgentSessionsService } from "./agent-sessions.service";
import { AgentPauseDto } from "./dto/agent-pause.dto";

/**
 * TASK-166.3 board-level pause: every PAT writing to the board stops, while
 * humans keep working. Session-only board ADMIN — an agent cannot clear the
 * pause that stopped it.
 */
@Controller("boards/:id/agents")
@UseGuards(MembershipGuard, SessionOnlyGuard)
@BoardRoles(Role.ADMIN)
export class BoardAgentsController {
  constructor(private readonly sessions: AgentSessionsService) {}

  @Post("pause")
  @HttpCode(HttpStatus.OK)
  pause(
    @Param("id") boardId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AgentPauseDto,
  ): Promise<BoardAgentPauseDto> {
    return this.sessions.pauseBoard(boardId, user.id, dto.reason);
  }

  @Post("resume")
  @HttpCode(HttpStatus.OK)
  resume(
    @Param("id") boardId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AgentPauseDto,
  ): Promise<BoardAgentPauseDto> {
    return this.sessions.resumeBoard(boardId, user.id, dto.reason);
  }
}

/**
 * TASK-166.3 "stop all": the owner stops every live personal API token at
 * once. `resume-all` clears only this bulk stamp; an individually paused
 * token stays paused until its own resume.
 */
@Controller("agents")
@UseGuards(JwtAuthGuard, SessionOnlyGuard)
export class AccountAgentsController {
  constructor(private readonly apiTokens: ApiTokenService) {}

  @Post("pause-all")
  @HttpCode(HttpStatus.OK)
  pauseAll(
    @CurrentUser() user: AuthUser,
    @Body() dto: AgentPauseDto,
  ): Promise<AgentStopAllPauseDto> {
    return this.apiTokens.pauseAll(user.id, dto.reason);
  }

  @Post("resume-all")
  @HttpCode(HttpStatus.OK)
  resumeAll(
    @CurrentUser() user: AuthUser,
    @Body() dto: AgentPauseDto,
  ): Promise<AgentStopAllPauseDto> {
    return this.apiTokens.resumeAll(user.id, dto.reason);
  }
}
