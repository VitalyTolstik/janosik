import {
  Catch,
  Injectable,
  Logger,
  Optional,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Response } from "express";
import { translateException } from "./api-error";
import { currentRequestId } from "./request-context";
import { TrafficService } from "./traffic.service";

/**
 * TASK-166.4: the app-wide exception filter. Every exception — Nest's own,
 * an explicit `HttpException` from a service, or an unexpected bug — leaves
 * the process as the ADR §8 envelope with the request id already printed on
 * `X-Request-Id`.
 *
 * The previous `ThrottleTrafficFilter` only rewrote rate-limiter bodies; the
 * traffic gauge is now updated here, so there is exactly one place that
 * decides what an error looks like.
 */
@Injectable()
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(@Optional() private readonly traffic?: TrafficService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") {
      throw exception;
    }
    if (exception instanceof ThrottlerException) {
      this.traffic?.recordThrottled();
    }

    const response = host.switchToHttp().getResponse<Response>();
    // A stream (SSE/blob) may already be committed; rewriting it would throw
    // and hide the original failure.
    if (response.headersSent) return;

    const requestId = currentRequestId() ?? "";
    const { status, body } = translateException(exception, requestId);
    if (status >= 500) {
      const detail =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `request ${requestId || "unknown"} failed with ${status}: ${detail}`,
      );
    }
    if (body.retryAfter !== undefined) {
      response.setHeader("Retry-After", String(body.retryAfter));
    }
    response.status(status).json(body);
  }
}
