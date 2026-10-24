import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Response } from "express";
import { TrafficService } from "./traffic.service";

/**
 * Mirrors rate-limiter rejections into the traffic gauge (TASK-57). Catches
 * *only* `ThrottlerException`, so every other error keeps Nest's default
 * handling untouched; the guard throws before interceptors run, and an
 * exception filter still sees it, which is why the counting lives here rather
 * than in an interceptor.
 */
@Catch(ThrottlerException)
export class ThrottleTrafficFilter implements ExceptionFilter {
  constructor(private readonly traffic: TrafficService) {}

  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    this.traffic.recordThrottled();
    const status = exception.getStatus();
    const response = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    response
      .status(status)
      .json(
        typeof body === "string"
          ? { statusCode: status, message: body }
          : (body as Record<string, unknown>),
      );
  }
}
