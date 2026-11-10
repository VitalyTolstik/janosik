import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { TrafficMiddleware } from "./traffic.middleware";
import { TrafficService } from "./traffic.service";

/**
 * API traffic observability (TASK-57): counts arrivals (middleware, before the
 * guards) and rate-limiter rejections (`ApiExceptionFilter`, TASK-166.4),
 * exposing a rolling 60s gauge through `TrafficService`. Global so the admin
 * panel and any future consumer share one counter.
 */
@Global()
@Module({
  providers: [TrafficService],
  exports: [TrafficService],
})
export class TrafficModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TrafficMiddleware).forRoutes("*");
  }
}
