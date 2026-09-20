import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import type { StringValue } from "ms";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { BoardsModule } from "@/boards/boards.module";
import { CommandsModule } from "@/commands/commands.module";
import { env } from "@/config/env";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminController } from "./admin.controller";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { AdminJwtStrategy } from "./admin-jwt.strategy";
import { AdminEntitiesService } from "./admin-entities.service";
import { AdminService } from "./admin.service";

/**
 * Master-account module (TASK-36): its own auth contour and data plane.
 * `BoardsModule`/`CommandsModule` are imported so board content is created
 * and moderated through the very same services the user API uses — the
 * command log stays the single source of truth, nothing is written twice.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: { expiresIn: env.ACCESS_TOKEN_TTL as StringValue },
    }),
    BoardsModule,
    CommandsModule,
    AttachmentsModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminEntitiesService,
    AdminAuthService,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    AdminService,
  ],
})
export class AdminModule {}
