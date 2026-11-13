import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  AGENTS_OVERVIEW_SECTIONS,
  type AgentsOverviewSection,
} from "@janosik/shared";

/**
 * `GET /agents/overview` filters (TASK-179.10). The service validates the
 * per-section `status`/`kind` vocabulary so a typo is a 400 instead of a
 * silently ignored filter.
 */
export class AgentsOverviewQueryDto {
  @IsOptional()
  @IsIn(AGENTS_OVERVIEW_SECTIONS)
  section?: AgentsOverviewSection;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  boardId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  kind?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  tokenId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sessionId?: string;

  /** Unix ms lower bound on the section's time key. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  /** Unix ms upper bound on the section's time key. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
