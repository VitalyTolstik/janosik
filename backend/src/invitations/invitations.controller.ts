import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { BoardInvitationDto } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { actorTypeOf, CurrentPrincipal } from "@/auth/auth-principal";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { InvitationsService } from "./invitations.service";

/**
 * Invitation feed of the signed-in user (TASK-35 addendum). Plain JWT —
 * the invitee is by definition not a member yet, so the membership guard
 * does not apply here; ownership is enforced per row in the service.
 */
@Controller("invitations")
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<BoardInvitationDto[]> {
    return this.invitations.listForUser(user.id);
  }

  @Post(":id/accept")
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Param("id") id: string,
  ): Promise<void> {
    return this.invitations.accept(user.id, id, actorTypeOf(principal));
  }

  @Post(":id/decline")
  @HttpCode(200)
  decline(
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Param("id") id: string,
  ): Promise<void> {
    return this.invitations.decline(user.id, id, actorTypeOf(principal));
  }
}
