import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ThrottleTrafficFilter } from "./throttle-traffic.filter";
import { TrafficMiddleware } from "./traffic.middleware";
import { TrafficService } from "./traffic.service";

/**
 * API traffic observability (TASK-57): counts arrivals (middleware, before the
 * guards) and rate-limiter rejections (filter), exposing a rolling 60s gauge
 * through `TrafficService`. Global so the admin panel and any future consumer
 * share one counter.
 */
@Global()
@Module({
  providers: [
    TrafficService,
    ThrottleTrafficFilter,
    { provide: APP_FILTER, useExisting: ThrottleTrafficFilter },
  ],
  exports: [TrafficService],
})
export class TrafficModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TrafficMiddleware).forRoutes("*");
  }
}
