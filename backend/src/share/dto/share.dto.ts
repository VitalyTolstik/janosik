import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { SHARE_LIMITS } from "@janosik/shared";

/** Body of `POST /boards/:id/shares` (ADMIN, TASK-58). */
export class CreateShareDto {
  @IsIn(["snapshot", "live"])
  mode!: "snapshot" | "live";

  @IsOptional()
  @IsString()
  @MaxLength(SHARE_LIMITS.titleMax)
  title?: string;

  @IsOptional()
  @IsBoolean()
  includeComments?: boolean;

  @IsOptional()
  @IsBoolean()
  includeAttachments?: boolean;

  /** ISO-8601 expiry; omitted = no expiry. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsISO8601()
  expiresAt?: string | null;

  /** Relative expiry, computed on the server when the share is created. */
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(24 * 365 * 10)
  expiresInHours?: number;
}

/** Body of `PATCH /shares/:id` (owner/admin, TASK-58). */
export class UpdateShareDto {
  @IsOptional()
  @IsString()
  @MaxLength(SHARE_LIMITS.titleMax)
  title?: string | null;

  @IsOptional()
  @IsBoolean()
  includeComments?: boolean;

  @IsOptional()
  @IsBoolean()
  includeAttachments?: boolean;

  /** `null` clears the expiry; omitted keeps it; a value extends/shortens it. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsISO8601()
  expiresAt?: string | null;
}
