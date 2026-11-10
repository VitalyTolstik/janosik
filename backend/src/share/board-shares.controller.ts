import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { AgentAction, TokenScope } from "@/auth/token-scope.decorator";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import {
  hashIdempotentRequest,
  idempotencyActorKey,
  IdempotencyService,
  normalizeIdempotencyKey,
} from "@/common/idempotency.service";
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
@TokenScope("admin")
export class BoardSharesController {
  constructor(
    private readonly shares: ShareService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@Param("id") id: string): Promise<BoardShareDto[]> {
    return this.shares.listByBoard(id);
  }

  @Post()
  @AgentAction("share.create")
  async create(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @Body() dto: CreateShareDto,
    @Headers("idempotency-key") rawKey?: string,
  ): Promise<BoardShareDto> {
    const outcome = await this.idempotency.run({
      scope: "create_share",
      key: normalizeIdempotencyKey(rawKey),
      actorKey: idempotencyActorKey(user.id, principal),
      requestHash: hashIdempotentRequest({ boardId: id, ...dto }),
      run: async () => {
        const share = await this.shares.create(
          id,
          user.id,
          dto,
          "user",
          requestAttribution(principal, session?.id),
        );
        return { body: share, status: 201, resourceId: share.id };
      },
    });
    return outcome.body;
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
  @AgentAction("share.update")
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
  @AgentAction("share.revoke")
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
  @AgentAction("share.delete")
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
