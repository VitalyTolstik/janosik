import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import type { StringValue } from "ms";
import { BoardsModule } from "@/boards/boards.module";
import { env } from "@/config/env";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminController } from "./admin.controller";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { AdminJwtStrategy } from "./admin-jwt.strategy";
import { AdminService } from "./admin.service";

/**
 * Master-account module (TASK-36): its own auth contour and data plane.
 * `BoardsModule` is imported for the tested soft-delete/create board logic —
 * business rules are reused, never copied.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: { expiresIn: env.ACCESS_TOKEN_TTL as StringValue },
    }),
    BoardsModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    AdminService,
  ],
})
export class AdminModule {}
