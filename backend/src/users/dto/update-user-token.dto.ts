import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  API_TOKEN_NAME_MAX,
  API_TOKEN_RATE_MAX,
  API_TOKEN_RATE_MIN,
  SCOPE_PRESETS,
} from "@janosik/shared";

/**
 * Body of `PATCH /users/me/tokens/:id` (TASK-166.15). Every field is
 * optional; omitted means "keep the current value". The token secret and its
 * hash are never accepted or returned.
 */
export class UpdateUserTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(API_TOKEN_NAME_MAX)
  name?: string;

  /** `null` = every board; omitted = keep the current board scope. */
  @IsOptional()
  @IsString()
  boardId?: string | null;

  /** `null` = no per-token budget; omitted = keep the current value. */
  @IsOptional()
  @IsInt()
  @Min(API_TOKEN_RATE_MIN)
  @Max(API_TOKEN_RATE_MAX)
  rateLimitPerMinute?: number | null;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  @IsOptional()
  @IsIn(SCOPE_PRESETS)
  scopePreset?: (typeof SCOPE_PRESETS)[number];

  @IsOptional()
  @IsBoolean()
  trustedCi?: boolean;
}
