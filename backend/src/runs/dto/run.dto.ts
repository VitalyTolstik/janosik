import { Type } from "class-transformer";
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
  AGENT_RUN_KINDS,
  AGENT_RUN_STATUSES,
  type AgentRunKind,
  type AgentRunStatus,
} from "@janosik/shared";

/** `GET /boards/:id/runs` filters (TASK-166.7). */
export class RunListQueryDto {
  @IsOptional()
  @IsIn(AGENT_RUN_STATUSES)
  status?: AgentRunStatus;

  @IsOptional()
  @IsIn(AGENT_RUN_KINDS)
  kind?: AgentRunKind;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  apiTokenId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  agentSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRunId?: string;

  /** Unix ms lower bound on `createdAt` (TASK-166.15 history filter). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  /** Unix ms upper bound on `createdAt` (TASK-166.15 history filter). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  to?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;
}

/**
 * Body of `POST /boards/:id/runs/:runId/revert` (and `…/revert/preview`).
 * A dry run needs nothing; a real revert requires `commandId` so a retry is
 * idempotent (ADR §11.4).
 */
export class RevertRunDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  commandId?: string;
}
