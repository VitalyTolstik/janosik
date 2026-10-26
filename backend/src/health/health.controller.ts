import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { HealthService } from "./health.service";

/** Health is a liveness/readiness probe (TASK-119): exempt from the global
 *  rate limit so an orchestrator's polling never trips it. The maintenance
 *  guard already lets `/health` through. */
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): ReturnType<HealthService["check"]> {
    return this.health.check();
  }
}
