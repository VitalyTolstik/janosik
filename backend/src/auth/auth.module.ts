import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";

/** Stub; register/login/refresh arrive with TASK-24. */
@Module({
  controllers: [AuthController],
})
export class AuthModule {}
