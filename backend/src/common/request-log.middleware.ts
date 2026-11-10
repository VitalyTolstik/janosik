import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import {
  buildRequestLogEntry,
  RequestLogService,
  sanitizeRequestPath,
  type LoggedRequest,
} from "./request-log";

/**
 * TASK-166.10: emit one structured entry when an API response finishes.
 *
 * Registered after `TrafficMiddleware` and before the router. The `finish`
 * listener runs after guards, handlers and the exception filter, so the entry
 * has the final status and the attribution (`auth`, `agentSession`,
 * `boardMembership`) those layers recorded. It never reads the body, headers
 * other than `X-Request-Id`, or query strings.
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  constructor(private readonly logs: RequestLogService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = Date.now();
    response.on("finish", () => {
      try {
        const path = sanitizeRequestPath(
          request.originalUrl ?? request.url ?? "",
        );
        // Static assets and the SPA shell are not API operations; keep the
        // log focused and its ring useful.
        if (!path.startsWith("/api/")) return;
        this.logs.record(
          buildRequestLogEntry(
            request as LoggedRequest,
            response,
            startedAt,
            Date.now(),
          ),
        );
      } catch {
        // Observability must never break the response path.
      }
    });
    next();
  }
}
