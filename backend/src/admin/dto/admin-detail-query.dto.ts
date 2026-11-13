import { Transform } from "class-transformer";
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
  ADMIN_CARD_DETAIL_SECTIONS,
  ADMIN_DETAIL_LIMITS,
  ADMIN_PAGE_LIMITS,
  ADMIN_USER_DETAIL_SECTIONS,
} from "@janosik/shared";

/**
 * Query of the paged detail tabs (TASK-176.3). A detail response is a set of
 * windows, so every list carries `limit`/`offset` and the exact total. The
 * window is clamped server-side like every other admin listing.
 */

function toBoolean(value: unknown): unknown {
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return value;
}

class AdminDetailQueryBaseDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(ADMIN_PAGE_LIMITS.min)
  @Max(ADMIN_DETAIL_LIMITS.max)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(ADMIN_DETAIL_LIMITS.maxOffset)
  offset?: number;

  /** Include deleted comments/attachments and revoked sessions/tokens. */
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  includeDeleted?: boolean;

  /** A comment or attachment id that should be visible in the window. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  anchor?: string;
}

export class AdminUserDetailQueryDto extends AdminDetailQueryBaseDto {
  @IsOptional()
  @IsIn(ADMIN_USER_DETAIL_SECTIONS)
  section?: (typeof ADMIN_USER_DETAIL_SECTIONS)[number];
}

export class AdminCardDetailQueryDto extends AdminDetailQueryBaseDto {
  @IsOptional()
  @IsIn(ADMIN_CARD_DETAIL_SECTIONS)
  section?: (typeof ADMIN_CARD_DETAIL_SECTIONS)[number];
}
