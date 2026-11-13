import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ADMIN_PAGE_LIMITS } from "@janosik/shared";

/**
 * Structural ids accepted by every admin listing (TASK-176.6). The ids are
 * client-generated (`cuid`/UUID-style), so validation is shape-only: trim,
 * cap the length and refuse anything that is not an id token. The server
 * still scopes every row through Prisma's relations, so a valid id from
 * another board cannot leak a row into this board's list.
 */
const ADMIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const trimOptionalId = ({ value }: { value: unknown }): unknown =>
  typeof value === "string"
    ? value.trim() === ""
      ? undefined
      : value.trim()
    : value;

export class AdminListQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
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
  @Max(ADMIN_PAGE_LIMITS.maxOffset)
  offset?: number;

  @IsOptional()
  @IsIn(["all", "active", "disabled", "archived", "deleted"])
  status?: "all" | "active" | "disabled" | "archived" | "deleted";

  /** Inclusive lower bound of the row's `createdAt`, unix ms (TASK-48). */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  from?: number;

  /** Inclusive upper bound of the row's `createdAt`, unix ms. */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  to?: number;

  /** Exact board filter; links from board counters and board detail use it. */
  @IsOptional()
  @Transform(trimOptionalId)
  @IsString()
  @MaxLength(64)
  @Matches(ADMIN_ID_PATTERN)
  boardId?: string;

  /** Exact column filter; a column links to its cards. */
  @IsOptional()
  @Transform(trimOptionalId)
  @IsString()
  @MaxLength(64)
  @Matches(ADMIN_ID_PATTERN)
  columnId?: string;

  /** Exact label filter; a label links to the cards that carry it. */
  @IsOptional()
  @Transform(trimOptionalId)
  @IsString()
  @MaxLength(64)
  @Matches(ADMIN_ID_PATTERN)
  labelId?: string;

  /** Exact card filter for comment/attachment/checklist drill-downs. */
  @IsOptional()
  @Transform(trimOptionalId)
  @IsString()
  @MaxLength(64)
  @Matches(ADMIN_ID_PATTERN)
  cardId?: string;
}
