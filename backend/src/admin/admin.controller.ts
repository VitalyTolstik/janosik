import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Response } from "express";
import { env } from "@/config/env";
import {
  ADMIN_QUEUES_COOKIE,
  ADMIN_QUEUES_PATH,
  ADMIN_QUEUES_TICKET_TTL,
} from "@/queues/queues.module";
import {
  ADMIN_QUEUES_JWT_AUDIENCE,
  ADMIN_QUEUES_TOKEN_TYPE,
} from "./admin.types";
import type {
  AdminBoardCommandRequest,
  AdminBoardDetailDto,
  AdminCardDetailDto,
  AdminDemoStatusDto,
  AdminEmailSettingsDto,
  AdminEmailTestResponse,
  AdminOAuthProviderDto,
  AdminEntity,
  AdminEntityRowMap,
  AdminGlobalSearchDto,
  AdminThrottleSettingsDto,
  AdminTrafficDto,
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
  AdminShareRowDto,
  AdminUserRowDto,
  AdminAnnouncementDto,
  AdminBulkResultDto,
  AdminEmailTemplateDto,
  AdminFeatureFlagDto,
  AdminImpersonationDto,
  AdminObservabilityDto,
  AdminOpsSettingsDto,
  AdminExportRowDto,
  AdminMaintenanceRunResponse,
  AdminPromoteUserResponse,
  AdminResendVerificationResponse,
  AdminResetUserPasswordResponse,
  AdminRetentionDto,
  AdminSecurityDto,
  AdminSendEmailResponse,
  AdminTotpSetupDto,
  AdminUserExportDto,
  BoardAggregate,
  CommandResponse,
} from "@janosik/shared";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { AdminEntitiesService } from "./admin-entities.service";
import { AdminService } from "./admin.service";
import { CommsService } from "./comms.service";
import { SecurityService } from "./security.service";
import { ObservabilityService } from "./observability.service";
import { OpsSettingsService } from "@/ops/ops-settings.service";
import { FeatureFlagsService } from "@/ops/feature-flags.service";
import { MaintenanceQueueService } from "@/ops/maintenance-queue.service";
import type { MaintenanceJobName } from "@/ops/maintenance.service";
import { CommsSchedulerService } from "@/ops/comms-scheduler.service";
import { ExportsService } from "./exports.service";
import { AttachmentsService } from "@/attachments/attachments.service";
import { StorageService } from "@/attachments/storage.service";
import { CurrentAdmin } from "./current-admin.decorator";
import type { AdminPrincipal } from "./admin.types";
import { AdminBoardCommandDto } from "./dto/admin-board-command.dto";
import { AdminCreateBoardDto } from "./dto/admin-create-board.dto";
import { AdminCreateMasterDto } from "./dto/admin-create-master.dto";
import { AdminUpdateMasterDto } from "./dto/admin-update-master.dto";
import { AdminCreateUserDto } from "./dto/admin-create-user.dto";
import { AdminDemoStartDto } from "./dto/admin-demo-start.dto";
import { AdminEmailTestDto } from "./dto/admin-email-test.dto";
import { AdminListQueryDto } from "./dto/admin-list-query.dto";
import { AdminUpdateEmailSettingsDto } from "./dto/admin-update-email-settings.dto";
import { AdminUpdateOAuthProviderDto } from "./dto/admin-update-oauth-provider.dto";
import { AdminUpdateThrottleSettingsDto } from "./dto/admin-update-throttle-settings.dto";
import { AdminUpdateUserDto } from "./dto/admin-update-user.dto";
import {
  AdminAddBoardMemberDto,
  AdminBulkDto,
  AdminCreateAnnouncementDto,
  AdminSendEmailDto,
  AdminTransferOwnerDto,
  AdminUpdateAnnouncementDto,
  AdminUpdateBoardMemberDto,
  AdminMaintenanceRunDto,
  AdminUpdateEmailTemplateDto,
  AdminUpdateFeatureFlagDto,
  AdminUpdateOpsDto,
  AdminUpdateSecurityDto,
  AdminVerifyTotpDto,
} from "./dto/admin-v3.dto";

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
    private readonly comms: CommsService,
    private readonly security: SecurityService,
    private readonly observabilityService: ObservabilityService,
    private readonly ops: OpsSettingsService,
    private readonly flags: FeatureFlagsService,
    private readonly maintenanceQueue: MaintenanceQueueService,
    private readonly commsScheduler: CommsSchedulerService,
    private readonly exports: ExportsService,
    private readonly jwt: JwtService,
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
    await this.storage.send(this.storage.attachmentPath(storedName), res);
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

  /** Probe delivery with a real app email — outcome is returned and recorded. */
  @Post("email-settings/test")
  @HttpCode(200)
  testEmailSettings(
    @Body() dto: AdminEmailTestDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Headers("accept-language") acceptLanguage: string | undefined,
  ): Promise<AdminEmailTestResponse> {
    return this.admin.testEmailSettings(dto, admin, acceptLanguage);
  }

  // ------------------------------------------- oauth providers (TASK-54)

  /** Saved OAuth login settings; every admin may view, owners edit. */
  @Get("oauth-providers")
  getOAuthProviders(): Promise<AdminOAuthProviderDto[]> {
    return this.admin.getOAuthProviders();
  }

  @Put("oauth-providers/:provider")
  updateOAuthProvider(
    @Param("provider") provider: string,
    @Body() dto: AdminUpdateOAuthProviderDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminOAuthProviderDto> {
    return this.admin.updateOAuthProvider(provider, dto, admin);
  }

  // ------------------------------------- rate limit & traffic (TASK-57)

  /** The active global API rate limit; every admin may view, owners edit. */
  @Get("throttle-settings")
  getThrottleSettings(): Promise<AdminThrottleSettingsDto> {
    return this.admin.getThrottleSettings();
  }

  @Put("throttle-settings")
  updateThrottleSettings(
    @Body() dto: AdminUpdateThrottleSettingsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminThrottleSettingsDto> {
    return this.admin.updateThrottleSettings(dto, admin);
  }

  /** Live request-rate snapshot (rolling 60s) for the traffic gauge. */
  @Get("traffic")
  traffic(): AdminTrafficDto {
    return this.admin.getTraffic();
  }

  // --------------------------------------------------- demo runner (57)

  /** The live demo run (or the last one). */
  @Get("demo")
  getDemo(): Promise<AdminDemoStatusDto> {
    return this.admin.getDemo();
  }

  @Post("demo/start")
  startDemo(
    @Body() dto: AdminDemoStartDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminDemoStatusDto> {
    return this.admin.startDemo(dto, admin);
  }

  @Post("demo/stop")
  stopDemo(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminDemoStatusDto> {
    return this.admin.stopDemo(admin);
  }

  // ------------------------------------------------- public shares (TASK-58)

  /** Every public share link, for support/inspection. */
  @Get("shares")
  listShares(
    @Query() query: AdminListQueryDto,
  ): Promise<AdminPage<AdminShareRowDto>> {
    return this.admin.listShares(query);
  }

  @Post("shares/:id/revoke")
  revokeShare(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminShareRowDto> {
    return this.admin.revokeShare(id, admin);
  }

  // -------------------------------------------- user support (TASK-59)

  @Post("users/:id/verification/resend")
  resendVerification(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminResendVerificationResponse> {
    return this.admin.resendUserVerification(id, admin);
  }

  @Post("users/:id/password/reset")
  resetPassword(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminResetUserPasswordResponse> {
    return this.admin.resetUserPassword(id, admin);
  }

  @Delete("users/:id")
  deleteUser(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.deleteUser(id, admin);
  }

  @Post("users/:id/promote")
  promoteUser(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminPromoteUserResponse> {
    return this.admin.promoteUser(id, admin);
  }

  @Post("users/:id/impersonate")
  impersonateUser(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminImpersonationDto> {
    return this.admin.impersonateUser(id, admin);
  }

  /** TASK-59 demote — removes a master account (owners only, service-guarded). */
  @Delete("admins/:id")
  demoteMaster(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.demoteMaster(id, admin);
  }

  @Get("users/:id/export")
  async exportUser(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminUserExportDto> {
    const bundle = await this.admin.exportUser(id, admin);
    await this.admin.audit(admin, "data.exported", "user", id, {});
    return bundle;
  }

  // --------------------------------------- background exports (TASK-71)

  /** Queues a data export (small accounts build inline and return `ready`). */
  @Post("users/:id/export")
  async requestExport(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminExportRowDto> {
    this.admin.assertOwner(admin);
    const row = await this.exports.request(id, admin.email);
    await this.admin.audit(admin, "data.export_queued", "user", id, {
      exportId: row.id,
      status: row.status,
    });
    return row;
  }

  @Get("exports")
  listExports(): Promise<AdminExportRowDto[]> {
    return this.exports.list();
  }

  @Get("exports/:id/download")
  async downloadExport(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
    @Res() res: Response,
  ): Promise<void> {
    this.admin.assertOwner(admin);
    const { absPath, filename } = await this.exports.download(id);
    await this.admin.audit(admin, "data.export_downloaded", "export", id, {});
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    await this.storage.send(absPath, res);
  }

  // ------------------------------------------ membership (TASK-60)

  @Post("boards/:id/members")
  addBoardMember(
    @Param("id") boardId: string,
    @Body() dto: AdminAddBoardMemberDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.addBoardMember(boardId, dto, admin);
  }

  @Patch("boards/:id/members/:memberId")
  updateBoardMember(
    @Param("id") boardId: string,
    @Param("memberId") memberId: string,
    @Body() dto: AdminUpdateBoardMemberDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.updateBoardMember(boardId, memberId, dto, admin);
  }

  @Delete("boards/:id/members/:memberId")
  removeBoardMember(
    @Param("id") boardId: string,
    @Param("memberId") memberId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.removeBoardMember(boardId, memberId, admin);
  }

  @Post("boards/:id/owner")
  transferOwner(
    @Param("id") boardId: string,
    @Body() dto: AdminTransferOwnerDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.transferOwner(boardId, dto.userId, admin);
  }

  @Delete("attachments/:id")
  deleteAttachment(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.deleteAttachment(id, admin);
  }

  @Post("entities/:entity/:id/restore")
  restoreEntity(
    @Param("entity") entity: AdminEntity,
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    return this.admin.restoreEntity(entity, id, admin);
  }

  @Post("entities/:entity/bulk")
  bulkEntity(
    @Param("entity") entity: AdminEntity,
    @Body() dto: AdminBulkDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBulkResultDto> {
    return this.admin.bulkEntity(entity, dto.ids, dto.action, admin);
  }

  // ------------------------------------------------ flags + ops (TASK-61)

  @Get("flags")
  listFlags(): Promise<AdminFeatureFlagDto[]> {
    return this.flags.list();
  }

  @Patch("flags/:key")
  async updateFlag(
    @Param("key") key: string,
    @Body() dto: AdminUpdateFeatureFlagDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminFeatureFlagDto> {
    this.admin.assertOwner(admin);
    const flag = await this.flags.update(key, dto, admin.email);
    await this.admin.audit(admin, "flag.changed", "flag", key, {
      ...dto,
    });
    return flag;
  }

  @Get("ops")
  getOps(): Promise<AdminOpsSettingsDto> {
    return this.ops.get();
  }

  @Put("ops")
  async updateOps(
    @Body() dto: AdminUpdateOpsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminOpsSettingsDto> {
    this.admin.assertOwner(admin);
    const settings = await this.ops.update(dto, admin.email);
    await this.admin.audit(admin, "ops.settings_changed", "ops", null, {
      ...dto,
    });
    // Re-install the recurring jobs when their cadence changed.
    if (dto.maintenanceIntervalMinutes !== undefined && this.maintenanceQueue) {
      await this.maintenanceQueue.applySchedule().catch(() => undefined);
    }
    if (
      dto.digestIntervalHours !== undefined ||
      dto.reminderLeadHours !== undefined
    ) {
      await this.commsScheduler.applySchedule().catch(() => undefined);
    }
    return settings;
  }

  // ------------------------------------------------------ comms (TASK-62)

  @Get("announcements")
  listAnnouncements(): Promise<AdminAnnouncementDto[]> {
    return this.comms.listAnnouncements();
  }

  @Post("announcements")
  async createAnnouncement(
    @Body() dto: AdminCreateAnnouncementDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminAnnouncementDto> {
    this.admin.assertOwner(admin);
    const created = await this.comms.createAnnouncement(dto, admin.email);
    await this.admin.audit(
      admin,
      "announcement.created",
      "announcement",
      created.id,
      {
        title: dto.title,
      },
    );
    return created;
  }

  @Patch("announcements/:id")
  async updateAnnouncement(
    @Param("id") id: string,
    @Body() dto: AdminUpdateAnnouncementDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminAnnouncementDto> {
    this.admin.assertOwner(admin);
    const updated = await this.comms.updateAnnouncement(id, dto);
    await this.admin.audit(
      admin,
      "announcement.updated",
      "announcement",
      id,
      {},
    );
    return updated;
  }

  @Delete("announcements/:id")
  async deleteAnnouncement(
    @Param("id") id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ status: "ok" }> {
    this.admin.assertOwner(admin);
    await this.comms.deleteAnnouncement(id);
    await this.admin.audit(
      admin,
      "announcement.deleted",
      "announcement",
      id,
      {},
    );
    return { status: "ok" };
  }

  @Post("email/send")
  async sendEmail(
    @Body() dto: AdminSendEmailDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSendEmailResponse> {
    this.admin.assertOwner(admin);
    const result = await this.comms.sendEmail(dto.to, dto.subject, dto.body);
    await this.admin.audit(admin, "email.sent", "email", null, {
      to: dto.to,
      ok: result.ok,
    });
    return result;
  }

  @Get("email-templates")
  listEmailTemplates(): Promise<AdminEmailTemplateDto[]> {
    return this.comms.listTemplates();
  }

  @Put("email-templates/:key")
  async updateEmailTemplate(
    @Param("key") key: string,
    @Body() dto: AdminUpdateEmailTemplateDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminEmailTemplateDto> {
    this.admin.assertOwner(admin);
    const template = await this.comms.updateTemplate(key, dto, admin.email);
    await this.admin.audit(
      admin,
      "email.template_changed",
      "email_template",
      key,
      {},
    );
    return template;
  }

  @Delete("email-templates/:key")
  async resetEmailTemplate(
    @Param("key") key: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminEmailTemplateDto> {
    this.admin.assertOwner(admin);
    const template = await this.comms.resetTemplate(key);
    await this.admin.audit(
      admin,
      "email.template_reset",
      "email_template",
      key,
      {},
    );
    return template;
  }

  // --------------------------------------------- data/compliance (TASK-63)

  @Get("retention")
  getRetention(): Promise<AdminRetentionDto> {
    return this.admin.getRetention();
  }

  @Post("retention/purge")
  purgeSoftDeleted(
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBulkResultDto> {
    return this.admin.purgeSoftDeleted(admin);
  }

  // ------------------------------------------------ queues (TASK-73)

  /**
   * Mints the short-lived httpOnly ticket the queue dashboard reads (a browser
   * navigation cannot carry the Authorization header). OWNER only; 404 when
   * the dashboard is disabled.
   */
  @Post("queue-ticket")
  @HttpCode(HttpStatus.OK)
  async queueTicket(
    @CurrentAdmin() admin: AdminPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    if (!env.QUEUES_DASHBOARD) {
      throw new NotFoundException();
    }
    if (admin.role !== "OWNER") {
      throw new ForbiddenException(
        "Only the owner may open the queue dashboard",
      );
    }
    const ticket = await this.jwt.signAsync(
      { sub: admin.id, typ: ADMIN_QUEUES_TOKEN_TYPE },
      {
        secret: env.JWT_SECRET,
        audience: ADMIN_QUEUES_JWT_AUDIENCE,
        expiresIn: ADMIN_QUEUES_TICKET_TTL,
      },
    );
    res.cookie(ADMIN_QUEUES_COOKIE, ticket, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: ADMIN_QUEUES_PATH,
      maxAge: 10 * 60 * 1000,
    });
    await this.admin.audit(admin, "queue.ticket_issued", "queue", null, {});
    return { ok: true };
  }

  // --------------------------------------------- maintenance (TASK-68)

  /** Runs one housekeeping sweep now (or enqueues it when Redis is on). */
  @Post("maintenance/run")
  @HttpCode(HttpStatus.OK)
  async runMaintenance(
    @Body() dto: AdminMaintenanceRunDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminMaintenanceRunResponse> {
    this.admin.assertOwner(admin);
    const result = await this.maintenanceQueue.runNow(
      dto.job as MaintenanceJobName,
    );
    await this.admin.audit(admin, "maintenance.run", "maintenance", dto.job, {
      queued: result.queued,
      results: result.results,
    });
    return result;
  }

  // --------------------------------------------- observability (TASK-64)

  @Get("observability")
  observability(): Promise<AdminObservabilityDto> {
    return this.observabilityService.snapshot();
  }

  // ---------------------------------------------------- security (TASK-65)

  @Get("security")
  getSecurity(
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSecurityDto> {
    return this.security.get(admin);
  }

  @Post("security/totp")
  setupTotp(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminTotpSetupDto> {
    return this.security.setup(admin);
  }

  @Post("security/totp/verify")
  async verifyTotp(
    @Body() dto: AdminVerifyTotpDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ totpEnabled: true }> {
    const result = await this.security.confirm(admin, dto.code);
    await this.admin.audit(
      admin,
      "security.totp_enabled",
      "admin",
      admin.id,
      {},
    );
    return result;
  }

  @Put("security")
  async updateSecurity(
    @Body() dto: AdminUpdateSecurityDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSecurityDto> {
    const result = await this.security.update(admin, dto);
    if (dto.ipAllowlist !== undefined) {
      await this.admin.audit(
        admin,
        "security.ip_allowlist_changed",
        "admin",
        admin.id,
        { ipAllowlist: result.ipAllowlist },
      );
    }
    if (dto.totpEnabled === false) {
      await this.admin.audit(
        admin,
        "security.totp_disabled",
        "admin",
        admin.id,
        {},
      );
    }
    return result;
  }
}
