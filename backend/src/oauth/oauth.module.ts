import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";
import { OAuthSettingsService } from "./oauth-settings.service";

/**
 * OAuth login (TASK-54). AuthModule is imported for `AuthService` — the
 * session issuance stays single-sourced; `OAuthSettingsService` is exported
 * so the master panel (AdminModule) can read and edit the credentials.
 */
@Module({
  imports: [AuthModule],
  controllers: [OAuthController],
  providers: [OAuthService, OAuthSettingsService],
  exports: [OAuthSettingsService],
})
export class OAuthModule {}
