import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type {
  AdminBoardCommandRequest,
  AdminBoardDetailDto,
  AdminCardDetailDto,
  AdminEmailSettingsDto,
  AdminEmailTestResponse,
  AdminEntity,
  AdminEntityRowMap,
  AdminGlobalSearchDto,
  AdminUserDetailDto,
  AdminBoardRowDto,
  AdminCardRowDto,
  AdminCommandRowDto,
  AdminCommentRowDto,
  AdminCreateMasterResponse,
  AdminCreateUserResponse,
  AdminMasterRowDto,
  AdminMetricsDto,
  AdminSessionRowDto,
  AdminTokenRowDto,
  AdminPage,
  AdminAuditRowDto,
  AdminUserRowDto,
  BoardAggregate,
  CommandResponse,
} from "@janosik/shared";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { AdminEntitiesService } from "./admin-entities.service";
import { AdminService } from "./admin.service";
import { AttachmentsService } from "@/attachments/attachments.service";
import { StorageService } from "@/attachments/storage.service";
import { CurrentAdmin } from "./current-admin.decorator";
import type { AdminPrincipal } from "./admin.types";
import { AdminBoardCommandDto } from "./dto/admin-board-command.dto";
import { AdminCreateBoardDto } from "./dto/admin-create-board.dto";
import { AdminCreateMasterDto } from "./dto/admin-create-master.dto";
import { AdminUpdateMasterDto } from "./dto/admin-update-master.dto";
import { AdminCreateUserDto } from "./dto/admin-create-user.dto";
import { AdminEmailTestDto } from "./dto/admin-email-test.dto";
import { AdminListQueryDto } from "./dto/admin-list-query.dto";
import { AdminUpdateEmailSettingsDto } from "./dto/admin-update-email-settings.dto";
import { AdminUpdateUserDto } from "./dto/admin-update-user.dto";

/**
 * Master-account API (§7.4, TASK-36). Every route sits behind
 * `AdminJwtAuthGuard` (audience `janosik-admin` + `typ: "admin"`), so a
 * regular user token never gets past the first check. Mutations are audited
 * in the service.
 */
