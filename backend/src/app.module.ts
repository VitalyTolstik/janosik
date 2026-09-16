import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./common/prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { BoardsModule } from "./boards/boards.module";
import { CommandsModule } from "./commands/commands.module";
import { ActivityModule } from "./activity/activity.module";
import { CommentsModule } from "./comments/comments.module";

/**
 * TASK-23 scaffold: app skeleton with the §7.2 stub modules.
 * The auth/boards/commands/... routes are filled in from TASK-24 on.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    BoardsModule,
    CommandsModule,
    ActivityModule,
    CommentsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
