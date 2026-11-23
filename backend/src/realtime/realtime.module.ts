import { Module } from "@nestjs/common";
import { PresenceService } from "./presence.service";
import { RealtimeService } from "./realtime.service";
import { SseFrameStore } from "./sse-frames";

/** In-memory board event fan-out and presence (TASK-30/36); the SSE route lives in Commands. */
@Module({
  providers: [RealtimeService, PresenceService, SseFrameStore],
  exports: [RealtimeService, PresenceService, SseFrameStore],
})
export class RealtimeModule {}
