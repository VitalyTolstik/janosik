import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { RequestLogMiddleware } from "./request-log.middleware";
import { RequestLogService } from "./request-log";
import { TrafficMiddleware } from "./traffic.middleware";
import { TrafficService } from "./traffic.service";

/**
 * API traffic observability (TASK-57): counts arrivals (middleware, before the
 * guards) and rate-limiter rejections (`ApiExceptionFilter`, TASK-166.4),
 * exposing a rolling 60s gauge through `TrafficService`. Global so the admin
 * panel and any future consumer share one counter.
 *
 * TASK-166.10 adds the structured request log: `RequestLogMiddleware` records
 * one entry per finished API response and feeds the same fields into
 * `TrafficService`, so the log and the metrics cannot drift apart.
 */
@Global()
@Module({
  providers: [TrafficService, RequestLogService, RequestLogMiddleware],
  exports: [TrafficService, RequestLogService],
})
export class TrafficModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TrafficMiddleware, RequestLogMiddleware).forRoutes("*");
  }
}
