import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
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
