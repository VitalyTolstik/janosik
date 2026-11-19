import {
  Catch,
  Controller,
  Get,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { HealthNotReadyException, HealthService } from "./health.service";

/** Readiness consumers inspect the same probe report on both HTTP statuses. */
@Catch(HealthNotReadyException)
class ReadinessExceptionFilter implements ExceptionFilter<HealthNotReadyException> {
  catch(exception: HealthNotReadyException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.report);
  }
}

/**
 * Health probes (TASK-119, split into liveness/readiness in TASK-147/B2).
 *
 * `GET /health` is liveness — the process answers, no DB or Redis is touched,
 * so an orchestrator can restart on it. `GET /health/ready` is readiness —
 * the DB (mandatory) and Redis (when configured) are checked, cached for a
 * couple of seconds so probe traffic cannot amplify onto the connection pool.
 * The maintenance guard already lets both paths through; they are exempt from
 * the global rate limit so a poll never trips it.
 */
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  live(): ReturnType<HealthService["liveness"]> {
    return this.health.liveness();
  }

  @Get("ready")
  @UseFilters(ReadinessExceptionFilter)
  ready(): ReturnType<HealthService["ready"]> {
    return this.health.ready();
  }
}
