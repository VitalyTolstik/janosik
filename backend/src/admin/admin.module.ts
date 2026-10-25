import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import type { StringValue } from "ms";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { AuthModule } from "@/auth/auth.module";
import { BoardsModule } from "@/boards/boards.module";
import { CommandsModule } from "@/commands/commands.module";
import { CommentsModule } from "@/comments/comments.module";
import { env } from "@/config/env";
import { OAuthModule } from "@/oauth/oauth.module";
import { RealtimeModule } from "@/realtime/realtime.module";
import { ShareModule } from "@/share/share.module";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminController } from "./admin.controller";
import { AdminJwtAuthGuard } from "./admin-jwt-auth.guard";
import { AdminJwtStrategy } from "./admin-jwt.strategy";
import { AdminEntitiesService } from "./admin-entities.service";
import { AdminService } from "./admin.service";
import { AnnouncementsController } from "./announcements.controller";
import { CommsService } from "./comms.service";
import { DemoService } from "./demo.service";
import { ObservabilityService } from "./observability.service";
import { SecurityService } from "./security.service";
import { ThrottleSettingsService } from "./throttle-settings.service";

/**
 * Master-account module (TASK-36): its own auth contour and data plane.
 * `BoardsModule`/`CommandsModule` are imported so board content is created
 * and moderated through the very same services the user API uses — the
 * command log stays the single source of truth, nothing is written twice.
 * TASK-59…65 add user support, moderation, ops flags, comms, compliance,
 * observability and security to the panel.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: { expiresIn: env.ACCESS_TOKEN_TTL as StringValue },
    }),
    BoardsModule,
    CommandsModule,
    CommentsModule,
    AttachmentsModule,
    AuthModule,
    OAuthModule,
    ShareModule,
    RealtimeModule,
  ],
  controllers: [AdminAuthController, AdminController, AnnouncementsController],
  providers: [
    AdminEntitiesService,
    AdminAuthService,
    AdminJwtStrategy,
    AdminJwtAuthGuard,
    AdminService,
    ThrottleSettingsService,
    DemoService,
    CommsService,
    SecurityService,
    ObservabilityService,
  ],
})
export class AdminModule {}
