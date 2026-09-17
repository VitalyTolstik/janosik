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
import { Role } from "@prisma/client";
import type { CommandDeltaEntry, CommandResponse } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { CommandsService } from "./commands.service";
import { CreateCommandDto } from "./dto/create-command.dto";
import { parseSince } from "./parse-since";

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
    @Body() dto: CreateCommandDto,
  ): Promise<CommandResponse> {
    return this.commands.apply(id, user.id, dto);
  }

  @UseGuards(MembershipGuard)
  @Get()
  list(
    @Param("id") id: string,
    @Query("since") since?: string,
  ): Promise<CommandDeltaEntry[]> {
    return this.commands.listSince(id, parseSince(since));
  }
}
