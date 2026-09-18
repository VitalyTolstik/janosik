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
  UseGuards,
} from "@nestjs/common";
import type { CreateUserTokenResponse, UserTokenDto } from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import { ApiTokenService } from "@/auth/api-token.service";
import { CurrentUser } from "@/auth/current-user.decorator";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";
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
  ) {}

  @Patch("me")
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    return this.users.updateProfile(user.id, dto);
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
