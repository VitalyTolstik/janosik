import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { TrafficService } from "./traffic.service";

/**
 * Counts every inbound API request before the guards run (TASK-57), so the
 * rate gauge also reflects requests the throttler is about to reject. It only
 * bumps an in-memory counter — no I/O, no allocation in the hot path.
 */
@Injectable()
export class TrafficMiddleware implements NestMiddleware {
  constructor(private readonly traffic: TrafficService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.traffic.recordRequest();
    next();
  }
}
