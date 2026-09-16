import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ADMIN_PAGE_LIMITS } from "@janosik/shared";

/**
 * Shared query shape of every `/admin/*` listing (TASK-36): page window +
 * free-text search. The window is clamped server-side so a crafted request
 * cannot dump whole tables.
 */
export class AdminListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  search?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(ADMIN_PAGE_LIMITS.min)
  @Max(ADMIN_PAGE_LIMITS.max)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(["all", "active", "disabled", "archived", "deleted"])
  status?: "all" | "active" | "disabled" | "archived" | "deleted";
}
