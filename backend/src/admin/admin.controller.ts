import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  AdminBoardRowDto,
  AdminCommandRowDto,
  AdminCreateMasterResponse,
  AdminCreateUserResponse,
  AdminMasterRowDto,
  AdminMetricsDto,
  AdminPage,
  AdminAuditRowDto,
  AdminUserRowDto,
} from "@janosik/shared";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { AdminService } from "./admin.service";
import { CurrentAdmin } from "./current-admin.decorator";
import type { AdminPrincipal } from "./admin.types";
import { AdminCreateBoardDto } from "./dto/admin-create-board.dto";
import { AdminCreateMasterDto } from "./dto/admin-create-master.dto";
import { AdminUpdateMasterDto } from "./dto/admin-update-master.dto";
import { AdminCreateUserDto } from "./dto/admin-create-user.dto";
import { AdminListQueryDto } from "./dto/admin-list-query.dto";
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
  constructor(private readonly admin: AdminService) {}

  @Get("metrics")
  metrics(): Promise<AdminMetricsDto> {
    return this.admin.metrics();
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
}
