import { Module } from "@nestjs/common";
import { RealtimeService } from "./realtime.service";

/** In-memory board event fan-out (TASK-30); the SSE route lives in Commands. */
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
