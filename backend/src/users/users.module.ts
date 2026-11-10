import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import type { StringValue } from "ms";
import { AdminModule } from "@/admin/admin.module";
import { AuthModule } from "@/auth/auth.module";
import { env } from "@/config/env";
import { RealtimeModule } from "@/realtime/realtime.module";
import { StorageService } from "@/attachments/storage.service";
import { AccountDataService } from "./account-data.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/** Account self-service: profile, data rights and API tokens (TASK-36.1). */
@Module({
  imports: [
    AuthModule,
    // TASK-166: self-service export reuses the existing background bundle
    // builder/queue, and the OAuth proof is a verified user JWT.
    AdminModule,
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: { expiresIn: env.ACCESS_TOKEN_TTL as StringValue },
    }),
    RealtimeModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, AccountDataService, StorageService],
})
export class UsersModule {}
