import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import type { StringValue } from "ms";
import { env } from "@/config/env";
import { ApiTokenService } from "./api-token.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtStrategy } from "./jwt.strategy";
@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_SECRET,
      // ACCESS_TOKEN_TTL is a vercel/ms duration string by env contract.
      signOptions: { expiresIn: env.ACCESS_TOKEN_TTL as StringValue },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, ApiTokenService],
  exports: [JwtAuthGuard, ApiTokenService],
})
export class AuthModule {}