@UseGuards(AdminJwtAuthGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly entities: AdminEntitiesService,
    private readonly attachments: AttachmentsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Stream an attachment blob to a master (support download, TASK-48).
   * Mirrors the member route but behind the admin guard instead of board
   * membership; the disposition is `attachment` with an encoded UTF-8 name.
   */
  @Get("attachments/:attachmentId/download")
  async downloadAttachment(
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { meta, storedName } = await this.attachments.content(attachmentId);
    res.setHeader("Content-Type", meta.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    );
    this.storage.open(this.storage.attachmentPath(storedName)).pipe(res);
  }

  @Get("metrics")
  metrics(): Promise<AdminMetricsDto> {
    return this.admin.metrics();
  }

  // -------------------------------------------- admin v2 (TASK-48): graphs

  /** Generic listing over every Prisma model the panel exposes. */
  @Get("entities/:entity")
  listEntity(
    @Param("entity") entity: AdminEntity,
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminEntityRowMap[AdminEntity]>> {
    return this.entities.listEntity(entity, query);
  }

  /** Cross-entity top matches for the panel omnibox. */
  @Get("search")
  search(@Query("q") rawQuery: string): Promise<AdminGlobalSearchDto> {
    return this.entities.globalSearch(rawQuery ?? "");
  }

  @Get("users/:id/detail")
  userDetail(@Param("id") id: string): Promise<AdminUserDetailDto> {
    return this.entities.userDetail(id);
  }

  @Get("cards/:id/detail")
  cardDetail(@Param("id") id: string): Promise<AdminCardDetailDto> {
    return this.entities.cardDetail(id);
  }

  @Get("boards/:id/meta")
  boardDetail(@Param("id") id: string): Promise<AdminBoardDetailDto> {
    return this.entities.boardDetail(id);
  }

  // ------------------------------------------------- content & security

  @Get("cards")
  listCards(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCardRowDto>> {
    return this.admin.listCards(query);
  }

  @Post("cards/:id/archive")
  archiveCard(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.setCardArchived(id, true, admin);
  }

  @Post("cards/:id/unarchive")
  unarchiveCard(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.setCardArchived(id, false, admin);
  }

  @Delete("cards/:id")
  deleteCard(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.deleteCard(id, admin);
  }

  @Get("sessions")
  listSessions(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminSessionRowDto>> {
    return this.admin.listSessions(query);
  }

  @Post("sessions/:id/revoke")
  revokeSession(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    return this.admin.revokeSession(id, admin);
  }

  @Get("tokens")
  listTokens(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminTokenRowDto>> {
    return this.admin.listTokens(query);
  }

  @Post("tokens/:id/revoke")
  revokeToken(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    return this.admin.revokeToken(id, admin);
  }

  @Get("comments")
  listComments(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCommentRowDto>> {
    return this.admin.listComments(query);
  }

  @Delete("comments/:id")
  deleteComment(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.deleteComment(id, admin);
  }

  // --------------------------------------------------------------- masters

  @Get("admins")
  listMasters(
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminPage<AdminMasterRowDto>> {
    return this.admin.listMasters(admin);
  }

  @Post("admins")
  createMaster(
    @Body() dto: AdminCreateMasterDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminCreateMasterResponse> {
    return this.admin.createMaster(dto, admin);
  }

  @Patch("admins/:id")
  updateMaster(
    @Param("id") id: string,
    @Body() dto: AdminUpdateMasterDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminMasterRowDto> {
    return this.admin.updateMaster(id, dto, admin);
  }

  @Post("admins/:id/password/reset")
  resetMasterPassword(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminCreateMasterResponse> {
    return this.admin.resetMasterPassword(id, admin);
  }

  @Post("admins/:id/sessions/revoke")
  revokeMasterSessions(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    return this.admin.revokeMasterSessions(id, admin);
  }

  @Get("users")
  listUsers(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminUserRowDto>> {
    return this.admin.listUsers(query);
  }

  @Post("users")
  createUser(
    @Body() dto: AdminCreateUserDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminCreateUserResponse> {
    return this.admin.createUser(dto, admin);
  }

  @Patch("users/:id")
  updateUser(
    @Param("id") id: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminUserRowDto> {
    return this.admin.updateUser(id, dto, admin);
  }

  @Post("users/:id/sessions/revoke")
  revokeSessions(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    return this.admin.revokeUserSessions(id, admin);
  }

  @Post("users/:id/tokens/revoke")
  revokeTokens(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ revoked: number }> {
    return this.admin.revokeUserTokens(id, admin);
  }

  @Get("boards")
  listBoards(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminBoardRowDto>> {
    return this.admin.listBoards(query);
  }

  @Post("boards")
  createBoard(
    @Body() dto: AdminCreateBoardDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBoardRowDto> {
    return this.admin.createBoard(dto, admin);
  }

  @Get("boards/:id/content")
  boardContent(@Param("id") id: string): Promise<BoardAggregate> {
    return this.admin.getBoardContent(id);
  }

  @Post("boards/:id/commands")
  boardCommand(
    @Param("id") id: string,
    @Body() dto: AdminBoardCommandDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CommandResponse> {
    const request: AdminBoardCommandRequest = dto;
    return this.admin.applyBoardCommand(id, request, admin);
  }

  @Post("boards/:id/archive")
  archiveBoard(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBoardRowDto> {
    return this.admin.setBoardArchived(id, true, admin);
  }

  @Post("boards/:id/unarchive")
  unarchiveBoard(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBoardRowDto> {
    return this.admin.setBoardArchived(id, false, admin);
  }

  @Delete("boards/:id")
  deleteBoard(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.deleteBoard(id, admin);
  }

  @Get("commands")
  listCommands(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminCommandRowDto>> {
    return this.admin.listCommands(query);
  }

  @Get("audit")
  listAudit(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminAuditRowDto>> {
    return this.admin.listAudit(query);
  }

  // ------------------------------------------- email settings (TASK-52)

  /** Saved outgoing-mail transport; every admin may view, owners edit. */
  @Get("email-settings")
  getEmailSettings(): Promise<AdminEmailSettingsDto> {
    return this.admin.getEmailSettings();
  }

  @Put("email-settings")
  updateEmailSettings(
    @Body() dto: AdminUpdateEmailSettingsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminEmailSettingsDto> {
    return this.admin.updateEmailSettings(dto, admin);
  }

  /** Probe delivery — outcome (ok/error) is returned and recorded. */
  @Post("email-settings/test")
  @HttpCode(200)
  testEmailSettings(
    @Body() dto: AdminEmailTestDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminEmailTestResponse> {
    return this.admin.testEmailSettings(dto, admin);
  }
}
