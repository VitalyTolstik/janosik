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
import { Role } from "@prisma/client";
import type { CommandDeltaEntry, CommandResponse } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { actorTypeOf, CurrentPrincipal } from "@/auth/auth-principal";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { CommandsService } from "./commands.service";
import { CreateCommandDto } from "./dto/create-command.dto";
import { parseSince } from "./parse-since";

/** Response header of a delta that must not be trusted (B-3). */
export const DELTA_RESYNC_HEADER = "X-Delta-Resync";

/**
 * Command transport (§7.4): `POST /boards/:id/commands` applies a reducer
 * action; `GET .../commands?since=` is the delta catch-up after an SSE gap.
 *
 * `MembershipGuard` resolves the board and enforces roles: mutations are
 * ADMIN/MEMBER only (VIEWER reads), while the delta feed is readable by any
 * member, VIEWER included.
 */
@Controller("boards/:id/commands")
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @Body() dto: CreateCommandDto,
  ): Promise<CommandResponse> {
    return this.commands.apply(id, user.id, dto, {
      actorType: actorTypeOf(principal),
    });
  }

  /**
   * The delta since `?since=`. B-3: when the gap cannot be replayed (the
   * page hit its cap, or the baseline was trimmed from the log) the answer
   * carries `X-Delta-Resync: 1` and an empty body — the client must re-read
   * the board (`GET /boards/:id` + `X-Board-Seq`) instead of applying a
   * partial history.
   */
  @UseGuards(MembershipGuard)
  @Get()
  async list(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Query("since") since?: string,
  ): Promise<CommandDeltaEntry[]> {
    const delta = await this.commands.deltaSince(id, parseSince(since));
    if (delta.resync) {
      res.setHeader(DELTA_RESYNC_HEADER, "1");
      return [];
    }
    return delta.entries;
  }
}
