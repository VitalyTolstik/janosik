import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { createReadStream } from "node:fs";
import type {
  CreateUserTokenResponse,
  DeleteAccountResponse,
  RequestAccountDeletionCodeResponse,
  UserDataExportDto,
  UserTokenDto,
} from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import { ApiTokenService } from "@/auth/api-token.service";
import {
  type AuthPrincipal,
  CurrentPrincipal,
  SessionOnlyGuard,
} from "@/auth/auth-principal";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import {
  mimeForExtension,
  StorageService,
} from "@/attachments/storage.service";
import type { UploadedBlob } from "@/attachments/attachments.service";
import { tempUploadStorage } from "@/attachments/upload-storage";
import { AgentPauseDto } from "@/agent-sessions/dto/agent-pause.dto";
import { pickLocale } from "@/mailer/mail.types";
import { AccountDataService } from "./account-data.service";
import { CreateUserTokenDto } from "./dto/create-user-token.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { RequestAccountDeletionCodeDto } from "./dto/request-account-deletion-code.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateUserTokenDto } from "./dto/update-user-token.dto";
import { UsersService } from "./users.service";

/**
 * Account self-service (§7.4, TASK-36.1): profile and personal API tokens.
 * Password changes live in `AuthController` (the refresh cookie is scoped to
 * `/auth`). Every route is behind `JwtAuthGuard`, which accepts both a user
 * access token and a `jnk_` PAT — but TASK-166 (D22) closes all account
 * writes and token reads to a PAT (`SessionOnlyGuard`, B-2); only the
 * identity (`GET /auth/me`) and avatar reads stay open to an agent key.
 */
@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly apiTokens: ApiTokenService,
    private readonly storage: StorageService,
    private readonly accountData: AccountDataService,
  ) {}

  @UseGuards(SessionOnlyGuard)
  @Patch("me")
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    return this.users.updateProfile(user.id, dto);
  }

  /** Upload the profile avatar (multipart field `file`) — TASK-47. */
  @UseGuards(SessionOnlyGuard)
  @Patch("me/avatar")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: tempUploadStorage,
      limits: { files: 1, fileSize: 2_097_152 },
    }),
  )
  uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBlob,
  ): Promise<AuthUser> {
    return this.users.uploadAvatar(user.id, file);
  }

  /**
   * Stream a user's avatar image to any authenticated user. Blob names are
   * unique per upload, so the client can cache the image aggressively.
   */
  @Get(":userId/avatar")
  async avatar(
    @Param("userId") userId: string,
    @Res() res: Response,
  ): Promise<void> {
    const storedName = await this.users.avatarFile(userId);
    // The blob name is server-generated from the sniffed type (TASK-76), so
    // its extension is authoritative — never the client's original file name.
    const mime = mimeForExtension(
      storedName.slice(storedName.lastIndexOf(".")),
    );
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    await this.storage.send(this.storage.avatarPath(storedName), res);
  }

  /**
   * TASK-166 self-service export (ADR §12.5). Session-only: a board-scoped
   * PAT must not download an account bundle. The response is the queued
   * `DataExport` row; a small account may already be `ready`.
   */
  @UseGuards(SessionOnlyGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("me/export")
  @HttpCode(HttpStatus.ACCEPTED)
  requestExport(@CurrentUser() user: AuthUser): Promise<UserDataExportDto> {
    return this.accountData.requestExport(user.id, user.email);
  }

  @UseGuards(SessionOnlyGuard)
  @Get("me/export/latest")
  latestExport(
    @CurrentUser() user: AuthUser,
  ): Promise<UserDataExportDto | null> {
    return this.accountData.latestExport(user.id);
  }

  @UseGuards(SessionOnlyGuard)
  @Get("me/export/:id")
  exportStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ): Promise<UserDataExportDto> {
    return this.accountData.exportStatus(user.id, id);
  }

  @UseGuards(SessionOnlyGuard)
  @Get("me/export/:id/download")
  async downloadExport(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { absPath, filename } = await this.accountData.exportDownload(
      user.id,
      id,
    );
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename.replace(/["\\]/g, "")}"`,
    );
    return new StreamableFile(createReadStream(absPath));
  }

  /**
   * TASK-166 D22: an OAuth-only account cannot prove ownership with a
   * password, so it requests a one-time email code first.
   */
  @UseGuards(SessionOnlyGuard)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post("me/delete/request-code")
  @HttpCode(HttpStatus.OK)
  requestDeletionCode(
    @CurrentUser() user: AuthUser,
    @Body() dto: RequestAccountDeletionCodeDto,
    @Headers("accept-language") acceptLanguage: string | undefined,
  ): Promise<RequestAccountDeletionCodeResponse> {
    return this.accountData.requestDeletionCode(
      user.id,
      dto.oauthProof,
      pickLocale(acceptLanguage),
    );
  }

  /**
   * TASK-166 self-service account deletion: disable immediately, hard-delete
   * after the seven-day grace window via the maintenance sweep.
   */
  @UseGuards(SessionOnlyGuard)
  @Delete("me")
  @HttpCode(HttpStatus.ACCEPTED)
  deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
  ): Promise<DeleteAccountResponse> {
    return this.accountData.deleteAccount(user.id, dto, principal?.stamp);
  }

  /**
   * The token surface is session-only (B-2): a PAT cannot list, mint or
   * revoke keys — an agent tricked into "create a key and paste it" gets 403.
   */
  @UseGuards(SessionOnlyGuard)
  @Get("me/tokens")
  listTokens(@CurrentUser() user: AuthUser): Promise<UserTokenDto[]> {
    return this.apiTokens.list(user.id);
  }

  @UseGuards(SessionOnlyGuard)
  @Post("me/tokens")
  createToken(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUserTokenDto,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
  ): Promise<CreateUserTokenResponse> {
    // SessionOnlyGuard above proves a browser session; only it may enable
    // the privileged `trustedCi` flag (TASK-166 D9/D10).
    return this.apiTokens.create(user.id, dto, {
      allowTrustedCi: true,
      stamp: principal?.stamp,
    });
  }

  @UseGuards(SessionOnlyGuard)
  @Delete("me/tokens/:id")
  @HttpCode(HttpStatus.OK)
  async revokeToken(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ): Promise<{ status: "ok" }> {
    await this.apiTokens.revoke(user.id, id);
    return { status: "ok" };
  }

  /**
   * TASK-166.15: the owner can edit a token's human-facing limits and scope
   * from a browser session. Session-only by construction; the service never
   * accepts or returns the secret.
   */
  @UseGuards(SessionOnlyGuard)
  @Patch("me/tokens/:id")
  updateToken(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateUserTokenDto,
  ): Promise<UserTokenDto> {
    return this.apiTokens.update(user.id, id, dto);
  }

  /** TASK-166.3: pause only this token; `resume-all` keeps it paused. */
  @UseGuards(SessionOnlyGuard)
  @Post("me/tokens/:id/pause")
  @HttpCode(HttpStatus.OK)
  pauseToken(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: AgentPauseDto,
  ): Promise<UserTokenDto> {
    return this.apiTokens.pause(user.id, id, dto.reason);
  }

  @UseGuards(SessionOnlyGuard)
  @Post("me/tokens/:id/resume")
  @HttpCode(HttpStatus.OK)
  resumeToken(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: AgentPauseDto,
  ): Promise<UserTokenDto> {
    return this.apiTokens.resume(user.id, id, dto.reason);
  }
}
