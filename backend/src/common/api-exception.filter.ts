import {
  Catch,
  Injectable,
  Logger,
  Optional,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { translateException } from "./api-error";
import { currentRequestId } from "./request-context";
import { markBackpressure, TrafficService } from "./traffic.service";

/**
 * TASK-166.4: the default exception filter. Unhandled exceptions — Nest's own,
 * an explicit `HttpException` from a service, or an unexpected bug — leave
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

    const response = host.switchToHttp().getResponse<Response>();
    // A stream (SSE/blob) may already be committed; rewriting it would throw
    // and hide the original failure.
    if (response.headersSent) return;

    const requestId = currentRequestId() ?? "";
    const { status, body } = translateException(exception, requestId);
    // TASK-166.10: the legacy gauge now sees every 429, including the new
    // per-token/session/board buckets (they are HttpExceptions, not
    // ThrottlerExceptions).
    // TASK-200.3: the queued command answer is `503 rate_limited`; it is the
    // same backpressure signal and must not be logged as an unexpected 5xx.
    // TASK-200.6: a board read refused by its semaphore is deliberate
    // backpressure too. It is not a rate-limit budget, but it must not spam
    // the error log with a stack per request during a read burst.
    const boardReadBackpressure =
      status === 503 &&
      (body.code === "board_read_busy" || body.code === "board_read_timeout");
    const backpressure =
      status === 429 ||
      (status === 503 &&
        (body.code === "rate_limited" || boardReadBackpressure));
    if (boardReadBackpressure) {
      // The request log runs on the same response object after this filter.
      markBackpressure(response, "board_read");
    }
    if (backpressure) this.traffic?.recordThrottled();
    if (status >= 500 && !backpressure) {
      const detail =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `request ${requestId || "unknown"} failed with ${status}: ${detail}`,
      );
    }
    // A throttler/guard may already have written the real `Retry-After`
    // (ThrottlerGuard uses the block expiry). Never overwrite it with the
    // generic fallback; mirror it into the body instead so clients see the
    // same number in both places.
    const headerValue = firstHeader(response.getHeader("Retry-After"));
    const parsedHeader = toSeconds(headerValue);
    if (parsedHeader !== undefined) {
      response.status(status).json({ ...body, retryAfter: parsedHeader });
      return;
    }
    if (body.retryAfter !== undefined) {
      response.setHeader("Retry-After", String(body.retryAfter));
    }
    response.status(status).json(body);
  }
}

function firstHeader(value: number | string | string[] | undefined): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function toSeconds(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : undefined;
  return parsed !== undefined && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : undefined;
}
