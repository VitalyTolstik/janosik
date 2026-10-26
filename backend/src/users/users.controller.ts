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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { CreateUserTokenResponse, UserTokenDto } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import { ApiTokenService } from "@/auth/api-token.service";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
import {
  mimeForExtension,
  StorageService,
} from "@/attachments/storage.service";
import type { UploadedBlob } from "@/attachments/attachments.service";
import { CreateUserTokenDto } from "./dto/create-user-token.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UsersService } from "./users.service";

/**
 * Account self-service (§7.4, TASK-36.1): profile and personal API tokens.
 * Password changes live in `AuthController` (the refresh cookie is scoped to
 * `/auth`). Every route is behind `JwtAuthGuard`, which accepts both a user
 * access token and a `jnk_` PAT.
 */
@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly apiTokens: ApiTokenService,
    private readonly storage: StorageService,
  ) {}

  @Patch("me")
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    return this.users.updateProfile(user.id, dto);
  }

  /** Upload the profile avatar (multipart field `file`) — TASK-47. */
  @Patch("me/avatar")
  @UseInterceptors(
    FileInterceptor("file", {
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

  @Get("me/tokens")
  listTokens(@CurrentUser() user: AuthUser): Promise<UserTokenDto[]> {
    return this.apiTokens.list(user.id);
  }

  @Post("me/tokens")
  createToken(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUserTokenDto,
  ): Promise<CreateUserTokenResponse> {
    return this.apiTokens.create(user.id, dto);
  }

  @Delete("me/tokens/:id")
  @HttpCode(HttpStatus.OK)
  async revokeToken(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ): Promise<{ status: "ok" }> {
    await this.apiTokens.revoke(user.id, id);
    return { status: "ok" };
  }
}
