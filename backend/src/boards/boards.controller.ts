import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Role } from "@prisma/client";
import type {
  BoardAggregate,
  BoardEnvelope,
  BoardMemberDto,
  BoardSummary,
} from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import { BoardRoles } from "@/common/board-roles.decorator";
import { MembershipGuard } from "@/common/membership.guard";
import { BoardsService } from "./boards.service";
import { CreateBoardDto } from "./dto/create-board.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { UpdateMemberDto } from "./dto/update-member.dto";

/**
 * Boards + membership REST surface (§7.4).
 *
 * Content mutations (columns/cards/labels/checklists) are NOT here — they
 * travel through the command log in TASK-26. `MembershipGuard` resolves the
 * board from `:id`, checks membership/expiry and enforces `@BoardRoles()`.
 */
@Controller("boards")
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<BoardSummary[]> {
    return this.boards.listBoards(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBoardDto,
  ): Promise<BoardAggregate> {
    return this.boards.createBoard(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post("import")
  import(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<BoardAggregate[]> {
    return this.boards.importBoards(user.id, body);
  }

  @UseGuards(MembershipGuard)
  @Get(":id")
  async get(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BoardAggregate> {
    const { board, seq } = await this.boards.getAggregateWithSeq(id);
    // The client needs the seq this aggregate reflects to resume the SSE
    // stream exactly after it (TASK-30); the body stays the plain aggregate.
    res.setHeader("X-Board-Seq", String(seq));
    return board;
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async remove(@Param("id") id: string): Promise<{ status: "ok" }> {
    await this.boards.deleteBoard(id);
    return { status: "ok" };
  }

  @UseGuards(MembershipGuard)
  @Get(":id/members")
  members(@Param("id") id: string): Promise<BoardMemberDto[]> {
    return this.boards.listMembers(id);
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @Post(":id/members")
  invite(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: InviteMemberDto,
  ): Promise<BoardMemberDto> {
    return this.boards.inviteMember(id, user.id, dto);
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @Patch(":id/members/:userId")
  updateMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMemberDto,
  ): Promise<BoardMemberDto> {
    return this.boards.updateMember(id, user.id, userId, dto);
  }

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN)
  @Delete(":id/members/:userId")
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ status: "ok" }> {
    await this.boards.removeMember(id, user.id, userId);
    return { status: "ok" };
  }

  @UseGuards(MembershipGuard)
  @Get(":id/export")
  export(@Param("id") id: string): Promise<BoardEnvelope> {
    return this.boards.exportBoard(id);
  }
}
