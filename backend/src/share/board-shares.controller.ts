import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import type { BoardShareDto } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
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
    @Body() dto: CreateShareDto,
  ): Promise<BoardShareDto> {
    return this.shares.create(id, user.id, dto);
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
  ): Promise<BoardShareDto> {
    return this.shares
      .requireShareOnBoard(shareId, id)
      .then(() => this.shares.revoke(shareId));
  }
}
