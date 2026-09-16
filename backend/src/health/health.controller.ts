import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): ReturnType<HealthService["check"]> {
    return this.health.check();
  }
}
