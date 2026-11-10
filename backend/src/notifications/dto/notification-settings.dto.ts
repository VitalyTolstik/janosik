import { IsBoolean, IsOptional } from "class-validator";
import type { UpdateNotificationSettingsRequest } from "@janosik/shared";

/**
 * Body of `PATCH /users/me/notification-settings` (TASK-166.9). Only provided
 * keys are written; `@IsOptional` intentionally does not turn `null` into a
 * preference, and the service only accepts real booleans.
 */
export class UpdateNotificationSettingsDto implements UpdateNotificationSettingsRequest {
  @IsOptional()
  @IsBoolean()
  notifyDigest?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyAttention?: boolean;
}
