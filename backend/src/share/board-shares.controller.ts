import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import type { BoardShareDto } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import { CurrentAgentSession, CurrentPrincipal } from "@/auth/auth-principal";
import { requestAttribution } from "@/auth/request-attribution";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { CreateShareDto, UpdateShareDto } from "./dto/share.dto";
import { ShareService } from "./share.service";

/**
 * Owner-side share management (TASK-58, §7.9.4): a board ADMIN creates,
 * lists, refreshes, edits and revokes its own links. Nested under the board
 * so `MembershipGuard` resolves the board from `:id` and `@BoardRoles(ADMIN)`
 * gates every route — a mere member or viewer never manages shares.
 */
@Controller("boards/:id/shares")
@UseGuards(MembershipGuard)
@BoardRoles(Role.ADMIN)
export class BoardSharesController {
  constructor(private readonly shares: ShareService) {}

  @Get()
  list(@Param("id") id: string): Promise<BoardShareDto[]> {
    return this.shares.listByBoard(id);
  }

  @Post()
  create(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @Body() dto: CreateShareDto,
  ): Promise<BoardShareDto> {
    return this.shares.create(
      id,
      user.id,
      dto,
      "user",
      requestAttribution(principal, session?.id),
    );
  }

  @Post(":shareId/refresh")
  refresh(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
  ): Promise<BoardShareDto> {
    return this.shares
      .requireShareOnBoard(shareId, id)
      .then(() => this.shares.refreshSnapshot(shareId));
  }

  @Patch(":shareId")
  update(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
    @Body() dto: UpdateShareDto,
  ): Promise<BoardShareDto> {
    return this.shares
      .requireShareOnBoard(shareId, id)
      .then(() => this.shares.update(shareId, dto));
  }

  @Delete(":shareId")
  revoke(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
  ): Promise<BoardShareDto> {
    return this.shares
      .requireShareOnBoard(shareId, id)
      .then(() =>
        this.shares.revoke(
          shareId,
          user.id,
          requestAttribution(principal, session?.id),
        ),
      );
  }

  @Delete(":shareId/permanent")
  @HttpCode(204)
  async deleteRevoked(
    @Param("id") id: string,
    @Param("shareId") shareId: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
  ): Promise<void> {
    await this.shares.deleteRevoked(
      id,
      shareId,
      user.id,
      requestAttribution(principal, session?.id),
    );
  }
}
