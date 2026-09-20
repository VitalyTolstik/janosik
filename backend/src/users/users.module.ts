import { Module } from "@nestjs/common";
import { AuthModule } from "@/auth/auth.module";
import { RealtimeModule } from "@/realtime/realtime.module";
import { StorageService } from "@/attachments/storage.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/** Account self-service: profile, password and API tokens (TASK-36.1). */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [UsersController],
  providers: [UsersService, StorageService],
})
export class UsersModule {}
