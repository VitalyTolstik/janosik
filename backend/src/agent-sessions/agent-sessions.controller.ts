import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { BoardMember } from "@prisma/client";
import type { AgentSessionDto } from "@janosik/shared";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { CurrentPrincipal } from "@/auth/auth-principal";
import type { AuthUser } from "@/auth/auth.types";
import { TokenScope } from "@/auth/token-scope.decorator";
import { CurrentUser } from "@/auth/current-user.decorator";
import { CurrentMembership } from "@/common/current-membership.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { AgentSessionsService } from "./agent-sessions.service";
import {
  AgentSessionHeartbeatDto,
  CreateAgentSessionDto,
  EndAgentSessionDto,
} from "./dto/agent-session.dto";

/**
 * Agent sessions (TASK-166.1): start/heartbeat/end for a PAT and read-only
 * list/detail for every board member. `MembershipGuard` resolves the board
 * and the optional `X-Agent-Session` header; the service enforces token
 * ownership. Pause/resume endpoints deliberately belong to 166.3.
 */
@Controller("boards/:id/agent-sessions")
@UseGuards(MembershipGuard)
@TokenScope("observer")
export class AgentSessionsController {
  constructor(private readonly sessions: AgentSessionsService) {}

  @Post()
  start(
    @Param("id") boardId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Body() dto: CreateAgentSessionDto,
  ): Promise<AgentSessionDto> {
    return this.sessions.start(boardId, user.id, principal, dto);
  }

  @Post(":sessionId/heartbeat")
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @Param("id") boardId: string,
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Body() dto: AgentSessionHeartbeatDto,
  ): Promise<AgentSessionDto> {
    return this.sessions.heartbeat(boardId, sessionId, user.id, principal, dto);
  }

  @Post(":sessionId/end")
  @HttpCode(HttpStatus.OK)
  end(
    @Param("id") boardId: string,
    @Param("sessionId") sessionId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentMembership() membership: BoardMember,
    @Body() dto: EndAgentSessionDto,
  ): Promise<AgentSessionDto> {
    return this.sessions.end(
      boardId,
      sessionId,
      user.id,
      principal,
      membership.role,
      dto,
    );
  }

  @Get()
  list(
    @Param("id") boardId: string,
    @Query("active") active?: string,
  ): Promise<AgentSessionDto[]> {
    return this.sessions.list(boardId, active === "1" || active === "true");
  }

  @Get(":sessionId")
  get(
    @Param("id") boardId: string,
    @Param("sessionId") sessionId: string,
  ): Promise<AgentSessionDto> {
    return this.sessions.get(boardId, sessionId);
  }
}
