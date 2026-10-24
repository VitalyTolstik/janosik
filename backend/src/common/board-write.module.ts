import { Global, Module } from "@nestjs/common";
import { BoardWriteService } from "./board-write.service";

/**
 * Exposes the per-board single-writer to every feature module (TASK-56).
 * Global like `PrismaModule`: board writes are a cross-cutting concern, and
 * the service is stateless apart from its in-process queues.
 */
@Global()
@Module({
  providers: [BoardWriteService],
  exports: [BoardWriteService],
})
export class BoardWriteModule {}
