import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import type { StringValue } from "ms";
import { env } from "@/config/env";
import { ApiTokenService } from "./api-token.service";
import { SessionOnlyGuard } from "./auth-principal";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtStrategy } from "./jwt.strategy";
import { LoginBackoffService } from "./login-backoff.service";
@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_SECRET,
      // ACCESS_TOKEN_TTL is a vercel/ms duration string by env contract.
      signOptions: { expiresIn: env.ACCESS_TOKEN_TTL as StringValue },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    SessionOnlyGuard,
    ApiTokenService,
    LoginBackoffService,
  ],
  // AuthService is exported for the OAuth login (TASK-54): the session
  // issuance machinery must stay single-sourced.
  exports: [JwtAuthGuard, SessionOnlyGuard, ApiTokenService, AuthService],
})
export class AuthModule {}
