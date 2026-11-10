import { Global, Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency.service";

/**
 * TASK-166.4: one idempotency service for the REST write endpoints. Global so
 * board/comment/share/attachment controllers can inject it without a
 * dependency cycle.
 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
