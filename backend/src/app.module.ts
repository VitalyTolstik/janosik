import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { HealthModule } from "@/health/health.module";
import { AuthModule } from "@/auth/auth.module";
import { UsersModule } from "@/users/users.module";
import { BoardsModule } from "@/boards/boards.module";
import { CommandsModule } from "@/commands/commands.module";
import { ActivityModule } from "@/activity/activity.module";
import { CommentsModule } from "@/comments/comments.module";
import { InvitationsModule } from "@/invitations/invitations.module";
import { AdminModule } from "@/admin/admin.module";

/**
 * TASK-36 state: auth, boards/membership, commands (columns/cards/labels/
 * checklists), activity feeds, comments and the master-account admin module
 * are live; users/api-tokens remain stubs (§7.6).
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
    InvitationsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
