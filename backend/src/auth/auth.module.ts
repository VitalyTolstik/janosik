import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";

/** Заглушка; register/login/refresh — с TASK-24. */
@Module({
  controllers: [AuthController],
})
export class AuthModule {}
