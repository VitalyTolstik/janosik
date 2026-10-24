import { IsInt, Max, Min } from "class-validator";

/** Body of `PUT /admin/throttle-settings` (TASK-57). */
export class AdminUpdateThrottleSettingsDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  limit!: number;
}
