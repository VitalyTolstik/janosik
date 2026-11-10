import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule, ThrottlerStorageService } from "@nestjs/throttler";
import { env } from "@/config/env";
import { throttleLimit } from "@/config/throttle";
import Redis from "ioredis";
import { RedisThrottlerStorage } from "@/common/redis-throttler-storage";
import { principalTracker } from "@/common/throttle-tracker";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { SecurityAuditModule } from "@/common/security-audit/security-audit.module";
import { BoardWriteModule } from "@/common/board-write.module";
import { TrafficModule } from "@/common/traffic.module";
import { HealthModule } from "@/health/health.module";
import { MailerModule } from "@/mailer/mailer.module";
import { PasswordResetThrottlerGuard } from "@/auth/password-reset-throttler.guard";
import { PasswordResetAuditService } from "@/auth/password-reset-audit.service";
import { AuthModule } from "@/auth/auth.module";
import { UsersModule } from "@/users/users.module";
import { AccountDeletionModule } from "@/users/account-deletion.module";
import { BoardsModule } from "@/boards/boards.module";
import { CommandsModule } from "@/commands/commands.module";
import { ApprovalsModule } from "@/approvals/approvals.module";
import { AgentSessionsModule } from "@/agent-sessions/agent-sessions.module";
import { ActivityModule } from "@/activity/activity.module";
import { CommentsModule } from "@/comments/comments.module";
import { AttachmentsModule } from "@/attachments/attachments.module";
import { InvitationsModule } from "@/invitations/invitations.module";
import { OAuthModule } from "@/oauth/oauth.module";
import { ShareModule } from "@/share/share.module";
import { AdminModule } from "@/admin/admin.module";
import { OpsModule } from "@/ops/ops.module";
import { QueuesModule } from "@/queues/queues.module";
import { MaintenanceGuard } from "@/ops/maintenance.guard";
import { PerUserRateLimitInterceptor } from "@/ops/per-user-rate-limit.interceptor";

/**
 * TASK-36 state: auth, boards/membership, commands (columns/cards/labels/
 * checklists), activity feeds, comments, file attachments (TASK-47) and the
 * master-account admin module are live.
 */
@Module({
  imports: [
    // B-8: buckets are per principal (user / known PAT, else IP — see
    // `principalTracker`) and shared across nodes through Redis when one is
    // configured.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: "default", ttl: 60_000, limit: () => throttleLimit() },
      ],
      getTracker: (req) => principalTracker(req),
      ...(env.REDIS_URL.trim().length > 0
        ? {
            storage: new RedisThrottlerStorage(
              new Redis(env.REDIS_URL, {
                maxRetriesPerRequest: 1,
                commandTimeout: 500,
                lazyConnect: true,
              }),
              new ThrottlerStorageService(),
            ),
          }
        : {}),
    }),
    PrismaModule,
    SecurityAuditModule,
    BoardWriteModule,
    TrafficModule,
    MailerModule,
    HealthModule,
    AuthModule,
    UsersModule,
    AccountDeletionModule,
    BoardsModule,
    CommandsModule,
    ApprovalsModule,
    AgentSessionsModule,
    ActivityModule,
    CommentsModule,
    AttachmentsModule,
    InvitationsModule,
    OAuthModule,
    ShareModule,
    AdminModule,
    OpsModule,
    QueuesModule,
    // BullMQ root config (TASK-62) — only when a Redis URL is configured;
    // `OpsModule` then registers the broadcast queue and its worker.
    ...(env.REDIS_URL.trim().length > 0
      ? [
          BullModule.forRootAsync({
            useFactory: () => ({
              connection: { url: env.REDIS_URL },
            }),
          }),
        ]
      : []),
  ],
  providers: [
    PasswordResetAuditService,
    { provide: APP_GUARD, useClass: PasswordResetThrottlerGuard },
    { provide: APP_GUARD, useClass: MaintenanceGuard },
    { provide: APP_INTERCEPTOR, useClass: PerUserRateLimitInterceptor },
  ],
})
export class AppModule {}
