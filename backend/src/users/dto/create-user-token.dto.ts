import {
  IsBoolean,
  IsIn,
  IsISO8601,
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

/** Body of `POST /users/me/tokens` (TASK-36.1, scopes TASK-157). */
export class CreateUserTokenDto {
  @IsString()
  @MaxLength(API_TOKEN_NAME_MAX)
  name!: string;

  /** ISO-8601; omitted/`null` = never expires. Validated further in service. */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  /** Board scope; omitted/`null` = every board. Membership checked in service. */
  @IsOptional()
  @IsString()
  boardId?: string | null;

  /** Read-only token; omitted = read/write. */
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;

  /** Per-token request limit per minute; omitted/`null` = none. */
  @IsOptional()
  @IsInt()
  @Min(API_TOKEN_RATE_MIN)
  @Max(API_TOKEN_RATE_MAX)
  rateLimitPerMinute?: number | null;

  /** TASK-166 capability preset; omitted = `worker`. */
  @IsOptional()
  @IsIn(SCOPE_PRESETS)
  scopePreset?: (typeof SCOPE_PRESETS)[number];

  /** TASK-166 trusted CI; session JWT only, omitted = false. */
  @IsOptional()
  @IsBoolean()
  trustedCi?: boolean;
}
