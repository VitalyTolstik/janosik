import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request } from "express";
import { OpsSettingsService } from "./ops-settings.service";

/**
 * Maintenance mode (TASK-61): when the operator flips it on, every public and
 * user request is answered 503 with the operator's message. The master panel
 * (`/admin`), the auth contour (`/auth`) and the health probe stay reachable —
 * otherwise nobody could ever switch it back off or log in.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly ops: OpsSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method === "OPTIONS") return true;
    const url = request.originalUrl.split("?")[0];
    if (/(^|\/)(admin|auth|health)(\/|$)/.test(url)) return true;

    const { mode, message } = await this.ops.maintenance();
    if (!mode) return true;
    throw new ServiceUnavailableException(
      message && message.trim().length > 0
        ? message
        : "The service is under maintenance",
    );
  }
}
